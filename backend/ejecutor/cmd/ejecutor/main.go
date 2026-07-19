package main

import (
	"log"
	"net/http"
	"time"

	"github.com/tasfb2b/ejecutor/internal/config"
	"github.com/tasfb2b/ejecutor/internal/handler"
)

func main() {
	cfg := config.Load()

	h := &handler.SimulacionHandler{
		PlanificadorURL: cfg.PlanificadorURL,
		ConsultasURL:    cfg.ConsultasURL,
		TickInterval:    time.Duration(cfg.TickIntervalMs) * time.Millisecond,
		MaxSSEClientes:  cfg.SSEMaxClientes,
	}

	mux := http.NewServeMux()

	// Simulación
	mux.HandleFunc("POST /api/simulacion/iniciar", h.Iniciar)
	// Simulación de PERIODO programada (esquema Sa/Sc)
	mux.HandleFunc("POST /api/simulacion/periodo-programado", h.PeriodoProgramado)
	mux.HandleFunc("POST /api/simulacion/colapso", h.Colapso)
	mux.HandleFunc("POST /api/simulacion/cancelar", h.Cancelar)
	mux.HandleFunc("POST /api/simulacion/pausar", h.Pausar)
	mux.HandleFunc("POST /api/simulacion/reanudar", h.Reanudar)
	mux.HandleFunc("POST /api/simulacion/detener", h.Detener)
	mux.HandleFunc("GET /api/simulacion/estado", h.Estado)
	mux.HandleFunc("GET /api/simulacion/aeropuertos", h.Aeropuertos)

	// SSE — stream de eventos en tiempo real
	mux.HandleFunc("GET /api/simulacion/eventos", h.Eventos)

	// Health
	mux.HandleFunc("GET /api/health", h.Health)

	addr := ":" + cfg.Port
	log.Printf("Ejecutor escuchando en %s → Planificador: %s",
		addr, cfg.PlanificadorURL)

	if err := http.ListenAndServe(addr, handler.CORSMiddleware(mux)); err != nil {
		log.Fatalf("ListenAndServe: %v", err)
	}
}
