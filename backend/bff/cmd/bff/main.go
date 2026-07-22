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
	auth := &handler.AuthHandler{DB: db}
	muro := &handler.MuroHandler{Archivo: cfg.MuroFile}
	operario := &handler.OperarioHandler{DB: db}
	usuarios := &handler.UsuariosHandler{DB: db}
	modoOp := &handler.ModoOperacionHandler{DB: db}
	// admin/operario exigen ese rol; auth solo exige una sesión válida (cualquier rol).
	admin := handler.RequireAuth(db, "admin")
	soloOperario := handler.RequireAuth(db, "operario")
	auth_ := handler.RequireAuth(db)

	mux := http.NewServeMux()

	// ── Endpoints propios del BFF (lectura pública de referencia) ────────────
	mux.HandleFunc("GET /api/aeropuertos", dom.Aeropuertos)
	mux.HandleFunc("GET /api/vuelos", dom.Vuelos)
	mux.HandleFunc("GET /api/dataset", dom.Dataset)
	mux.HandleFunc("GET /api/health", hlth.Health)
	mux.HandleFunc("GET /api/operaciones/envios/buscar", ops.BuscarEnvios)
	mux.HandleFunc("GET /api/operaciones/envios/por-indices", ops.EnviosPorIndices)

	// ── Mantenimiento individual (CRUD) — solo admin ─────────────────────────
	mux.HandleFunc("POST /api/mantenimiento/aeropuertos", admin(mant.CrearAeropuerto))
	mux.HandleFunc("PUT /api/mantenimiento/aeropuertos/{id}", admin(mant.ActualizarAeropuerto))
	mux.HandleFunc("DELETE /api/mantenimiento/aeropuertos/{id}", admin(mant.EliminarAeropuerto))
	mux.HandleFunc("POST /api/mantenimiento/vuelos", admin(mant.CrearVuelo))
	mux.HandleFunc("PUT /api/mantenimiento/vuelos/{id}", admin(mant.ActualizarVuelo))
	mux.HandleFunc("DELETE /api/mantenimiento/vuelos/{id}", admin(mant.EliminarVuelo))
	// Un tramo es el registro operativo de un vuelo (ruta + horario + capacidad).
	mux.HandleFunc("POST /api/mantenimiento/tramos", admin(mant.CrearVuelo))
	mux.HandleFunc("PUT /api/mantenimiento/tramos/{id}", admin(mant.ActualizarVuelo))
	mux.HandleFunc("DELETE /api/mantenimiento/tramos/{id}", admin(mant.EliminarVuelo))
	// Cuentas de operario/admin. Sin DELETE a propósito: se desactivan, no se borran.
	mux.HandleFunc("GET /api/mantenimiento/usuarios", admin(usuarios.ListarUsuarios))
	mux.HandleFunc("POST /api/mantenimiento/usuarios", admin(usuarios.CrearUsuario))
	mux.HandleFunc("PUT /api/mantenimiento/usuarios/{id}", admin(usuarios.ActualizarActivoUsuario))

	// ── Login/Logout + Muro de comentarios (público) ──────────────────────────
	mux.HandleFunc("POST /api/login", auth.Login)
	mux.HandleFunc("POST /api/logout", auth_(auth.Logout))
	mux.HandleFunc("POST /api/muro", muro.Crear)
	mux.HandleFunc("GET /api/muro", muro.Listar)

	// ── Día a día: registro de envíos por el operario — solo rol operario ────
	// Insertan en envios_operacion (separada de envios); el origen SIEMPRE sale
	// del aeropuerto_iata de la cuenta autenticada, nunca del body.
	mux.HandleFunc("POST /api/operario/envios", soloOperario(operario.Registrar))
	mux.HandleFunc("POST /api/operario/envios/archivo", soloOperario(operario.RegistrarArchivo))
	mux.HandleFunc("GET /api/operario/envios", soloOperario(operario.ListarMisEnvios))
	mux.HandleFunc("PUT /api/operario/envios/{id}", soloOperario(operario.EditarEnvio))

	// ── Interruptor de Día a Día — admin lo enciende, el operario lo lee ──────
	mux.HandleFunc("GET /api/modo-operacion", auth_(modoOp.Estado))
	mux.HandleFunc("PUT /api/modo-operacion", admin(modoOp.Actualizar))

	// ── Simulación de Periodo (orquestación BFF) — solo admin ────────────────
	// Único punto de entrada: recibe fechaInicio+dias+criterio+duracion_real_min
	mux.HandleFunc("POST /api/periodo/iniciar", admin(per.Iniciar))
	mux.HandleFunc("GET /api/periodo/status/{jobId}", admin(per.Status))
	mux.HandleFunc("POST /api/periodo/ejecutar/{jobId}", admin(per.Ejecutar))

	// ── Proxy → Carga Masiva (:8082) — solo admin ─────────────────────────────
	// /api/carga/upload/aeropuertos → /upload/aeropuertos
	cargaProxy := handler.NuevoProxy(cfg.CargaMasivaURL, "/api/carga")
	// Plantillas se descargan con navegación directa del navegador (<a href>), que
	// no puede llevar el header Authorization — se deja pública (solo lectura,
	// sin datos sensibles) y se registra ANTES del prefijo general para que el
	// mux la resuelva primero (patrón más específico).
	mux.HandleFunc("GET /api/carga/plantillas/{kind}", cargaProxy)
	mux.HandleFunc("/api/carga/", admin(cargaProxy))

	// ── Proxy → Planificador (:8084) — solo admin ─────────────────────────────
	// /api/planificacion/* → /api/planificacion/*  (sin cambio de path)
	planProxy := handler.NuevoProxy(cfg.PlanificadorURL, "")
	mux.HandleFunc("/api/planificacion/", admin(planProxy))

	// ── Proxy → Ejecutor (:8083) ─────────────────────────────────────────────
	// SSE: /api/simulacion/eventos → proxy streaming.
	// ponytail: SIN auth por ahora — EventSource del navegador no puede mandar
	// header Authorization, y no vale la pena introducir un esquema de token en
	// query string en esta pasada. Retomar cuando se necesite bloquear lectura
	// del stream en sí (hoy solo arrancar/detener la simulación requiere admin).
	ejSSE := handler.NuevoProxySSE(cfg.EjecutorURL, "")
	mux.HandleFunc("GET /api/simulacion/eventos", ejSSE)
	// REST: /api/simulacion/* (pausar/reanudar/detener) → solo admin
	ejProxy := handler.NuevoProxy(cfg.EjecutorURL, "")
	// Estado es solo-lectura y lo usa también el operario para detectar una sim
	// en curso y suscribir su mapa al SSE; cualquier sesión válida basta.
	mux.HandleFunc("GET /api/simulacion/estado", auth_(ejProxy))
	mux.HandleFunc("/api/simulacion/", admin(ejProxy))

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
