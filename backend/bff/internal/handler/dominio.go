package handler

import (
	"database/sql"
	"net/http"
)

// DominioHandler sirve aeropuertos, vuelos y dataset directo desde MySQL.
type DominioHandler struct {
	DB *sql.DB
}

// GET /api/aeropuertos
func (h *DominioHandler) Aeropuertos(w http.ResponseWriter, r *http.Request) {
	rows, err := h.DB.Query(
		`SELECT id, iata, ciudad, pais, continente, gmt_offset,
		        capacidad_almacen, latitud, longitud
		 FROM aeropuertos ORDER BY id`)
	if err != nil {
		errResp(w, 500, "DB_ERROR", err.Error())
		return
	}
	defer rows.Close()

	type Aero struct {
		ID               int     `json:"id"`
		IATA             string  `json:"iata"`
		Ciudad           string  `json:"ciudad"`
		Pais             string  `json:"pais"`
		Continente       int     `json:"continente"`
		GMTOffset        int     `json:"gmt_offset"`
		CapacidadAlmacen int     `json:"capacidad_almacen"`
		Lat              float64 `json:"lat"`
		Lng              float64 `json:"lng"`
	}

	var lista []Aero
	for rows.Next() {
		var a Aero
		if err := rows.Scan(&a.ID, &a.IATA, &a.Ciudad, &a.Pais,
			&a.Continente, &a.GMTOffset, &a.CapacidadAlmacen,
			&a.Lat, &a.Lng); err != nil {
			errResp(w, 500, "SCAN_ERROR", err.Error())
			return
		}
		lista = append(lista, a)
	}
	if rows.Err() != nil {
		errResp(w, 500, "ROWS_ERROR", rows.Err().Error())
		return
	}
	if lista == nil {
		lista = []Aero{}
	}
	msg := "aeropuertos cargados desde base de datos"
	if len(lista) == 0 {
		msg = "no hay aeropuertos en BD, cargue datos en /configuracion"
	}
	ok(w, lista, msg)
}

// GET /api/vuelos
func (h *DominioHandler) Vuelos(w http.ResponseWriter, r *http.Request) {
	rows, err := h.DB.Query(
		`SELECT id, origen_iata, destino_iata, salida_minutos,
		        llegada_minutos, capacidad_max, mismo_continente
		 FROM vuelos ORDER BY id`)
	if err != nil {
		errResp(w, 500, "DB_ERROR", err.Error())
		return
	}
	defer rows.Close()

	type Vuelo struct {
		ID              int    `json:"id"`
		OrigenIATA      string `json:"origen_iata"`
		DestinoIATA     string `json:"destino_iata"`
		SalidaMinutos   int    `json:"salida_minutos"`
		LlegadaMinutos  int    `json:"llegada_minutos"`
		CapacidadMax    int    `json:"capacidad_max"`
		MismoContinente bool   `json:"mismo_continente"`
	}

	var lista []Vuelo
	for rows.Next() {
		var v Vuelo
		var mismo int
		if err := rows.Scan(&v.ID, &v.OrigenIATA, &v.DestinoIATA,
			&v.SalidaMinutos, &v.LlegadaMinutos, &v.CapacidadMax, &mismo); err != nil {
			errResp(w, 500, "SCAN_ERROR", err.Error())
			return
		}
		v.MismoContinente = mismo == 1
		lista = append(lista, v)
	}
	if rows.Err() != nil {
		errResp(w, 500, "ROWS_ERROR", rows.Err().Error())
		return
	}
	if lista == nil {
		lista = []Vuelo{}
	}
	msg := "vuelos cargados desde base de datos"
	if len(lista) == 0 {
		msg = "no hay vuelos en BD, cargue datos en /configuracion"
	}
	ok(w, lista, msg)
}

// GET /api/dataset — rango de fechas del dataset
func (h *DominioHandler) Dataset(w http.ResponseWriter, r *http.Request) {
	rows, err := h.DB.Query(
		`SELECT clave, valor FROM dataset_meta
		 WHERE clave IN ('fecha_min','fecha_max','total_envios')`)
	if err != nil {
		errResp(w, 500, "DB_ERROR", err.Error())
		return
	}
	defer rows.Close()

	m := make(map[string]string)
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			continue
		}
		m[k] = v
	}

	ok(w, map[string]interface{}{
		"fecha_min":    m["fecha_min"],
		"fecha_max":    m["fecha_max"],
		"total_envios": m["total_envios"],
	}, "rango del dataset")
}
