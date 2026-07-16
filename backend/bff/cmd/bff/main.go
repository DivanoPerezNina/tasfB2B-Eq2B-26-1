package main

import (
	"log"
	"net/http"
	"strings"

	"github.com/tasfb2b/bff/internal/config"
	dbpkg "github.com/tasfb2b/bff/internal/db"
	"github.com/tasfb2b/bff/internal/handler"
)

func main() {
	cfg := config.Load()

	db, err := dbpkg.Open(cfg.DSN())
	if err != nil {
		log.Fatalf("No se pudo conectar a MySQL: %v", err)
	}
	defer db.Close()
	log.Printf("MySQL conectado en %s:%s/%s", cfg.DBHost, cfg.DBPort, cfg.DBName)

	dom := &handler.DominioHandler{DB: db}
	mant := &handler.MantenimientoHandler{DB: db}
	ops := &handler.OperacionesHandler{DB: db}
	hlth := &handler.HealthHandler{
		DB:              db,
		CargaMasivaURL:  cfg.CargaMasivaURL,
		PlanificadorURL: cfg.PlanificadorURL,
		EjecutorURL:     cfg.EjecutorURL,
	}
	per := &handler.PeriodoHandler{
		PlanificadorURL: cfg.PlanificadorURL,
		EjecutorURL:     cfg.EjecutorURL,
	}
	auth := &handler.AuthHandler{Usuario: cfg.AuthUser, Clave: cfg.AuthPass}
	muro := &handler.MuroHandler{Archivo: cfg.MuroFile}

	mux := http.NewServeMux()

	// ── Endpoints propios del BFF ────────────────────────────────────────────
	mux.HandleFunc("GET /api/aeropuertos", dom.Aeropuertos)
	mux.HandleFunc("GET /api/vuelos", dom.Vuelos)
	mux.HandleFunc("GET /api/dataset", dom.Dataset)
	mux.HandleFunc("GET /api/health", hlth.Health)
	mux.HandleFunc("GET /api/operaciones/envios/buscar", ops.BuscarEnvios)
	mux.HandleFunc("GET /api/operaciones/envios/por-indices", ops.EnviosPorIndices)

	// ── Mantenimiento individual (CRUD) ─────────────────────────────────────
	mux.HandleFunc("POST /api/mantenimiento/aeropuertos", mant.CrearAeropuerto)
	mux.HandleFunc("PUT /api/mantenimiento/aeropuertos/{id}", mant.ActualizarAeropuerto)
	mux.HandleFunc("DELETE /api/mantenimiento/aeropuertos/{id}", mant.EliminarAeropuerto)
	mux.HandleFunc("POST /api/mantenimiento/vuelos", mant.CrearVuelo)
	mux.HandleFunc("PUT /api/mantenimiento/vuelos/{id}", mant.ActualizarVuelo)
	mux.HandleFunc("DELETE /api/mantenimiento/vuelos/{id}", mant.EliminarVuelo)
	// Un tramo es el registro operativo de un vuelo (ruta + horario + capacidad).
	mux.HandleFunc("POST /api/mantenimiento/tramos", mant.CrearVuelo)
	mux.HandleFunc("PUT /api/mantenimiento/tramos/{id}", mant.ActualizarVuelo)
	mux.HandleFunc("DELETE /api/mantenimiento/tramos/{id}", mant.EliminarVuelo)

	// ── Login (credencial compartida) + Muro de comentarios ──────────────────
	mux.HandleFunc("POST /api/login", auth.Login)
	mux.HandleFunc("POST /api/muro", muro.Crear)
	mux.HandleFunc("GET /api/muro", muro.Listar)

	// ── Simulación de Periodo (orquestación BFF) ──────────────────────────────
	// Único punto de entrada: recibe fechaInicio+dias+criterio+duracion_real_min
	mux.HandleFunc("POST /api/periodo/iniciar", per.Iniciar)
	mux.HandleFunc("GET /api/periodo/status/{jobId}", per.Status)
	mux.HandleFunc("POST /api/periodo/ejecutar/{jobId}", per.Ejecutar)

	// ── Proxy → Carga Masiva (:8082) ─────────────────────────────────────────
	// /api/carga/upload/aeropuertos → /upload/aeropuertos
	cargaProxy := handler.NuevoProxy(cfg.CargaMasivaURL, "/api/carga")
	mux.HandleFunc("/api/carga/", cargaProxy)

	// ── Proxy → Planificador (:8084) ─────────────────────────────────────────
	// /api/planificacion/* → /api/planificacion/*  (sin cambio de path)
	planProxy := handler.NuevoProxy(cfg.PlanificadorURL, "")
	mux.HandleFunc("/api/planificacion/", planProxy)

	// ── Proxy → Ejecutor (:8083) ─────────────────────────────────────────────
	// SSE: /api/simulacion/eventos → proxy streaming
	ejSSE := handler.NuevoProxySSE(cfg.EjecutorURL, "")
	mux.HandleFunc("GET /api/simulacion/eventos", ejSSE)
	// REST: /api/simulacion/* → proxy normal
	ejProxy := handler.NuevoProxy(cfg.EjecutorURL, "")
	mux.HandleFunc("/api/simulacion/", ejProxy)

	// ── CORS middleware ───────────────────────────────────────────────────────
	cors := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := cfg.CORSOrigin
			if origin == "" {
				origin = "*"
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Confirmar-Borrado")
			if strings.ToUpper(r.Method) == "OPTIONS" {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}

	addr := ":" + cfg.Port
	log.Printf("BFF escuchando en %s", addr)
	log.Printf("  Carga Masiva  → %s", cfg.CargaMasivaURL)
	log.Printf("  Planificador  → %s", cfg.PlanificadorURL)
	log.Printf("  Ejecutor      → %s", cfg.EjecutorURL)

	if err := http.ListenAndServe(addr, cors(mux)); err != nil {
		log.Fatalf("ListenAndServe: %v", err)
	}
}
