package main

import (
	"log"
	"net/http"
	"strings"

	"github.com/tasfb2b/carga-masiva/internal/config"
	dbpkg "github.com/tasfb2b/carga-masiva/internal/db"
	"github.com/tasfb2b/carga-masiva/internal/handler"
)

func main() {
	cfg := config.Load()

	database, err := dbpkg.Open(cfg.DSN())
	if err != nil {
		log.Fatalf("No se pudo conectar a MySQL: %v", err)
	}
	defer database.Close()
	log.Printf("MySQL conectado en %s:%s/%s", cfg.DBHost, cfg.DBPort, cfg.DBName)

	upload := &handler.UploadHandler{
		DB:        database,
		TempDir:   cfg.TempDir,
		BatchSize: cfg.BatchSize,
		MaxBytes:  cfg.MaxUploadMB * 1024 * 1024,
	}
	estado := &handler.EstadoHandler{DB: database}

	mux := http.NewServeMux()

	// Carga de archivos
	mux.HandleFunc("POST /upload/aeropuertos", upload.Aeropuertos)
	mux.HandleFunc("POST /upload/vuelos", upload.Vuelos)
	mux.HandleFunc("POST /upload/envios", upload.Envios)
	mux.HandleFunc("POST /upload/cancelaciones", upload.Cancelaciones)
	mux.HandleFunc("DELETE /upload/cancelaciones", upload.LimpiarCancelaciones)
	mux.HandleFunc("GET /upload/sesion/", upload.Sesion)

	// Estado y plantillas
	mux.HandleFunc("GET /estado", estado.Estado)
	mux.HandleFunc("GET /plantillas/", estado.Plantilla)

	// Dataset meta
	mux.HandleFunc("POST /dataset/recalcular", estado.RecalcularDataset)

	// Borrado
	mux.HandleFunc("DELETE /datos", upload.EliminarDatos)

	// Health
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok","service":"carga-masiva"}`))
	})

	// CORS para desarrollo local
	corsMiddleware := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin == "" {
				origin = "*"
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Confirmar-Borrado")
			if strings.ToUpper(r.Method) == "OPTIONS" {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}

	addr := ":" + cfg.Port
	log.Printf("Carga Masiva escuchando en %s (temp: %s)", addr, cfg.TempDir)
	if err := http.ListenAndServe(addr, corsMiddleware(mux)); err != nil {
		log.Fatalf("ListenAndServe: %v", err)
	}
}
