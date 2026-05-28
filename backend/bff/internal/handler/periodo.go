package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
)

// PeriodoHandler orquesta el flujo completo de "Simulación de Periodo":
//  1. Recibe todos los parámetros del usuario de una vez.
//  2. Llama al Planificador y devuelve el jobId para polling.
//  3. Cuando el plan está listo, llama al Ejecutor con la duración guardada.
type PeriodoHandler struct {
	PlanificadorURL string
	EjecutorURL     string

	mu    sync.Mutex
	jobs  map[string]*periodoJob // jobId → parámetros guardados
}

type periodoJob struct {
	DuracionRealMin float64
	Umbrales        umbralesReq
}

type umbralesReq struct {
	VerdeHasta float64 `json:"verde_hasta"`
	AmbarHasta float64 `json:"ambar_hasta"`
}

// ── POST /api/periodo/iniciar ─────────────────────────────────────────────────
//
// Body:
//
//	{
//	  "fechaInicio":      "2026-01-15T08:30",   // YYYY-MM-DD o YYYY-MM-DDTHH:MM
//	  "dias":             7,              // 3 | 5 | 7
//	  "criterio":         "EDF",          // EDF | FIFO | ALEATORIO
//	  "semilla":          42,             // opcional
//	  "duracion_real_min": 60,            // 30 | 45 | 60 | 90
//	  "umbrales": { "verde_hasta": 0.60, "ambar_hasta": 0.85 }  // opcional
//	}
//
// Responde 202 con { "job_id": "...", "estado": "EN_PROCESO",
//
//	"duracion_real_min": 60, "velocidad_efectiva": "2.80" }
func (h *PeriodoHandler) Iniciar(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FechaInicio     string      `json:"fechaInicio"`
		Dias            int         `json:"dias"`
		Criterio        string      `json:"criterio"`
		Semilla         int64       `json:"semilla"`
		DuracionRealMin float64     `json:"duracion_real_min"`
		Umbrales        umbralesReq `json:"umbrales"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		errResp(w, 400, "BODY_INVALIDO", err.Error())
		return
	}

	// Validaciones básicas
	if body.FechaInicio == "" {
		errResp(w, 400, "PARAM_FALTANTE", "Se requiere 'fechaInicio' (YYYY-MM-DD o YYYY-MM-DDTHH:MM)")
		return
	}
	if body.Dias < 1 || body.Dias > 30 {
		errResp(w, 400, "PARAM_INVALIDO", "'dias' debe estar entre 1 y 30")
		return
	}
	if body.DuracionRealMin <= 0 {
		errResp(w, 400, "PARAM_FALTANTE", "Se requiere 'duracion_real_min' (30-90 minutos)")
		return
	}
	if body.DuracionRealMin < 30 || body.DuracionRealMin > 90 {
		errResp(w, 400, "PARAM_INVALIDO", "'duracion_real_min' debe estar entre 30 y 90 minutos")
		return
	}

	// Defaults
	if body.Criterio == "" {
		body.Criterio = "EDF"
	}
	if body.Semilla == 0 {
		body.Semilla = 42
	}
	if body.Umbrales.VerdeHasta == 0 {
		body.Umbrales.VerdeHasta = 0.60
	}
	if body.Umbrales.AmbarHasta == 0 {
		body.Umbrales.AmbarHasta = 0.85
	}

	// Llamar al Planificador
	planBody := map[string]interface{}{
		"fechaInicio": body.FechaInicio,
		"dias":        body.Dias,
		"criterio":    body.Criterio,
		"semilla":     body.Semilla,
	}
	raw, _ := json.Marshal(planBody)

	resp, err := http.Post(
		h.PlanificadorURL+"/api/planificacion/iniciar",
		"application/json",
		bytes.NewReader(raw),
	)
	if err != nil {
		errResp(w, 502, "PLANIFICADOR_INALCANZABLE", err.Error())
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 202 {
		errResp(w, resp.StatusCode, "PLANIFICADOR_ERROR", string(respBody))
		return
	}

	var planResp struct {
		JobID  string `json:"jobId"`
		Estado string `json:"estado"`
	}
	if err := json.Unmarshal(respBody, &planResp); err != nil || planResp.JobID == "" {
		errResp(w, 502, "PLANIFICADOR_RESPUESTA_INVALIDA",
			fmt.Sprintf("No se pudo parsear jobId: %s", respBody))
		return
	}

	// Guardar duración y umbrales asociados al jobId
	h.mu.Lock()
	if h.jobs == nil {
		h.jobs = make(map[string]*periodoJob)
	}
	h.jobs[planResp.JobID] = &periodoJob{
		DuracionRealMin: body.DuracionRealMin,
		Umbrales:        body.Umbrales,
	}
	h.mu.Unlock()

	// Velocidad efectiva para informar al cliente
	velocidad := float64(body.Dias*1440) / (body.DuracionRealMin * 60.0)

	ok(w, map[string]interface{}{
		"job_id":             planResp.JobID,
		"estado":             planResp.Estado,
		"fecha_inicio":       body.FechaInicio,
		"dias":               body.Dias,
		"criterio":           body.Criterio,
		"duracion_real_min":  body.DuracionRealMin,
		"velocidad_efectiva": fmt.Sprintf("%.2f", velocidad),
	}, fmt.Sprintf("Planificación iniciada — %d días desde %s, simulación durará %.0f min reales (%.2f×)",
		body.Dias, body.FechaInicio, body.DuracionRealMin, velocidad))
}

// ── GET /api/periodo/status/{jobId} ──────────────────────────────────────────
//
// Hace proxy del status al Planificador y agrega la info de duración guardada.
func (h *PeriodoHandler) Status(w http.ResponseWriter, r *http.Request) {
	jobId := r.PathValue("jobId")
	if jobId == "" {
		errResp(w, 400, "PARAM_FALTANTE", "Se requiere jobId en la ruta")
		return
	}

	resp, err := http.Get(h.PlanificadorURL + "/api/planificacion/status/" + jobId)
	if err != nil {
		errResp(w, 502, "PLANIFICADOR_INALCANZABLE", err.Error())
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	// Agregar duracion_real_min al response si tenemos el job guardado
	h.mu.Lock()
	job := h.jobs[jobId]
	h.mu.Unlock()

	if job != nil {
		// Parsear el JSON del planificador y enriquecerlo
		var statusData map[string]interface{}
		if err := json.Unmarshal(body, &statusData); err == nil {
			statusData["duracion_real_min"] = job.DuracionRealMin
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(resp.StatusCode)
			json.NewEncoder(w).Encode(statusData)
			return
		}
	}

	// Fallback: reenviar respuesta tal cual
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(body)
}

// ── POST /api/periodo/ejecutar/{jobId} ───────────────────────────────────────
//
// Llama al Ejecutor con la duración y umbrales guardados al iniciar el periodo.
// No requiere body — todos los parámetros ya se guardaron en Iniciar.
func (h *PeriodoHandler) Ejecutar(w http.ResponseWriter, r *http.Request) {
	jobId := r.PathValue("jobId")
	if jobId == "" {
		errResp(w, 400, "PARAM_FALTANTE", "Se requiere jobId en la ruta")
		return
	}

	h.mu.Lock()
	job := h.jobs[jobId]
	h.mu.Unlock()

	if job == nil {
		errResp(w, 404, "JOB_NO_ENCONTRADO",
			fmt.Sprintf("No se encontró job '%s'. ¿Fue iniciado por /api/periodo/iniciar?", jobId))
		return
	}

	// Construir request al Ejecutor
	ejBody := map[string]interface{}{
		"job_id":           jobId,
		"duracion_real_min": job.DuracionRealMin,
		"umbrales": map[string]float64{
			"verde_hasta": job.Umbrales.VerdeHasta,
			"ambar_hasta": job.Umbrales.AmbarHasta,
		},
	}
	raw, _ := json.Marshal(ejBody)

	resp, err := http.Post(
		h.EjecutorURL+"/api/simulacion/iniciar",
		"application/json",
		bytes.NewReader(raw),
	)
	if err != nil {
		errResp(w, 502, "EJECUTOR_INALCANZABLE", err.Error())
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	var ejResp map[string]interface{}
	if err := json.Unmarshal(respBody, &ejResp); err == nil {
		ejResp["duracion_real_min"] = job.DuracionRealMin
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.StatusCode)
		json.NewEncoder(w).Encode(ejResp)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(respBody)
}
