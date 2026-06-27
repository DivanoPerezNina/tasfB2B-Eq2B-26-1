// Servicio de Consultas — fuente de datos incremental para el esquema Sa/Sc.
// Consulta los envíos de una ventana de tiempo desde MySQL (índice
// idx_registro_utc) y los entrega al Planificador, evitando que la JVM lea
// archivos o cargue todo el dataset (menos RAM en la VM).
package main

import (
	"log"
	"net/http"

	"github.com/tasfb2b/consultas/internal/config"
	dbpkg "github.com/tasfb2b/consultas/internal/db"
	"github.com/tasfb2b/consultas/internal/handler"
)

func main() {
	cfg := config.Load()

	database, err := dbpkg.Open(cfg.DSN())
	if err != nil {
		log.Fatalf("No se pudo conectar a MySQL: %v", err)
	}
	defer database.Close()
	log.Printf("MySQL conectado en %s:%s/%s", cfg.DBHost, cfg.DBPort, cfg.DBName)

	env := &handler.EnviosHandler{DB: database}
	cancel := &handler.CancelacionesHandler{DB: database}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /envios", env.Envios)
	mux.HandleFunc("GET /cancelaciones", cancel.Cancelaciones)
	mux.HandleFunc("DELETE /cancelaciones", cancel.Limpiar)
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok","service":"consultas"}`))
	})

	addr := ":" + cfg.Port
	log.Printf("Consultas escuchando en %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("ListenAndServe: %v", err)
	}
}
