package handler

import (
	"bufio"
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// RutasOperarioHandler es el mantenimiento de vuelos_operacion (las rutas del
// día a día). Separada de `vuelos` a propósito: las rutas que cargan los
// operarios para el ensayo no deben mezclarse con el catálogo de Periodo y
// Colapso.
//
// Igual que los envíos, cada operario trabaja con su aeropuerto: solo puede
// listar, crear, editar, eliminar o cargar rutas cuyo origen sea el aeropuerto
// asociado a su cuenta. Esto evita que SPIM vea o modifique rutas de SABE, etc.
type RutasOperarioHandler struct {
	DB          *sql.DB
	EjecutorURL string
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

func validarOrigenOperario(w http.ResponseWriter, r *http.Request, origen string) (*Usuario, bool) {
	u, ok_ := UsuarioDeContexto(r)
	if !ok_ || u.AeropuertoIATA == nil {
		errResp(w, 403, "SIN_AEROPUERTO", "Tu cuenta no tiene un aeropuerto asignado")
		return nil, false
	}
	if normalizeIATA(origen) != normalizeIATA(*u.AeropuertoIATA) {
		errResp(w, 403, "ORIGEN_NO_PERMITIDO", "Solo puedes gestionar rutas cuyo origen sea tu aeropuerto: "+*u.AeropuertoIATA)
		return nil, false
	}
	return u, true
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
		FROM vuelos_operacion WHERE origen_iata = ? ORDER BY origen_iata, salida_minutos`, *u.AeropuertoIATA)
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
	u, _ := UsuarioDeContexto(r)
	var in rutaInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if err := validarRuta(&in); err != nil {
		errResp(w, http.StatusBadRequest, "VALIDACION", err.Error())
		return
	}
	if _, ok := validarOrigenOperario(w, r, in.OrigenIATA); !ok {
		return
	}
	mismoCont, err := h.continentesDe(in.OrigenIATA, in.DestinoIATA)
	if err != nil {
		errResp(w, http.StatusBadRequest, "AEROPUERTO_INVALIDO", err.Error())
		return
	}
	var operarioID interface{}
	if u != nil {
		operarioID = u.ID
	}
	res, err := h.DB.Exec(`INSERT INTO vuelos_operacion
		(origen_iata, destino_iata, salida_minutos, llegada_minutos, capacidad_max, mismo_continente, operario_id)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		in.OrigenIATA, in.DestinoIATA, in.SalidaMinutos, in.LlegadaMinutos,
		in.CapacidadMax, mismoCont, operarioID)
	if err != nil {
		errResp(w, 500, "CREACION_FALLIDA", err.Error())
		return
	}
	id, _ := res.LastInsertId()
	solicitarReplanificacionOperacion(h.EjecutorURL)
	ok(w, map[string]interface{}{"id": id}, "Ruta creada")
}

// Actualizar — PUT /api/operario/rutas/{id}
func (h *RutasOperarioHandler) Actualizar(w http.ResponseWriter, r *http.Request) {
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
	if _, ok := validarOrigenOperario(w, r, in.OrigenIATA); !ok {
		return
	}
	mismoCont, err := h.continentesDe(in.OrigenIATA, in.DestinoIATA)
	if err != nil {
		errResp(w, http.StatusBadRequest, "AEROPUERTO_INVALIDO", err.Error())
		return
	}
	res, err := h.DB.Exec(`UPDATE vuelos_operacion SET origen_iata=?, destino_iata=?,
		salida_minutos=?, llegada_minutos=?, capacidad_max=?, mismo_continente=? WHERE id=?`,
		in.OrigenIATA, in.DestinoIATA, in.SalidaMinutos, in.LlegadaMinutos,
		in.CapacidadMax, mismoCont, id)
	if err != nil {
		errResp(w, 500, "ACTUALIZACION_FALLIDA", err.Error())
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		errResp(w, 404, "NO_ENCONTRADO", "Ruta no encontrada")
		return
	}
	solicitarReplanificacionOperacion(h.EjecutorURL)
	ok(w, map[string]interface{}{"id": id}, "Ruta actualizada")
}

// Eliminar — DELETE /api/operario/rutas/{id}
// Borra la ruta del catálogo del día a día. Distinto de "cancelar el vuelo de
// hoy" (POST /api/simulacion/cancelar), que es efímero y no toca la tabla.
func (h *RutasOperarioHandler) Eliminar(w http.ResponseWriter, r *http.Request) {
	id, err := parsePathID(r)
	if err != nil {
		errResp(w, 400, "ID_INVALIDO", err.Error())
		return
	}
	u, ok_ := UsuarioDeContexto(r)
	if !ok_ || u.AeropuertoIATA == nil {
		errResp(w, 403, "SIN_AEROPUERTO", "Tu cuenta no tiene un aeropuerto asignado")
		return
	}
	res, err := h.DB.Exec(`DELETE FROM vuelos_operacion WHERE id=? AND origen_iata=?`, id, *u.AeropuertoIATA)
	if err != nil {
		errResp(w, 500, "ELIMINACION_FALLIDA", err.Error())
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		errResp(w, 404, "NO_ENCONTRADO", "Ruta no encontrada")
		return
	}
	solicitarReplanificacionOperacion(h.EjecutorURL)
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

	var operarioID interface{}
	if u != nil {
		operarioID = u.ID
	}

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
			errores = append(errores, fmt.Sprintf("línea %d: origen %s no permitido para %s", linea, in.OrigenIATA, *u.AeropuertoIATA))
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
			in.CapacidadMax, mismoCont, operarioID); err != nil {
			fallidas++
			errores = append(errores, fmt.Sprintf("línea %d: %v", linea, err))
			continue
		}
		registradas++
	}

	if registradas > 0 {
		solicitarReplanificacionOperacion(h.EjecutorURL)
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

// CancelarVuelo — POST /api/simulacion/cancelar
//
// Punto de entrada robusto para cancelaciones. En Día a Día valida que el ID
// pertenezca a vuelos_operacion del aeropuerto del operario y garantiza que el
// orquestador esté vivo antes de delegar al Ejecutor. Esto evita el estado en el
// que el interruptor seguía mostrando "Día a Día activo" después de reiniciar
// el Ejecutor, pero /cancelar devolvía SIN_SIMULACION.
//
// Para administradores conserva el comportamiento de los escenarios Periodo y
// Colapso: reenvía la cancelación sin exigir que el vuelo exista en
// vuelos_operacion.
func (h *RutasOperarioHandler) CancelarVuelo(w http.ResponseWriter, r *http.Request) {
	var in struct {
		VueloID   int64  `json:"vueloId"`
		Origen    string `json:"origen"`
		Destino   string `json:"destino"`
		SalidaUTC int64  `json:"salidaUTC"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		errResp(w, http.StatusBadRequest, "BODY_INVALIDO", "JSON inválido")
		return
	}

	u, ok_ := UsuarioDeContexto(r)
	if !ok_ {
		errResp(w, http.StatusUnauthorized, "NO_AUTENTICADO", "Sesión inválida")
		return
	}

	in.Origen = normalizeIATA(in.Origen)
	in.Destino = normalizeIATA(in.Destino)
	if in.Origen == "" || in.Destino == "" {
		errResp(w, http.StatusBadRequest, "PARAM_FALTANTE", "Se requieren origen y destino")
		return
	}

	esOperario := strings.EqualFold(u.Rol, "operario")
	if esOperario {
		if in.VueloID <= 0 {
			errResp(w, http.StatusBadRequest, "VUELO_ID_REQUERIDO", "No se recibió el ID exacto del vuelo")
			return
		}
		if u.AeropuertoIATA == nil {
			errResp(w, http.StatusForbidden, "SIN_AEROPUERTO", "Tu cuenta no tiene un aeropuerto asignado")
			return
		}

		// La base es la fuente de verdad. No confiamos en origen/destino enviados
		// por el navegador y, de paso, confirmamos que el vuelo siga existiendo.
		var origenDB, destinoDB string
		err := h.DB.QueryRow(`SELECT origen_iata, destino_iata
			FROM vuelos_operacion WHERE id = ?`, in.VueloID).Scan(&origenDB, &destinoDB)
		if err == sql.ErrNoRows {
			errResp(w, http.StatusNotFound, "VUELO_NO_ENCONTRADO", "La ruta ya no existe en vuelos_operacion")
			return
		}
		if err != nil {
			errResp(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
			return
		}
		origenDB = normalizeIATA(origenDB)
		destinoDB = normalizeIATA(destinoDB)
		if origenDB != normalizeIATA(*u.AeropuertoIATA) {
			errResp(w, http.StatusForbidden, "VUELO_NO_PERMITIDO", "Solo puedes cancelar vuelos de tu aeropuerto")
			return
		}
		in.Origen = origenDB
		in.Destino = destinoDB

		if !modoOperacionActivo(h.DB) {
			errResp(w, http.StatusConflict, "MODO_INACTIVO", "Día a Día no está activo")
			return
		}

		// El flag vive en MySQL, mientras el orquestador vive en RAM. Tras un
		// restart del Ejecutor pueden desincronizarse; lo reponemos aquí.
		modo := &ModoOperacionHandler{DB: h.DB, EjecutorURL: h.EjecutorURL}
		if !modo.asegurarOperacionEnVivo() {
			errResp(w, http.StatusBadGateway, "EJECUTOR_NO_DISPONIBLE", "No se pudo levantar la operación Día a Día")
			return
		}
	}

	payload, _ := json.Marshal(in)
	enviar := func() (*http.Response, error) {
		req, err := http.NewRequest(http.MethodPost,
			strings.TrimRight(h.EjecutorURL, "/")+"/api/simulacion/cancelar",
			bytes.NewReader(payload))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		return (&http.Client{Timeout: 8 * time.Second}).Do(req)
	}

	resp, err := enviar()
	if err != nil {
		errResp(w, http.StatusBadGateway, "EJECUTOR_NO_DISPONIBLE", err.Error())
		return
	}

	// Una carrera puede reiniciar/detener el Ejecutor entre asegurar y enviar.
	// En Día a Día reintentamos una vez levantando nuevamente el orquestador.
	if esOperario && resp.StatusCode == http.StatusNotFound {
		resp.Body.Close()
		modo := &ModoOperacionHandler{DB: h.DB, EjecutorURL: h.EjecutorURL}
		if modo.asegurarOperacionEnVivo() {
			resp, err = enviar()
			if err != nil {
				errResp(w, http.StatusBadGateway, "EJECUTOR_NO_DISPONIBLE", err.Error())
				return
			}
		}
	}
	defer resp.Body.Close()

	body, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		errResp(w, http.StatusBadGateway, "RESPUESTA_INVALIDA", readErr.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(body)

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		// El Ejecutor ya replanifica al agregar la cancelación. Esta señal extra es
		// idempotente y cubre reinicios/reconexiones muy cercanos al clic.
		solicitarReplanificacionOperacion(h.EjecutorURL)
	}
}
