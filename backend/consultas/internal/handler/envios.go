package handler

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
)

// EnviosHandler sirve los envíos de una ventana de tiempo desde MySQL,
// aprovechando el índice idx_registro_utc. Es la fuente de datos incremental
// para el esquema Sa/Sc (reemplaza la lectura de archivos del planificador).
type EnviosHandler struct {
	DB *sql.DB
}

// Envio es la forma mínima que el Planificador necesita para planificar.
type Envio struct {
	Origen      string `json:"origen"`
	Destino     string `json:"destino"`
	Maletas     int    `json:"maletas"`
	RegistroUTC int64  `json:"registroUTC"`
	DeadlineUTC int64  `json:"deadlineUTC"`
}

// tablaEnvios resuelve el nombre de tabla a partir de ?modo=, validado contra
// una lista fija (nunca se interpola el valor crudo del query param en el SQL).
// "operacion" → envios_operacion (día a día, se limpia con TRUNCATE entre
// ensayos sin tocar el dataset histórico); cualquier otro valor → envios.
func tablaEnvios(r *http.Request) string {
	if r.URL.Query().Get("modo") == "operacion" {
		return "envios_operacion"
	}
	return "envios"
}

// Envios — GET /envios?ini=<utc>&fin=<utc>&modo=<periodo|operacion>
// Devuelve los envíos registrados en [ini, fin) ordenados por registro_utc.
// modo=operacion lee de envios_operacion (día a día) en vez de envios
// (histórico/proyectado, usado por Periodo y Colapso).
func (h *EnviosHandler) Envios(w http.ResponseWriter, r *http.Request) {
	ini, err1 := strconv.ParseInt(r.URL.Query().Get("ini"), 10, 64)
	fin, err2 := strconv.ParseInt(r.URL.Query().Get("fin"), 10, 64)
	if err1 != nil || err2 != nil || fin <= ini {
		errResp(w, 400, "PARAMS", "Se requieren 'ini' y 'fin' (minutos UTC) con fin>ini")
		return
	}
	tabla := tablaEnvios(r)

	rows, err := h.DB.Query(`
		SELECT origen_iata, destino_iata, cantidad_maletas, registro_utc, deadline_utc
		FROM `+tabla+`
		WHERE registro_utc >= ? AND registro_utc < ?
		ORDER BY registro_utc, origen_iata, id_envio`, ini, fin)
	if err != nil {
		errResp(w, 500, "DB_ERROR", err.Error())
		return
	}
	defer rows.Close()

	envios := make([]Envio, 0, 1024)
	for rows.Next() {
		var e Envio
		if err := rows.Scan(&e.Origen, &e.Destino, &e.Maletas, &e.RegistroUTC, &e.DeadlineUTC); err != nil {
			errResp(w, 500, "SCAN", err.Error())
			return
		}
		envios = append(envios, e)
	}
	if rows.Err() != nil {
		errResp(w, 500, "ROWS", rows.Err().Error())
		return
	}

	respond(w, 200, map[string]interface{}{
		"iniUTC": ini,
		"finUTC": fin,
		"total":  len(envios),
		"envios": envios,
	})
}

func respond(w http.ResponseWriter, code int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(body)
}

func errResp(w http.ResponseWriter, code int, key, msg string) {
	respond(w, code, map[string]string{"error": key, "mensaje": msg})
}
