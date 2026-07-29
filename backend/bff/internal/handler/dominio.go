package handler

import (
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"time"
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

// GET /api/dataset — rango de la tabla envios.
// La lectura normal usa dataset_meta para no ejecutar COUNT(*) sobre millones
// de filas cada vez que se abre la pantalla de configuración.
func (h *DominioHandler) Dataset(w http.ResponseWriter, r *http.Request) {
	min, max, total, calculado, cached, err := leerDatasetMeta(h.DB)
	if err != nil {
		errResp(w, 500, "DB_ERROR", err.Error())
		return
	}

	if !cached {
		min, max, total, err = calcularDatasetEnvios(h.DB)
		if err != nil {
			errResp(w, 500, "DB_ERROR", err.Error())
			return
		}
		calculado = time.Now().Format(time.RFC3339)
		// El primer acceso sin metadata puede tardar, pero deja el resultado
		// guardado para que las siguientes peticiones sean inmediatas.
		_ = guardarDatasetMeta(h.DB, min, max, total, calculado)
	}

	ok(w, map[string]interface{}{
		"fecha_min":    min,
		"fecha_max":    max,
		"total_envios": total,
		"calculado_en": calculado,
		"tabla":        "envios",
		"cache":        cached,
	}, "rango de envios")
}

func leerDatasetMeta(db *sql.DB) (min, max string, total int64, calculado string, ok bool, err error) {
	rows, err := db.Query(
		`SELECT clave, valor
		 FROM dataset_meta
		 WHERE clave IN ('fecha_min','fecha_max','total_envios','calculado_en','dataset_fuente')`,
	)
	if err != nil {
		return "", "", 0, "", false, err
	}
	defer rows.Close()

	values := make(map[string]string, 5)
	for rows.Next() {
		var key, value string
		if scanErr := rows.Scan(&key, &value); scanErr != nil {
			return "", "", 0, "", false, scanErr
		}
		values[key] = value
	}
	if rowsErr := rows.Err(); rowsErr != nil {
		return "", "", 0, "", false, rowsErr
	}

	if values["dataset_fuente"] != "envios" {
		return "", "", 0, "", false, nil
	}

	parsedTotal, parseErr := strconv.ParseInt(values["total_envios"], 10, 64)
	if parseErr != nil || parsedTotal < 0 {
		return "", "", 0, "", false, nil
	}

	min = values["fecha_min"]
	max = values["fecha_max"]
	if parsedTotal > 0 && (min == "" || max == "") {
		return "", "", 0, "", false, nil
	}

	return min, max, parsedTotal, values["calculado_en"], true, nil
}

func calcularDatasetEnvios(db *sql.DB) (min, max string, total int64, err error) {
	var fechaMin, fechaMax sql.NullString
	err = db.QueryRow(
		`SELECT DATE_FORMAT(MIN(fecha_registro), '%Y-%m-%d'),
		        DATE_FORMAT(MAX(fecha_registro), '%Y-%m-%d'),
		        COUNT(*)
		 FROM envios`,
	).Scan(&fechaMin, &fechaMax, &total)
	if err != nil {
		return "", "", 0, err
	}
	if fechaMin.Valid {
		min = fechaMin.String
	}
	if fechaMax.Valid {
		max = fechaMax.String
	}
	return min, max, total, nil
}

func guardarDatasetMeta(db *sql.DB, min, max string, total int64, calculado string) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	const upsert = `INSERT INTO dataset_meta (clave, valor) VALUES (?, ?)
		ON DUPLICATE KEY UPDATE valor = VALUES(valor)`
	for _, item := range [][2]string{
		{"fecha_min", min},
		{"fecha_max", max},
		{"total_envios", strconv.FormatInt(total, 10)},
		{"calculado_en", calculado},
		{"dataset_fuente", "envios"},
	} {
		if _, execErr := tx.Exec(upsert, item[0], item[1]); execErr != nil {
			return fmt.Errorf("guardar metadata %s: %w", item[0], execErr)
		}
	}
	return tx.Commit()
}
