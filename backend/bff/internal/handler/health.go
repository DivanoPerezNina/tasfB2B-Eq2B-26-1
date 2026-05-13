package handler

import (
	"context"
	"database/sql"
	"net/http"
	"time"
)

type HealthHandler struct {
	DB              *sql.DB
	CargaMasivaURL  string
	PlanificadorURL string
	EjecutorURL     string
}

// GET /api/health — ping a los 4 componentes con timeout de 2s cada uno.
func (h *HealthHandler) Health(w http.ResponseWriter, r *http.Request) {
	resultados := map[string]string{
		"bff":          "ok",
		"mysql":        pingMySQL(h.DB),
		"carga_masiva": pingHTTP(h.CargaMasivaURL + "/health"),
		"planificador": pingHTTP(h.PlanificadorURL + "/api/health"),
		"ejecutor":     pingHTTP(h.EjecutorURL + "/api/health"),
	}

	todoBien := true
	for k, v := range resultados {
		if k != "bff" && v != "ok" {
			todoBien = false
			break
		}
	}

	msg := "todos los servicios operativos"
	if !todoBien {
		msg = "uno o más servicios no responden"
	}

	respond(w, 200, envelope{
		Success: todoBien,
		Data:    resultados,
		Message: msg,
	})
}

func pingMySQL(db *sql.DB) string {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		return "error: " + err.Error()
	}
	return "ok"
}

func pingHTTP(url string) string {
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return "error: " + err.Error()
	}
	resp.Body.Close()
	if resp.StatusCode >= 500 {
		return "error: status " + resp.Status
	}
	return "ok"
}
