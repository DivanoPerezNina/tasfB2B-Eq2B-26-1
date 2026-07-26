package handler

import (
	"bufio"
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

// RutasOperarioHandler es el mantenimiento de vuelos_operacion (las rutas del
// día a día). Separada de `vuelos` a propósito: las rutas que cargan los
// operarios para el ensayo no deben mezclarse con el catálogo de Periodo y
// Colapso.
//
// Cada operario trabaja solo con rutas cuyo ORIGEN es su aeropuerto asignado.
// Esto evita que la pantalla de SABE muestre rutas de SPIM o viceversa durante
// las pruebas con varias pestañas/usuarios.
type RutasOperarioHandler struct {
	DB *sql.DB
}

type rutaInput struct {
	OrigenIATA     string `json:"origen_iata"`
	DestinoIATA    string `json:"destino_iata"`
	SalidaMinutos  int    `json:"salida_minutos"`
	LlegadaMinutos int    `json:"llegada_minutos"`
	CapacidadMax   int    `json:"capacidad_max"`
}

func validarRuta(in *rutaInput) error {
	in.OrigenIATA = normalizeIATA(in.OrigenIATA)
	in.DestinoIATA = normalizeIATA(in.DestinoIATA)
	if in.OrigenIATA == "" || in.DestinoIATA == "" {
		return fmt.Errorf("origen y destino son obligatorios")
	}
	if in.OrigenIATA == in.DestinoIATA {
		return fmt.Errorf("origen y destino deben ser distintos")
	}
	if in.SalidaMinutos < 0 || in.SalidaMinutos > 1439 {
		return fmt.Errorf("la hora de salida debe estar entre 00:00 y 23:59")
	}
	// La llegada puede pasar de 1440 si el vuelo cruza medianoche (hasta +1 día).
	if in.LlegadaMinutos < 0 || in.LlegadaMinutos > 2879 {
		return fmt.Errorf("la hora de llegada está fuera de rango")
	}
	if in.CapacidadMax <= 0 || in.CapacidadMax > 65535 {
		return fmt.Errorf("la capacidad debe ser mayor que cero")
	}
	return nil
}

// continentesDe resuelve si origen y destino comparten continente (lo necesita
// el planificador para las ventanas de entrega de 1 vs 2 días).
func (h *RutasOperarioHandler) continentesDe(origen, destino string) (bool, error) {
	var co, cd int
	if err := h.DB.QueryRow(`SELECT continente FROM aeropuertos WHERE iata=?`, origen).Scan(&co); err != nil {
		return false, fmt.Errorf("el aeropuerto de origen %s no existe", origen)
	}
	if err := h.DB.QueryRow(`SELECT continente FROM aeropuertos WHERE iata=?`, destino).Scan(&cd); err != nil {
		return false, fmt.Errorf("el aeropuerto de destino %s no existe", destino)
	}
	return co == cd, nil
}

// Listar — GET /api/operario/rutas
func (h *RutasOperarioHandler) Listar(w http.ResponseWriter, r *http.Request) {
	u, ok_ := UsuarioDeContexto(r)
	if !ok_ || u.AeropuertoIATA == nil {
		errResp(w, 403, "SIN_AEROPUERTO", "Tu cuenta no tiene un aeropuerto asignado")
		return
	}

	rows, err := h.DB.Query(`SELECT id, origen_iata, destino_iata, salida_minutos,
		llegada_minutos, capacidad_max, mismo_continente
		FROM vuelos_operacion WHERE origen_iata = ? ORDER BY salida_minutos, destino_iata`, *u.AeropuertoIATA)
	if err != nil {
		errResp(w, 500, "DB_ERROR", err.Error())
		return
	}
	defer rows.Close()

	rutas := []map[string]interface{}{}
	for rows.Next() {
		var id, salida, llegada, capacidad int
		var origen, destino string
		var mismoCont bool
		if err := rows.Scan(&id, &origen, &destino, &salida, &llegada, &capacidad, &mismoCont); err != nil {
			errResp(w, 500, "DB_ERROR", err.Error())
			return
		}
		rutas = append(rutas, map[string]interface{}{
			"id": id, "origen_iata": origen, "destino_iata": destino,
			"salida_minutos": salida, "llegada_minutos": llegada,
			"capacidad_max": capacidad, "mismo_continente": mismoCont,
		})
	}
	ok(w, rutas, "")
}

// Crear — POST /api/operario/rutas
func (h *RutasOperarioHandler) Crear(w http.ResponseWriter, r *http.Request) {
	u, ok_ := UsuarioDeContexto(r)
	if !ok_ || u.AeropuertoIATA == nil {
		errResp(w, 403, "SIN_AEROPUERTO", "Tu cuenta no tiene un aeropuerto asignado")
		return
	}

	var in rutaInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if err := validarRuta(&in); err != nil {
		errResp(w, http.StatusBadRequest, "VALIDACION", err.Error())
		return
	}
	if in.OrigenIATA != *u.AeropuertoIATA {
		errResp(w, http.StatusForbidden, "ORIGEN_NO_PERMITIDO",
			fmt.Sprintf("Tu usuario solo puede crear rutas con origen %s", *u.AeropuertoIATA))
		return
	}
	mismoCont, err := h.continentesDe(in.OrigenIATA, in.DestinoIATA)
	if err != nil {
		errResp(w, http.StatusBadRequest, "AEROPUERTO_INVALIDO", err.Error())
		return
	}
	res, err := h.DB.Exec(`INSERT INTO vuelos_operacion
		(origen_iata, destino_iata, salida_minutos, llegada_minutos, capacidad_max, mismo_continente, operario_id)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		in.OrigenIATA, in.DestinoIATA, in.SalidaMinutos, in.LlegadaMinutos,
		in.CapacidadMax, mismoCont, u.ID)
	if err != nil {
		errResp(w, 500, "CREACION_FALLIDA", err.Error())
		return
	}
	id, _ := res.LastInsertId()
	ok(w, map[string]interface{}{"id": id}, "Ruta creada")
}

// Actualizar — PUT /api/operario/rutas/{id}
func (h *RutasOperarioHandler) Actualizar(w http.ResponseWriter, r *http.Request) {
	u, ok_ := UsuarioDeContexto(r)
	if !ok_ || u.AeropuertoIATA == nil {
		errResp(w, 403, "SIN_AEROPUERTO", "Tu cuenta no tiene un aeropuerto asignado")
		return
	}

	id, err := parsePathID(r)
	if err != nil {
		errResp(w, 400, "ID_INVALIDO", err.Error())
		return
	}
	var in rutaInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if err := validarRuta(&in); err != nil {
		errResp(w, http.StatusBadRequest, "VALIDACION", err.Error())
		return
	}
	if in.OrigenIATA != *u.AeropuertoIATA {
		errResp(w, http.StatusForbidden, "ORIGEN_NO_PERMITIDO",
			fmt.Sprintf("Tu usuario solo puede editar rutas con origen %s", *u.AeropuertoIATA))
		return
	}
	mismoCont, err := h.continentesDe(in.OrigenIATA, in.DestinoIATA)
	if err != nil {
		errResp(w, http.StatusBadRequest, "AEROPUERTO_INVALIDO", err.Error())
		return
	}
	res, err := h.DB.Exec(`UPDATE vuelos_operacion SET destino_iata=?,
		salida_minutos=?, llegada_minutos=?, capacidad_max=?, mismo_continente=?
		WHERE id=? AND origen_iata=?`,
		in.DestinoIATA, in.SalidaMinutos, in.LlegadaMinutos,
		in.CapacidadMax, mismoCont, id, *u.AeropuertoIATA)
	if err != nil {
		errResp(w, 500, "ACTUALIZACION_FALLIDA", err.Error())
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		errResp(w, 404, "NO_ENCONTRADO", "Ruta no encontrada para tu aeropuerto")
		return
	}
	ok(w, map[string]interface{}{"id": id}, "Ruta actualizada")
}

// Eliminar — DELETE /api/operario/rutas/{id}
// Borra la ruta del catálogo del día a día. Distinto de "cancelar el vuelo de
// hoy" (POST /api/simulacion/cancelar), que es efímero y no toca la tabla.
func (h *RutasOperarioHandler) Eliminar(w http.ResponseWriter, r *http.Request) {
	u, ok_ := UsuarioDeContexto(r)
	if !ok_ || u.AeropuertoIATA == nil {
		errResp(w, 403, "SIN_AEROPUERTO", "Tu cuenta no tiene un aeropuerto asignado")
		return
	}

	id, err := parsePathID(r)
	if err != nil {
		errResp(w, 400, "ID_INVALIDO", err.Error())
		return
	}
	res, err := h.DB.Exec(`DELETE FROM vuelos_operacion WHERE id=? AND origen_iata=?`, id, *u.AeropuertoIATA)
	if err != nil {
		errResp(w, 500, "ELIMINACION_FALLIDA", err.Error())
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		errResp(w, 404, "NO_ENCONTRADO", "Ruta no encontrada para tu aeropuerto")
		return
	}
	ok(w, map[string]interface{}{"id": id}, "Ruta eliminada")
}

// CargarArchivo — POST /api/operario/rutas/archivo (multipart, campo "archivo")
// Formato de línea del curso: ORIG-DEST-HH:MM-HH:MM-CAPACIDAD
// (el mismo de vuelos.txt, para poder pegar el bloque de "planes de vuelos
// adicionales" tal cual). Las líneas que empiezan con # o * se ignoran, así el
// archivo del profesor entra sin editar los comentarios.
func (h *RutasOperarioHandler) CargarArchivo(w http.ResponseWriter, r *http.Request) {
	u, ok_ := UsuarioDeContexto(r)
	if !ok_ || u.AeropuertoIATA == nil {
		errResp(w, 403, "SIN_AEROPUERTO", "Tu cuenta no tiene un aeropuerto asignado")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
	if err := r.ParseMultipartForm(2 << 20); err != nil {
		errResp(w, 400, "ARCHIVO_INVALIDO", err.Error())
		return
	}
	file, _, err := r.FormFile("archivo")
	if err != nil {
		errResp(w, 400, "ARCHIVO_REQUERIDO", "Campo 'archivo' faltante")
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	registradas, fallidas := 0, 0
	var errores []string
	linea := 0

	for scanner.Scan() {
		linea++
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "*") {
			continue
		}
		partes := strings.Split(line, "-")
		if len(partes) < 5 {
			fallidas++
			errores = append(errores, fmt.Sprintf("línea %d: se esperaban 5 campos (ORIG-DEST-HH:MM-HH:MM-CAP)", linea))
			continue
		}
		salida, e1 := parseHHMMaMinutos(partes[2])
		llegada, e2 := parseHHMMaMinutos(partes[3])
		capacidad, e3 := strconv.Atoi(strings.TrimSpace(partes[4]))
		if e1 != nil || e2 != nil || e3 != nil {
			fallidas++
			errores = append(errores, fmt.Sprintf("línea %d: horas o capacidad con formato inválido", linea))
			continue
		}
		in := rutaInput{
			OrigenIATA: partes[0], DestinoIATA: partes[1],
			SalidaMinutos: salida, LlegadaMinutos: llegada, CapacidadMax: capacidad,
		}
		if err := validarRuta(&in); err != nil {
			fallidas++
			errores = append(errores, fmt.Sprintf("línea %d: %v", linea, err))
			continue
		}
		if in.OrigenIATA != *u.AeropuertoIATA {
			fallidas++
			errores = append(errores, fmt.Sprintf("línea %d: origen %s no corresponde a tu aeropuerto %s", linea, in.OrigenIATA, *u.AeropuertoIATA))
			continue
		}
		mismoCont, err := h.continentesDe(in.OrigenIATA, in.DestinoIATA)
		if err != nil {
			fallidas++
			errores = append(errores, fmt.Sprintf("línea %d: %v", linea, err))
			continue
		}
		if _, err := h.DB.Exec(`INSERT INTO vuelos_operacion
			(origen_iata, destino_iata, salida_minutos, llegada_minutos, capacidad_max, mismo_continente, operario_id)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
			in.OrigenIATA, in.DestinoIATA, in.SalidaMinutos, in.LlegadaMinutos,
			in.CapacidadMax, mismoCont, u.ID); err != nil {
			fallidas++
			errores = append(errores, fmt.Sprintf("línea %d: %v", linea, err))
			continue
		}
		registradas++
	}

	ok(w, map[string]interface{}{
		"registradas": registradas,
		"fallidas":    fallidas,
		"errores":     errores,
	}, fmt.Sprintf("%d rutas cargadas, %d con error", registradas, fallidas))
}

// parseHHMMaMinutos convierte "HH:MM" a minutos desde medianoche.
func parseHHMMaMinutos(s string) (int, error) {
	partes := strings.Split(strings.TrimSpace(s), ":")
	if len(partes) != 2 {
		return 0, fmt.Errorf("formato HH:MM inválido: %q", s)
	}
	h, e1 := strconv.Atoi(partes[0])
	m, e2 := strconv.Atoi(partes[1])
	if e1 != nil || e2 != nil || h < 0 || h > 23 || m < 0 || m > 59 {
		return 0, fmt.Errorf("hora fuera de rango: %q", s)
	}
	return h*60 + m, nil
}
