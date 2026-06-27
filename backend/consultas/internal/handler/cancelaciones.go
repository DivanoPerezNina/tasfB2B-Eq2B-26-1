package handler

import (
	"database/sql"
	"net/http"
	"strconv"
)

// CancelacionesHandler sirve las cancelaciones de vuelo de una ventana de tiempo
// desde MySQL (índice idx_cancel_salida). Es la fuente declarativa de
// cancelaciones para el esquema Sa/Sc: el orquestador las pide por ventana y las
// envía al Planificador junto con los envíos.
type CancelacionesHandler struct {
	DB *sql.DB
}

// CancelacionEnvio es la forma que el Planificador necesita para cancelar una
// ocurrencia: ruta (origen→destino) + minuto de salida UTC absoluto.
type CancelacionEnvio struct {
	Origen    string `json:"origen"`
	Destino   string `json:"destino"`
	SalidaUTC int64  `json:"salidaUTC"`
}

// Cancelaciones — GET /cancelaciones?ini=<utc>&fin=<utc>
// Devuelve las cancelaciones cuya salida cae en [ini, fin) ordenadas por salida.
func (h *CancelacionesHandler) Cancelaciones(w http.ResponseWriter, r *http.Request) {
	ini, err1 := strconv.ParseInt(r.URL.Query().Get("ini"), 10, 64)
	fin, err2 := strconv.ParseInt(r.URL.Query().Get("fin"), 10, 64)
	if err1 != nil || err2 != nil || fin <= ini {
		errResp(w, 400, "PARAMS", "Se requieren 'ini' y 'fin' (minutos UTC) con fin>ini")
		return
	}

	rows, err := h.DB.Query(`
		SELECT origen_iata, destino_iata, salida_utc
		FROM cancelaciones
		WHERE salida_utc >= ? AND salida_utc < ?
		ORDER BY salida_utc`, ini, fin)
	if err != nil {
		// Sin validación: si la tabla aún no existe o falla, no hay cancelaciones.
		respond(w, 200, map[string]interface{}{
			"iniUTC": ini, "finUTC": fin, "total": 0, "cancelaciones": []CancelacionEnvio{},
		})
		return
	}
	defer rows.Close()

	lista := make([]CancelacionEnvio, 0, 64)
	for rows.Next() {
		var c CancelacionEnvio
		if err := rows.Scan(&c.Origen, &c.Destino, &c.SalidaUTC); err != nil {
			errResp(w, 500, "SCAN", err.Error())
			return
		}
		lista = append(lista, c)
	}
	if rows.Err() != nil {
		errResp(w, 500, "ROWS", rows.Err().Error())
		return
	}

	respond(w, 200, map[string]interface{}{
		"iniUTC": ini, "finUTC": fin, "total": len(lista), "cancelaciones": lista,
	})
}

// Limpiar — DELETE /cancelaciones
// Vacía la tabla de cancelaciones. El ejecutor la llama al terminar un escenario
// para que las cancelaciones de archivo no se arrastren a la siguiente corrida.
func (h *CancelacionesHandler) Limpiar(w http.ResponseWriter, r *http.Request) {
	if _, err := h.DB.Exec("DELETE FROM cancelaciones"); err != nil {
		// Sin validación: si la tabla no existe, no hay nada que limpiar.
		respond(w, 200, map[string]interface{}{"limpiado": false})
		return
	}
	respond(w, 200, map[string]interface{}{"limpiado": true})
}
