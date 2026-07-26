package handler

import (
	"encoding/json"
	"fmt"
	"math"
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
	ConsultasURL    string
	TickInterval    time.Duration
	MaxSSEClientes  int

	mu     sync.Mutex
	activa *engine.Simulacion
	orq    *engine.Orquestador // simulación de periodo PROGRAMADA (esquema Sa/Sc)
	broker *sse.Broker
}

// limpiarActivos detiene y libera cualquier simulación/orquestador previo y su
// broker SSE. Debe llamarse con h.mu tomado.
func (h *SimulacionHandler) limpiarActivos() {
	if h.activa != nil {
		h.activa.Detener()
		h.activa = nil
	}
	if h.orq != nil {
		h.orq.Detener()
		h.orq = nil
	}
	if h.broker != nil {
		h.broker.Cerrar()
		h.broker = nil
	}
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
		JobID        string  `json:"job_id"`
		DuracionReal float64 `json:"duracion_real_min"`
		Umbrales     struct {
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

	if hayEnCurso(h.activa, h.orq) {
		errResp(w, 409, "SIMULACION_ACTIVA",
			"Ya hay una simulación en curso. Deténgala antes.")
		return
	}
	// Limpiar por completo lo anterior (simulación u orquestador) antes de
	// arrancar: libera el broker SSE viejo para que la nueva conexión no quede
	// colgada en el proxy del BFF.
	h.limpiarActivos()

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
		"simulacion_id":       sim.ID,
		"estado":              sim.GetEstado(),
		"ini_utc":             sim.IniUTC,
		"fin_utc":             sim.FinUTC,
		"avance_por_tick_min": fmt.Sprintf("%.4f", sim.AvancePorTick),
		"total_envios":        len(sim.Envios),
		"mensaje":             "Simulación iniciada",
	})
}

// ── POST /api/simulacion/periodo-programado ──────────────────────────────────
//
// Lanza la simulación de PERIODO con el esquema Sa/Sc (planificación programada).
// Body:
//
//	{
//	  "t0_utc":   29742255,   // minuto UTC de la fecha/hora elegida
//	  "dias":     5,          // ventana visible
//	  "sc":       240,        // min de datos por bloque
//	  "sa_seg":   120,        // segundos reales por bloque
//	  "warmup":   false,      // true = siembra estado previo (lookback)
//	  "criterio": "EDF",
//	  "umbrales": { "verde_hasta": 0.6, "ambar_hasta": 0.85 }
//	}
func (h *SimulacionHandler) PeriodoProgramado(w http.ResponseWriter, r *http.Request) {
	var req struct {
		T0UTC             int64   `json:"t0_utc"`
		Dias              int     `json:"dias"`
		Sc                int64   `json:"sc"`
		SaSeg             float64 `json:"sa_seg"`
		WarmUp            bool    `json:"warmup"`
		Criterio          string  `json:"criterio"`
		UsarCancelaciones *bool   `json:"usar_cancelaciones"` // nil/true=aplica archivo; false=Tiempo Real
		Umbrales          struct {
			VerdeHasta float64 `json:"verde_hasta"`
			AmbarHasta float64 `json:"ambar_hasta"`
		} `json:"umbrales"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		errResp(w, 400, "BODY_INVALIDO", err.Error())
		return
	}
	if req.T0UTC <= 0 || req.Dias < 1 || req.Sc < 1 || req.SaSeg <= 0 {
		errResp(w, 400, "PARAM_INVALIDO", "Se requieren t0_utc, dias, sc y sa_seg válidos")
		return
	}
	if req.Criterio == "" {
		req.Criterio = "EDF"
	}

	umbrales := engine.Umbrales{VerdeHasta: req.Umbrales.VerdeHasta, AmbarHasta: req.Umbrales.AmbarHasta}
	if umbrales.VerdeHasta == 0 {
		umbrales.VerdeHasta = 0.60
	}
	if umbrales.AmbarHasta == 0 {
		umbrales.AmbarHasta = 0.85
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	if hayEnCurso(h.activa, h.orq) {
		errResp(w, 409, "SIMULACION_ACTIVA", "Ya hay una simulación en curso. Deténgala antes.")
		return
	}
	h.limpiarActivos()

	finUTC := req.T0UTC + int64(req.Dias)*1440
	var lookback int64
	if req.WarmUp {
		lookback = 3 * 1440 // 3 días, cubre el viaje más largo
	}
	sa := time.Duration(req.SaSeg*1000) * time.Millisecond

	broker := sse.Nuevo(h.MaxSSEClientes)
	orq := engine.NuevoOrquestador("periodo", h.ConsultasURL, h.PlanificadorURL,
		req.T0UTC, finUTC, req.Sc, sa, lookback, req.Criterio, umbrales)
	// Periodo aplica el archivo de cancelaciones; Tiempo Real (envía false) no.
	// Tiempo Real (día a día) tampoco lee del dataset histórico: los dos flags
	// van juntos porque hoy solo este escenario desactiva cancelaciones-archivo;
	// si otro escenario futuro también lo hace, separar esta señal.
	orq.UsarCancelacionesArchivo = req.UsarCancelaciones == nil || *req.UsarCancelaciones
	orq.ModoOperacion = !orq.UsarCancelacionesArchivo
	orq.Broadcast = broker.Publicar
	orq.Iniciar()

	h.orq = orq
	h.broker = broker

	respond(w, 202, map[string]interface{}{
		"estado":  orq.GetEstado(),
		"t0_utc":  req.T0UTC,
		"fin_utc": finUTC,
		"sc":      req.Sc,
		"sa_seg":  req.SaSeg,
		"bloques": (finUTC - req.T0UTC) / req.Sc,
		"warmup":  req.WarmUp,
		"mensaje": "Simulación de periodo (programada) iniciada",
	})
}

// ── POST /api/simulacion/colapso ─────────────────────────────────────────────

func (h *SimulacionHandler) Colapso(w http.ResponseWriter, r *http.Request) {
	var req struct {
		T0UTC                   int64   `json:"t0_utc"`
		SaSeg                   float64 `json:"sa_seg"`
		K                       float64 `json:"k"`
		MaxDias                 int     `json:"max_dias"`
		WarmUp                  bool    `json:"warmup"`
		Criterio                string  `json:"criterio"`
		UmbralColapso           float64 `json:"umbral_colapso"`
		UmbralRechazosPct       float64 `json:"umbral_rechazos_pct"`
		BloquesRojoConsecutivos int     `json:"bloques_rojo_consecutivos"`
		Umbrales                struct {
			VerdeHasta float64 `json:"verde_hasta"`
			AmbarHasta float64 `json:"ambar_hasta"`
		} `json:"umbrales"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		errResp(w, 400, "BODY_INVALIDO", err.Error())
		return
	}
	if req.T0UTC <= 0 {
		errResp(w, 400, "PARAM_INVALIDO", "Se requiere 't0_utc' válido")
		return
	}
	if req.SaSeg <= 0 {
		req.SaSeg = 120
	}
	if req.K <= 0 {
		req.K = 75
	}
	if req.MaxDias <= 0 {
		req.MaxDias = 540
	}
	if req.Criterio == "" {
		req.Criterio = "EDF"
	}
	if req.UmbralColapso == 0 {
		req.UmbralColapso = 0.85
	}
	if req.UmbralRechazosPct == 0 {
		req.UmbralRechazosPct = 0.30
	}
	if req.BloquesRojoConsecutivos <= 0 {
		req.BloquesRojoConsecutivos = 3
	}

	umbrales := engine.Umbrales{VerdeHasta: req.Umbrales.VerdeHasta, AmbarHasta: req.Umbrales.AmbarHasta}
	if umbrales.VerdeHasta == 0 {
		umbrales.VerdeHasta = 0.60
	}
	if umbrales.AmbarHasta == 0 {
		umbrales.AmbarHasta = 0.85
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	if hayEnCurso(h.activa, h.orq) {
		errResp(w, 409, "SIMULACION_ACTIVA", "Ya hay una simulación en curso. Deténgala antes.")
		return
	}
	h.limpiarActivos()

	finUTC := req.T0UTC + int64(req.MaxDias)*1440
	sc := int64(math.Ceil(req.K * (req.SaSeg / 60.0)))
	if sc < 1 {
		sc = 1
	}

	var lookback int64
	if req.WarmUp {
		lookback = 3 * 1440
	}
	sa := time.Duration(req.SaSeg*1000) * time.Millisecond

	broker := sse.Nuevo(h.MaxSSEClientes)
	orq := engine.NuevoOrquestador("colapso", h.ConsultasURL, h.PlanificadorURL,
		req.T0UTC, finUTC, sc, sa, lookback, req.Criterio, umbrales)
	orq.Colapso = &engine.ConfigColapso{
		Habilitado:               true,
		UmbralOcupacion:          req.UmbralColapso,
		UmbralRechazosPct:        req.UmbralRechazosPct,
		BloquesRojosConsecutivos: req.BloquesRojoConsecutivos,
		MaxDias:                  req.MaxDias,
	}
	orq.UsarCancelacionesArchivo = true // Colapso aplica el archivo de cancelaciones
	orq.Broadcast = broker.Publicar
	orq.Iniciar()

	h.orq = orq
	h.broker = broker

	respond(w, 202, map[string]interface{}{
		"estado":   orq.GetEstado(),
		"t0_utc":   req.T0UTC,
		"fin_utc":  finUTC,
		"sc":       sc,
		"sa_seg":   req.SaSeg,
		"k":        req.K,
		"max_dias": req.MaxDias,
		"mensaje":  "Simulación de colapso iniciada",
	})
}

// ── POST /api/simulacion/cancelar ────────────────────────────────────────────
//
// Cancela una OCURRENCIA de vuelo (vuelo, día) en la simulación de periodo en
// curso y fuerza un re-plan inmediato del bloque actual. Body:
//
//	{ "vueloIdx": 123, "salidaUTC": 29742255 }   // salidaUTC = minuto UTC absoluto
func (h *SimulacionHandler) Cancelar(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Origen    string `json:"origen"`
		Destino   string `json:"destino"`
		SalidaUTC int64  `json:"salidaUTC"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		errResp(w, 400, "BODY_INVALIDO", err.Error())
		return
	}
	if req.Origen == "" || req.Destino == "" {
		errResp(w, 400, "PARAM_FALTANTE", "Se requieren 'origen' y 'destino' (IATA)")
		return
	}

	h.mu.Lock()
	orq := h.orq
	h.mu.Unlock()
	if orq == nil || orq.GetEstado() == "detenido" || orq.GetEstado() == "completado" {
		errResp(w, 404, "SIN_SIMULACION", "No hay simulación de periodo en curso")
		return
	}

	orq.AgregarCancelacion(req.Origen, req.Destino, req.SalidaUTC)
	respond(w, 202, map[string]interface{}{
		"estado":    "cancelacion_aplicada",
		"origen":    req.Origen,
		"destino":   req.Destino,
		"salidaUTC": req.SalidaUTC,
		"mensaje":   "Cancelación registrada; re-planificando bloque actual",
	})
}

// ── POST /api/simulacion/replanificar ───────────────────────────────────────
// Fuerza un re-plan inmediato del bloque actual sin agregar cancelaciones.
// En Día a Día se usa después de cargar rutas o envíos para que el mapa se
// actualice al momento, sin esperar el siguiente ciclo Sa/Sc.
func (h *SimulacionHandler) Replanificar(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	orq := h.orq
	h.mu.Unlock()
	if orq == nil || orq.GetEstado() == "detenido" || orq.GetEstado() == "completado" {
		errResp(w, 404, "SIN_SIMULACION", "No hay operación en curso para re-planificar")
		return
	}
	orq.SolicitarReplanificacion()
	respond(w, 202, map[string]interface{}{
		"estado":  "replanificacion_solicitada",
		"mensaje": "Re-planificación solicitada para el bloque actual",
	})
}

// ── POST /api/simulacion/pausar ──────────────────────────────────────────────

func (h *SimulacionHandler) Pausar(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	orq, sim := h.orq, h.activa
	h.mu.Unlock()
	if orq != nil {
		orq.Pausar()
		respond(w, 200, map[string]string{"estado": "pausado"})
		return
	}
	if sim == nil {
		errResp(w, 404, "SIN_SIMULACION", "No hay simulación activa")
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
	h.mu.Lock()
	orq, sim := h.orq, h.activa
	h.mu.Unlock()
	if orq != nil {
		orq.Reanudar()
		respond(w, 200, map[string]string{"estado": "ejecutando"})
		return
	}
	if sim == nil {
		errResp(w, 404, "SIN_SIMULACION", "No hay simulación activa")
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
	orq, sim := h.orq, h.activa
	h.mu.Unlock()
	if orq != nil {
		orq.Detener()
		respond(w, 200, map[string]string{"estado": "detenido"})
		return
	}
	if sim == nil {
		errResp(w, 404, "SIN_SIMULACION", "No hay simulación activa")
		return
	}
	sim.Detener()
	respond(w, 200, map[string]string{"estado": "detenido"})
}

// hayEnCurso indica si una simulación u orquestador sigue activo (no terminal).
func hayEnCurso(sim *engine.Simulacion, orq *engine.Orquestador) bool {
	if sim != nil {
		st := sim.GetEstado()
		if st != "detenido" && st != "completado" {
			return true
		}
	}
	if orq != nil {
		st := orq.GetEstado()
		if st != "detenido" && st != "completado" {
			return true
		}
	}
	return false
}

// ── GET /api/simulacion/estado ───────────────────────────────────────────────

func (h *SimulacionHandler) Estado(w http.ResponseWriter, r *http.Request) {
	// Simulación de PERIODO/COLAPSO/Día-a-día (orquestador). Es la que el admin
	// debe poder retomar al reabrir la pestaña: reportamos su estado para que el
	// frontend detecte la sim en curso y se re-suscriba al SSE (que reenvía el
	// snapshot). Los contadores/plan llegan por SSE, no aquí.
	h.mu.Lock()
	orq := h.orq
	h.mu.Unlock()
	if orq != nil {
		est := orq.GetEstado()
		if est != "detenido" && est != "completado" {
			respond(w, 200, map[string]interface{}{
				"tipo":           "orquestador",
				"estado":         est,
				"t0_utc":         orq.T0UTC,
				"fin_utc":        orq.FinUTC,
				"activa":         true,
				"modo_operacion": orq.ModoOperacion,
				"clientes_sse":   h.brokerClientes(),
			})
			return
		}
	}

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
		"tipo":           "simulacion",
		"simulacion_id":  sim.ID,
		"estado":         sim.GetEstado(),
		"activa":         sim.GetEstado() != "detenido" && sim.GetEstado() != "completado",
		"modo_operacion": false,
		"tiempo_sim_utc": int64(t),
		"progreso_pct":   fmt.Sprintf("%.1f", progreso),
		"contadores":     cont,
		"clientes_sse":   h.broker.NumClientes(),
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
		info["estado"] = activa.GetEstado()
		info["total_envios"] = len(activa.Envios)
	}
	respond(w, 200, info)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// brokerClientes devuelve el nº de clientes SSE conectados (0 si no hay broker).
func (h *SimulacionHandler) brokerClientes() int {
	h.mu.Lock()
	b := h.broker
	h.mu.Unlock()
	if b == nil {
		return 0
	}
	return b.NumClientes()
}

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
