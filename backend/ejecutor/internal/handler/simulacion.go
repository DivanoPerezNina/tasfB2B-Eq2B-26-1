package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/tasfb2b/ejecutor/internal/engine"
	"github.com/tasfb2b/ejecutor/internal/sse"
)

// SimulacionHandler gestiona el ciclo de vida de la simulación activa.
// Solo puede haber una simulación activa a la vez.
type SimulacionHandler struct {
	PlanificadorURL string
	TickInterval    time.Duration
	MaxSSEClientes  int

	mu     sync.Mutex
	activa *engine.Simulacion
	broker *sse.Broker
}

// ── POST /api/simulacion/iniciar ─────────────────────────────────────────────

// Body esperado:
//
//	{
//	  "job_id":            "uuid del Planificador",
//	  "duracion_real_min": 45,              // minutos reales que dura la simulación
//	  "umbrales": { "verde_hasta": 0.6, "ambar_hasta": 0.85 }
//	}
func (h *SimulacionHandler) Iniciar(w http.ResponseWriter, r *http.Request) {
	var req struct {
		JobID          string  `json:"job_id"`
		DuracionReal   float64 `json:"duracion_real_min"`
		Umbrales struct {
			VerdeHasta float64 `json:"verde_hasta"`
			AmbarHasta float64 `json:"ambar_hasta"`
		} `json:"umbrales"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		errResp(w, 400, "BODY_INVALIDO", err.Error())
		return
	}
	if req.JobID == "" {
		errResp(w, 400, "PARAM_FALTANTE", "Se requiere 'job_id'")
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	if h.activa != nil {
		st := h.activa.GetEstado()
		if st != "detenido" && st != "completado" {
			errResp(w, 409, "SIMULACION_ACTIVA",
				"Ya hay una simulación en curso. Deténgala antes.")
			return
		}
		// La simulación anterior terminó (completado/detenido): limpiarla por
		// completo antes de arrancar la nueva. Detener corta su tick loop (si
		// quedara vivo) y Cerrar libera el broker SSE viejo, evitando que la
		// conexión SSE del run anterior quede colgada en el proxy del BFF —
		// causa de que la "2da simulación" no recibiera eventos.
		h.activa.Detener()
		if h.broker != nil {
			h.broker.Cerrar()
			h.broker = nil
		}
		h.activa = nil
	}

	umbrales := engine.Umbrales{
		VerdeHasta: req.Umbrales.VerdeHasta,
		AmbarHasta: req.Umbrales.AmbarHasta,
	}
	if umbrales.VerdeHasta == 0 {
		umbrales.VerdeHasta = 0.60
	}
	if umbrales.AmbarHasta == 0 {
		umbrales.AmbarHasta = 0.85
	}

	sim, err := engine.NuevaDesde(
		req.JobID, h.PlanificadorURL, req.JobID,
		req.DuracionReal, umbrales, h.TickInterval,
	)
	if err != nil {
		errResp(w, 502, "PLANIFICADOR_ERROR", err.Error())
		return
	}

	// Crear broker SSE y vincular al broadcast
	broker := sse.Nuevo(h.MaxSSEClientes)
	sim.Broadcast = broker.Publicar

	if err := sim.Iniciar(); err != nil {
		errResp(w, 500, "ENGINE_ERROR", err.Error())
		return
	}

	h.activa = sim
	h.broker = broker

	respond(w, 202, map[string]interface{}{
		"simulacion_id":         sim.ID,
		"estado":                sim.GetEstado(),
		"ini_utc":               sim.IniUTC,
		"fin_utc":               sim.FinUTC,
		"avance_por_tick_min":   fmt.Sprintf("%.4f", sim.AvancePorTick),
		"total_envios":          len(sim.Envios),
		"mensaje":               "Simulación iniciada",
	})
}

// ── POST /api/simulacion/pausar ──────────────────────────────────────────────

func (h *SimulacionHandler) Pausar(w http.ResponseWriter, r *http.Request) {
	sim := h.getActiva(w)
	if sim == nil {
		return
	}
	if err := sim.Pausar(); err != nil {
		errResp(w, 409, "ESTADO_INVALIDO", err.Error())
		return
	}
	respond(w, 200, map[string]string{"estado": "pausado"})
}

// ── POST /api/simulacion/reanudar ────────────────────────────────────────────

func (h *SimulacionHandler) Reanudar(w http.ResponseWriter, r *http.Request) {
	sim := h.getActiva(w)
	if sim == nil {
		return
	}
	if err := sim.Reanudar(); err != nil {
		errResp(w, 409, "ESTADO_INVALIDO", err.Error())
		return
	}
	respond(w, 200, map[string]string{"estado": "ejecutando"})
}

// ── POST /api/simulacion/detener ─────────────────────────────────────────────

func (h *SimulacionHandler) Detener(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.activa == nil {
		errResp(w, 404, "SIN_SIMULACION", "No hay simulación activa")
		return
	}
	h.activa.Detener()
	respond(w, 200, map[string]string{"estado": "detenido"})
}

// ── GET /api/simulacion/estado ───────────────────────────────────────────────

func (h *SimulacionHandler) Estado(w http.ResponseWriter, r *http.Request) {
	sim := h.getActiva(w)
	if sim == nil {
		return
	}
	t := sim.GetTiempoSim()
	cont := sim.GetContadores()
	denom := float64(sim.FinUTC - sim.ObservacionUTC)
	if denom <= 0 {
		denom = 1
	}
	progreso := (t - float64(sim.ObservacionUTC)) / denom * 100
	if progreso > 100 {
		progreso = 100
	}
	if progreso < 0 {
		progreso = 0
	}
	respond(w, 200, map[string]interface{}{
		"simulacion_id":   sim.ID,
		"estado":          sim.GetEstado(),
		"tiempo_sim_utc":  int64(t),
		"progreso_pct":    fmt.Sprintf("%.1f", progreso),
		"contadores":      cont,
		"clientes_sse":    h.broker.NumClientes(),
	})
}

// ── GET /api/simulacion/aeropuertos ─────────────────────────────────────────

func (h *SimulacionHandler) Aeropuertos(w http.ResponseWriter, r *http.Request) {
	sim := h.getActiva(w)
	if sim == nil {
		return
	}
	respond(w, 200, sim.GetAeropuertos())
}

// ── GET /api/simulacion/eventos (SSE) ────────────────────────────────────────

func (h *SimulacionHandler) Eventos(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	broker := h.broker
	h.mu.Unlock()

	if broker == nil {
		errResp(w, 404, "SIN_SIMULACION", "No hay simulación activa")
		return
	}
	broker.ServeHTTP(w, r)
}

// ── GET /api/health ──────────────────────────────────────────────────────────

func (h *SimulacionHandler) Health(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	activa := h.activa
	h.mu.Unlock()

	info := map[string]interface{}{
		"status":  "ok",
		"service": "ejecutor",
	}
	if activa != nil {
		info["simulacion_id"] = activa.ID
		info["estado"]        = activa.GetEstado()
		info["total_envios"]  = len(activa.Envios)
	}
	respond(w, 200, info)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

func (h *SimulacionHandler) getActiva(w http.ResponseWriter) *engine.Simulacion {
	h.mu.Lock()
	sim := h.activa
	h.mu.Unlock()
	if sim == nil {
		errResp(w, 404, "SIN_SIMULACION", "No hay simulación activa")
		return nil
	}
	return sim
}

func respond(w http.ResponseWriter, code int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(body)
}

func errResp(w http.ResponseWriter, code int, codigo, msg string) {
	respond(w, code, map[string]string{"error": codigo, "mensaje": msg})
}

// corsMiddleware añade headers CORS.
func CORSMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			origin = "*"
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if strings.ToUpper(r.Method) == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
