package handler

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

// MantenimientoHandler implementa CRUD individual para aeropuertos y vuelos.
// Los "tramos" usan la misma tabla operativa vuelos, porque cada registro de
// vuelo representa exactamente un tramo origen-destino con horario y capacidad.
type MantenimientoHandler struct {
	DB *sql.DB
}

type aeropuertoInput struct {
	IATA             string  `json:"iata"`
	Ciudad           string  `json:"ciudad"`
	Pais             string  `json:"pais"`
	Continente       int     `json:"continente"`
	GMTOffset        int     `json:"gmt_offset"`
	CapacidadAlmacen int     `json:"capacidad_almacen"`
	Lat              float64 `json:"lat"`
	Lng              float64 `json:"lng"`
}

type vueloInput struct {
	OrigenIATA     string `json:"origen_iata"`
	DestinoIATA    string `json:"destino_iata"`
	SalidaMinutos  int    `json:"salida_minutos"`
	LlegadaMinutos int    `json:"llegada_minutos"`
	CapacidadMax   int    `json:"capacidad_max"`
}

func normalizeIATA(value string) string {
	return strings.ToUpper(strings.TrimSpace(value))
}

func parsePathID(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, fmt.Errorf("id inválido")
	}
	return id, nil
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst interface{}) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		errResp(w, http.StatusBadRequest, "BODY_INVALIDO", "JSON inválido: "+err.Error())
		return false
	}
	return true
}

func validateAeropuerto(in *aeropuertoInput, creating bool) error {
	in.IATA = normalizeIATA(in.IATA)
	in.Ciudad = strings.TrimSpace(in.Ciudad)
	in.Pais = strings.TrimSpace(in.Pais)
	if creating && (len(in.IATA) < 3 || len(in.IATA) > 4) {
		return fmt.Errorf("IATA debe tener 3 o 4 caracteres")
	}
	if in.Ciudad == "" || in.Pais == "" {
		return fmt.Errorf("ciudad y país son obligatorios")
	}
	if in.Continente < 1 || in.Continente > 3 {
		return fmt.Errorf("continente debe ser 1, 2 o 3")
	}
	if in.GMTOffset < -12 || in.GMTOffset > 14 {
		return fmt.Errorf("gmt_offset debe estar entre -12 y 14")
	}
	if in.CapacidadAlmacen <= 0 || in.CapacidadAlmacen > 65535 {
		return fmt.Errorf("capacidad_almacen debe ser mayor que cero")
	}
	if in.Lat < -90 || in.Lat > 90 || in.Lng < -180 || in.Lng > 180 {
		return fmt.Errorf("latitud o longitud fuera de rango")
	}
	return nil
}

func validateVuelo(in *vueloInput) error {
	in.OrigenIATA = normalizeIATA(in.OrigenIATA)
	in.DestinoIATA = normalizeIATA(in.DestinoIATA)
	if in.OrigenIATA == "" || in.DestinoIATA == "" {
		return fmt.Errorf("origen y destino son obligatorios")
	}
	if in.OrigenIATA == in.DestinoIATA {
		return fmt.Errorf("origen y destino deben ser distintos")
	}
	if in.SalidaMinutos < 0 || in.SalidaMinutos > 1439 || in.LlegadaMinutos < 0 || in.LlegadaMinutos > 1439 {
		return fmt.Errorf("salida_minutos y llegada_minutos deben estar entre 0 y 1439")
	}
	if in.CapacidadMax <= 0 || in.CapacidadMax > 65535 {
		return fmt.Errorf("capacidad_max debe ser mayor que cero")
	}
	return nil
}

// CrearAeropuerto — POST /api/mantenimiento/aeropuertos
func (h *MantenimientoHandler) CrearAeropuerto(w http.ResponseWriter, r *http.Request) {
	var in aeropuertoInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if err := validateAeropuerto(&in, true); err != nil {
		errResp(w, http.StatusBadRequest, "VALIDACION", err.Error())
		return
	}

	tx, err := h.DB.Begin()
	if err != nil {
		errResp(w, 500, "DB_ERROR", err.Error())
		return
	}
	defer tx.Rollback()

	var id int
	if err := tx.QueryRow(`SELECT COALESCE(MAX(id),0)+1 FROM aeropuertos`).Scan(&id); err != nil {
		errResp(w, 500, "DB_ERROR", err.Error())
		return
	}
	_, err = tx.Exec(`INSERT INTO aeropuertos
		(id, iata, ciudad, pais, alias, gmt_offset, capacidad_almacen, latitud, longitud, continente)
		VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?)`,
		id, in.IATA, in.Ciudad, in.Pais, in.GMTOffset, in.CapacidadAlmacen, in.Lat, in.Lng, in.Continente)
	if err != nil {
		errResp(w, http.StatusConflict, "CREACION_FALLIDA", err.Error())
		return
	}
	if err := tx.Commit(); err != nil {
		errResp(w, 500, "DB_ERROR", err.Error())
		return
	}
	ok(w, map[string]interface{}{"id": id, "iata": in.IATA}, "Aeropuerto creado")
}

// ActualizarAeropuerto — PUT /api/mantenimiento/aeropuertos/{id}
// El IATA se conserva para no romper vuelos y envíos históricos relacionados.
func (h *MantenimientoHandler) ActualizarAeropuerto(w http.ResponseWriter, r *http.Request) {
	id, err := parsePathID(r)
	if err != nil {
		errResp(w, 400, "ID_INVALIDO", err.Error())
		return
	}
	var in aeropuertoInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if err := validateAeropuerto(&in, false); err != nil {
		errResp(w, http.StatusBadRequest, "VALIDACION", err.Error())
		return
	}
	res, err := h.DB.Exec(`UPDATE aeropuertos SET ciudad=?, pais=?, continente=?, gmt_offset=?,
		capacidad_almacen=?, latitud=?, longitud=? WHERE id=?`,
		in.Ciudad, in.Pais, in.Continente, in.GMTOffset, in.CapacidadAlmacen, in.Lat, in.Lng, id)
	if err != nil {
		errResp(w, 500, "ACTUALIZACION_FALLIDA", err.Error())
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		errResp(w, 404, "NO_ENCONTRADO", "Aeropuerto no encontrado")
		return
	}
	ok(w, map[string]interface{}{"id": id}, "Aeropuerto actualizado")
}

// EliminarAeropuerto — DELETE /api/mantenimiento/aeropuertos/{id}
func (h *MantenimientoHandler) EliminarAeropuerto(w http.ResponseWriter, r *http.Request) {
	id, err := parsePathID(r)
	if err != nil {
		errResp(w, 400, "ID_INVALIDO", err.Error())
		return
	}
	var iata string
	if err := h.DB.QueryRow(`SELECT iata FROM aeropuertos WHERE id=?`, id).Scan(&iata); err != nil {
		if err == sql.ErrNoRows {
			errResp(w, 404, "NO_ENCONTRADO", "Aeropuerto no encontrado")
		} else {
			errResp(w, 500, "DB_ERROR", err.Error())
		}
		return
	}
	var refs int
	if err := h.DB.QueryRow(`SELECT
		(SELECT COUNT(*) FROM vuelos WHERE origen_iata=? OR destino_iata=?) +
		(SELECT COUNT(*) FROM envios WHERE origen_iata=? OR destino_iata=?)`,
		iata, iata, iata, iata).Scan(&refs); err != nil {
		errResp(w, 500, "DB_ERROR", err.Error())
		return
	}
	if refs > 0 {
		errResp(w, http.StatusConflict, "AEROPUERTO_EN_USO", "No se puede eliminar: tiene vuelos o envíos relacionados")
		return
	}
	if _, err := h.DB.Exec(`DELETE FROM aeropuertos WHERE id=?`, id); err != nil {
		errResp(w, 500, "ELIMINACION_FALLIDA", err.Error())
		return
	}
	ok(w, map[string]interface{}{"id": id, "iata": iata}, "Aeropuerto eliminado")
}

func (h *MantenimientoHandler) continentesRuta(origen, destino string) (bool, error) {
	var co, cd int
	if err := h.DB.QueryRow(`SELECT continente FROM aeropuertos WHERE iata=?`, origen).Scan(&co); err != nil {
		return false, fmt.Errorf("aeropuerto origen no existe")
	}
	if err := h.DB.QueryRow(`SELECT continente FROM aeropuertos WHERE iata=?`, destino).Scan(&cd); err != nil {
		return false, fmt.Errorf("aeropuerto destino no existe")
	}
	return co == cd, nil
}

// CrearVuelo — POST /api/mantenimiento/vuelos o /tramos
func (h *MantenimientoHandler) CrearVuelo(w http.ResponseWriter, r *http.Request) {
	var in vueloInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if err := validateVuelo(&in); err != nil {
		errResp(w, 400, "VALIDACION", err.Error())
		return
	}
	mismo, err := h.continentesRuta(in.OrigenIATA, in.DestinoIATA)
	if err != nil {
		errResp(w, 400, "AEROPUERTO_INVALIDO", err.Error())
		return
	}
	res, err := h.DB.Exec(`INSERT INTO vuelos
		(origen_iata, destino_iata, salida_minutos, llegada_minutos, capacidad_max, mismo_continente)
		VALUES (?, ?, ?, ?, ?, ?)`,
		in.OrigenIATA, in.DestinoIATA, in.SalidaMinutos, in.LlegadaMinutos, in.CapacidadMax, mismo)
	if err != nil {
		errResp(w, 500, "CREACION_FALLIDA", err.Error())
		return
	}
	id, _ := res.LastInsertId()
	ok(w, map[string]interface{}{"id": id}, "Vuelo/tramo creado")
}

// ActualizarVuelo — PUT /api/mantenimiento/vuelos/{id} o /tramos/{id}
func (h *MantenimientoHandler) ActualizarVuelo(w http.ResponseWriter, r *http.Request) {
	id, err := parsePathID(r)
	if err != nil {
		errResp(w, 400, "ID_INVALIDO", err.Error())
		return
	}
	var in vueloInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if err := validateVuelo(&in); err != nil {
		errResp(w, 400, "VALIDACION", err.Error())
		return
	}
	mismo, err := h.continentesRuta(in.OrigenIATA, in.DestinoIATA)
	if err != nil {
		errResp(w, 400, "AEROPUERTO_INVALIDO", err.Error())
		return
	}
	res, err := h.DB.Exec(`UPDATE vuelos SET origen_iata=?, destino_iata=?, salida_minutos=?,
		llegada_minutos=?, capacidad_max=?, mismo_continente=? WHERE id=?`,
		in.OrigenIATA, in.DestinoIATA, in.SalidaMinutos, in.LlegadaMinutos, in.CapacidadMax, mismo, id)
	if err != nil {
		errResp(w, 500, "ACTUALIZACION_FALLIDA", err.Error())
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		errResp(w, 404, "NO_ENCONTRADO", "Vuelo/tramo no encontrado")
		return
	}
	ok(w, map[string]interface{}{"id": id}, "Vuelo/tramo actualizado")
}

// EliminarVuelo — DELETE /api/mantenimiento/vuelos/{id} o /tramos/{id}
func (h *MantenimientoHandler) EliminarVuelo(w http.ResponseWriter, r *http.Request) {
	id, err := parsePathID(r)
	if err != nil {
		errResp(w, 400, "ID_INVALIDO", err.Error())
		return
	}
	res, err := h.DB.Exec(`DELETE FROM vuelos WHERE id=?`, id)
	if err != nil {
		errResp(w, 500, "ELIMINACION_FALLIDA", err.Error())
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		errResp(w, 404, "NO_ENCONTRADO", "Vuelo/tramo no encontrado")
		return
	}
	ok(w, map[string]interface{}{"id": id}, "Vuelo/tramo eliminado")
}
