package handler

import (
	"database/sql"
	"net/http"
)

// VuelosHandler sirve el catálogo de rutas al Planificador. Existe por la
// misma razón que EnviosHandler: el planificador no toca la BD, recibe los
// datos en el body de /desde-datos.
//
// Históricamente el planificador leía las rutas de un archivo en disco
// (/tmp/tasf/vuelos.txt), lo que hacía imposible que el día a día usara un
// catálogo distinto al de la simulación. Este endpoint es lo que permite
// separarlos.
type VuelosHandler struct {
	DB *sql.DB
}

// Vuelo es la forma mínima que el Planificador necesita para armar la red.
// Los minutos son LOCALES (del origen y del destino respectivamente): el
// planificador los convierte a UTC con el gmt_offset de cada aeropuerto,
// igual que hacía al parsear el archivo.
type Vuelo struct {
	Origen    string `json:"origen"`
	Destino   string `json:"destino"`
	Salida    int    `json:"salida"`
	Llegada   int    `json:"llegada"`
	Capacidad int    `json:"capacidad"`
}

// tablaVuelos resuelve el nombre de tabla a partir de ?modo=, validado contra
// una lista fija (nunca se interpola el valor crudo del query param en el SQL).
// "operacion" → vuelos_operacion (día a día); cualquier otro valor → vuelos.
func tablaVuelos(r *http.Request) string {
	if r.URL.Query().Get("modo") == "operacion" {
		return "vuelos_operacion"
	}
	return "vuelos"
}

// Vuelos — GET /vuelos?modo=<periodo|operacion>
// Devuelve el catálogo completo de rutas (no hay ventana de tiempo: los
// vuelos son un patrón diario que se repite, no eventos fechados).
func (h *VuelosHandler) Vuelos(w http.ResponseWriter, r *http.Request) {
	tabla := tablaVuelos(r)

	rows, err := h.DB.Query(`
		SELECT origen_iata, destino_iata, salida_minutos, llegada_minutos, capacidad_max
		FROM ` + tabla + `
		ORDER BY origen_iata, destino_iata, salida_minutos, llegada_minutos, id`)
	if err != nil {
		errResp(w, 500, "DB_ERROR", err.Error())
		return
	}
	defer rows.Close()

	vuelos := make([]Vuelo, 0, 2048)
	for rows.Next() {
		var v Vuelo
		if err := rows.Scan(&v.Origen, &v.Destino, &v.Salida, &v.Llegada, &v.Capacidad); err != nil {
			errResp(w, 500, "SCAN", err.Error())
			return
		}
		vuelos = append(vuelos, v)
	}
	if rows.Err() != nil {
		errResp(w, 500, "ROWS", rows.Err().Error())
		return
	}

	respond(w, 200, map[string]interface{}{
		"total":  len(vuelos),
		"vuelos": vuelos,
	})
}
