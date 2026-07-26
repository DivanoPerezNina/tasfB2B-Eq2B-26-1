package handler

import (
	"bufio"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// OperarioHandler registra envíos de Día a Día en envios_operacion — separada
// de envios (histórico/proyectado) para no ensuciar el dataset que usan
// Periodo y Colapso. El origen NUNCA lo manda el cliente: se toma del
// aeropuerto_iata fijado en la cuenta del operario autenticado.
type OperarioHandler struct {
	DB *sql.DB
}

// maxMaletasPorEnvio: los aeropuertos de la prueba Día a Día operan con
// capacidad de almacén 999 — un solo envío jamás puede exceder eso.
const maxMaletasPorEnvio = 999

// ventanaEdicionMin: un envío se puede corregir hasta 10 minutos reales
// después de registrarlo (por si el operario se equivocó); pasado eso, queda
// fijo. Es tiempo REAL (no simulado) porque Día a Día corre en tiempo real.
const ventanaEdicionMin = 10

// aeropuertoInfo resuelve gmt_offset y continente de un IATA.
func (h *OperarioHandler) aeropuertoInfo(iata string) (gmtOffset int, continente int, err error) {
	err = h.DB.QueryRow(`SELECT gmt_offset, continente FROM aeropuertos WHERE iata = ?`, iata).
		Scan(&gmtOffset, &continente)
	return
}

// registrar inserta una fila en envios_operacion. localTime son los campos de
// fecha/hora TAL COMO los reporta el reloj local del operario (su navegador),
// sin zona horaria adjunta — se interpreta como hora local del aeropuerto de
// origen y se resta gmt_offset para obtener registro_utc en minutos absolutos.
func (h *OperarioHandler) registrar(operarioID int64, idEnvio, origenIATA string,
	localTime time.Time, destinoIATA string, cantidad, idCliente int) error {
	return h.registrarConID(operarioID, idEnvio, origenIATA, localTime, destinoIATA, cantidad, idCliente, false)
}

// registrarConID preserva el id_envio cuando viene de archivo. Esto es clave
// para las pruebas del curso: si el archivo dice 30000001, el operario debe ver
// 30000001 en pantalla, no un OPF... generado por el backend. Si upsert=true,
// re-subir el mismo archivo actualiza la fila del mismo origen en vez de fallar
// por llave primaria duplicada.
func (h *OperarioHandler) registrarConID(operarioID int64, idEnvio, origenIATA string,
	localTime time.Time, destinoIATA string, cantidad, idCliente int, upsert bool) error {

	origenGMT, origenCont, err := h.aeropuertoInfo(origenIATA)
	if err != nil {
		return fmt.Errorf("aeropuerto origen inválido: %w", err)
	}
	_, destCont, err := h.aeropuertoInfo(destinoIATA)
	if err != nil {
		return fmt.Errorf("aeropuerto destino inválido: %w", err)
	}

	utcTime := localTime.Add(-time.Duration(origenGMT) * time.Hour)
	registroUTC := utcTime.Unix() / 60

	ventana := int64(1440)
	if origenCont != destCont {
		ventana = 2880
	}
	deadlineUTC := registroUTC + ventana

	query := `
		INSERT INTO envios_operacion
		  (id_envio, origen_iata, fecha_registro, hora, minuto, destino_iata,
		   cantidad_maletas, id_cliente, registro_utc, deadline_utc, operario_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	if upsert {
		query += `
		ON DUPLICATE KEY UPDATE
		  fecha_registro = VALUES(fecha_registro),
		  hora = VALUES(hora),
		  minuto = VALUES(minuto),
		  destino_iata = VALUES(destino_iata),
		  cantidad_maletas = VALUES(cantidad_maletas),
		  id_cliente = VALUES(id_cliente),
		  registro_utc = VALUES(registro_utc),
		  deadline_utc = VALUES(deadline_utc),
		  operario_id = VALUES(operario_id)`
	}

	_, err = h.DB.Exec(query,
		idEnvio, origenIATA, localTime.Format("2006-01-02"),
		localTime.Hour(), localTime.Minute(), destinoIATA,
		cantidad, idCliente, registroUTC, deadlineUTC, operarioID)
	return err
}

// Registrar — POST /api/operario/envios
// body: {"destino_iata":"SCEL","cantidad_maletas":180,"id_cliente":7729,
//
//	"fecha_hora_local":"2026-07-20T08:15"}  (hora tomada del navegador del operario)
func (h *OperarioHandler) Registrar(w http.ResponseWriter, r *http.Request) {
	u, ok_ := UsuarioDeContexto(r)
	if !ok_ || u.AeropuertoIATA == nil {
		errResp(w, 403, "SIN_AEROPUERTO", "Tu cuenta no tiene un aeropuerto asignado")
		return
	}
	if !modoOperacionActivo(h.DB) {
		errResp(w, http.StatusConflict, "MODO_INACTIVO", "El administrador aún no activó el modo Día a Día")
		return
	}

	var req struct {
		DestinoIATA     string `json:"destino_iata"`
		CantidadMaletas int    `json:"cantidad_maletas"`
		IDCliente       int    `json:"id_cliente"`
		FechaHoraLocal  string `json:"fecha_hora_local"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		errResp(w, 400, "BODY_INVALIDO", "JSON inválido")
		return
	}
	req.DestinoIATA = strings.ToUpper(strings.TrimSpace(req.DestinoIATA))
	if len(req.DestinoIATA) != 4 {
		errResp(w, 400, "DESTINO_INVALIDO", "destino_iata debe tener 4 letras")
		return
	}
	if req.CantidadMaletas <= 0 || req.CantidadMaletas > maxMaletasPorEnvio {
		errResp(w, 400, "CANTIDAD_INVALIDA", fmt.Sprintf("cantidad_maletas debe estar entre 1 y %d", maxMaletasPorEnvio))
		return
	}
	// Validar el destino aquí (y no solo dentro de registrar) para responder
	// 400 al operario en vez de un 500 genérico.
	if _, _, err := h.aeropuertoInfo(req.DestinoIATA); err != nil {
		if err == sql.ErrNoRows {
			errResp(w, 400, "DESTINO_INVALIDO", "destino_iata no existe en el catálogo de aeropuertos")
		} else {
			errResp(w, 500, "ERROR_BD", "No se pudo validar el destino")
		}
		return
	}
	if req.IDCliente == 0 {
		req.IDCliente = 7729
	}

	localTime, err := time.Parse("2006-01-02T15:04:05", req.FechaHoraLocal)
	if err != nil {
		localTime, err = time.Parse("2006-01-02T15:04", req.FechaHoraLocal)
	}
	if err != nil {
		errResp(w, 400, "FECHA_INVALIDA", "fecha_hora_local formato esperado: YYYY-MM-DDTHH:MM")
		return
	}

	// id_envio es VARCHAR(20): UnixNano() (19 dígitos) + "OP" se pasaba del
	// límite y esto fallaba SIEMPRE (Error 1406). UnixMilli() (13 dígitos en
	// 2026) deja margen de sobra y sigue siendo suficientemente único para un
	// solo operario haciendo clic a mano.
	idEnvio := fmt.Sprintf("OP%d", time.Now().UnixMilli())
	if err := h.registrar(u.ID, idEnvio, *u.AeropuertoIATA, localTime, req.DestinoIATA, req.CantidadMaletas, req.IDCliente); err != nil {
		errResp(w, 500, "REGISTRO_FALLIDO", err.Error())
		return
	}
	ok(w, map[string]string{"id_envio": idEnvio}, "Envío registrado")
}

// RegistrarArchivo — POST /api/operario/envios/archivo (multipart, campo "archivo")
// Formato de línea (igual al de carga masiva): id_envío-aaaammdd-hh-mm-dest-###-IdCliente
// El id_envío del archivo se conserva para que el operario vea el mismo ID
// que subió. hh-mm se interpreta como hora local del aeropuerto de origen,
// igual que el registro manual.
func (h *OperarioHandler) RegistrarArchivo(w http.ResponseWriter, r *http.Request) {
	u, ok_ := UsuarioDeContexto(r)
	if !ok_ || u.AeropuertoIATA == nil {
		errResp(w, 403, "SIN_AEROPUERTO", "Tu cuenta no tiene un aeropuerto asignado")
		return
	}
	if !modoOperacionActivo(h.DB) {
		errResp(w, http.StatusConflict, "MODO_INACTIVO", "El administrador aún no activó el modo Día a Día")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 5<<20) // 5MB alcanza de sobra para un registro manual en lote
	if err := r.ParseMultipartForm(5 << 20); err != nil {
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
	registrados, fallidos := 0, 0
	var errores []string
	linea := 0
	horaBase := time.Now().Unix()

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		linea++

		parts := strings.SplitN(line, "-", 7)
		if len(parts) < 6 {
			fallidos++
			continue
		}
		fechaStr := strings.TrimSpace(parts[1])
		dest := strings.ToUpper(strings.TrimSpace(parts[4]))
		if len(fechaStr) != 8 || len(dest) != 4 {
			fallidos++
			continue
		}
		hora, e1 := strconv.Atoi(strings.TrimSpace(parts[2]))
		min, e2 := strconv.Atoi(strings.TrimSpace(parts[3]))
		cant, e3 := strconv.Atoi(strings.TrimSpace(parts[5]))
		if e1 != nil || e2 != nil || e3 != nil {
			fallidos++
			continue
		}
		if cant <= 0 || cant > maxMaletasPorEnvio {
			fallidos++
			errores = append(errores, fmt.Sprintf("línea %d: cantidad %d fuera de rango (1-%d)", linea, cant, maxMaletasPorEnvio))
			continue
		}
		cliente := 7729
		if len(parts) >= 7 {
			if c, e := strconv.Atoi(strings.TrimSpace(parts[6])); e == nil {
				cliente = c
			}
		}

		anio, _ := strconv.Atoi(fechaStr[0:4])
		mes, _ := strconv.Atoi(fechaStr[4:6])
		dia, _ := strconv.Atoi(fechaStr[6:8])
		localTime := time.Date(anio, time.Month(mes), dia, hora, min, 0, 0, time.UTC)

		idEnvio := strings.TrimSpace(parts[0])
		if idEnvio == "" {
			idEnvio = fmt.Sprintf("OPF%d%04d", horaBase, linea)
		}
		if len(idEnvio) > 20 || strings.ContainsAny(idEnvio, " \t\r\n") {
			fallidos++
			errores = append(errores, fmt.Sprintf("línea %d: id_envio inválido o mayor a 20 caracteres", linea))
			continue
		}

		if err := h.registrarConID(u.ID, idEnvio, *u.AeropuertoIATA, localTime, dest, cant, cliente, true); err != nil {
			fallidos++
			errores = append(errores, fmt.Sprintf("línea %d (%s): %v", linea, line, err))
			continue
		}
		registrados++
	}

	ok(w, map[string]interface{}{
		"registrados": registrados,
		"fallidos":    fallidos,
		"errores":     errores,
	}, fmt.Sprintf("%d envíos registrados, %d fallidos", registrados, fallidos))
}

// ListarMisEnvios — GET /api/operario/envios
// Los envíos (manuales o por archivo) del operario autenticado, para que
// pueda revisarlos y corregirlos si se equivocó. Sin paginado: el volumen
// esperado por operario en un ensayo del curso es bajo y la tabla se vacía
// con TRUNCATE entre pruebas.
func (h *OperarioHandler) ListarMisEnvios(w http.ResponseWriter, r *http.Request) {
	u, ok_ := UsuarioDeContexto(r)
	if !ok_ || u.AeropuertoIATA == nil {
		errResp(w, 403, "SIN_AEROPUERTO", "Tu cuenta no tiene un aeropuerto asignado")
		return
	}
	rows, err := h.DB.Query(`SELECT id_envio, origen_iata, destino_iata, cantidad_maletas,
		id_cliente, registro_utc, deadline_utc, fecha_registro, hora, minuto
		FROM envios_operacion WHERE origen_iata = ? AND operario_id = ? ORDER BY registro_utc DESC`, *u.AeropuertoIATA, u.ID)
	if err != nil {
		errResp(w, 500, "DB_ERROR", err.Error())
		return
	}
	defer rows.Close()

	nowUTCMin := time.Now().UTC().Unix() / 60
	envios := []map[string]interface{}{}
	for rows.Next() {
		var idEnvio, origen, destino string
		var cantidad, idCliente, horaLocal, minutoLocal int
		var registroUTC, deadlineUTC int64
		var fechaRegistro string
		if err := rows.Scan(&idEnvio, &origen, &destino, &cantidad, &idCliente, &registroUTC, &deadlineUTC, &fechaRegistro, &horaLocal, &minutoLocal); err != nil {
			errResp(w, 500, "DB_ERROR", err.Error())
			return
		}
		envios = append(envios, map[string]interface{}{
			"id_envio": idEnvio, "origen_iata": origen, "destino_iata": destino,
			"cantidad_maletas": cantidad, "id_cliente": idCliente,
			"registro_utc": registroUTC, "deadline_utc": deadlineUTC,
			"fecha_registro": fechaRegistro, "hora": horaLocal, "minuto": minutoLocal,
			"editable": nowUTCMin-registroUTC <= ventanaEdicionMin,
		})
	}
	ok(w, envios, "")
}

// EditarEnvio — PUT /api/operario/envios/{id}
// {id} es el id_envio. Solo el operario que lo registró puede editarlo, y
// solo dentro de ventanaEdicionMin minutos REALES desde el registro (usamos
// registro_utc tal cual porque en Día a Día ya representa un instante real,
// no simulado). No se puede cambiar el origen: sigue atado a la cuenta.
func (h *OperarioHandler) EditarEnvio(w http.ResponseWriter, r *http.Request) {
	u, ok_ := UsuarioDeContexto(r)
	if !ok_ || u.AeropuertoIATA == nil {
		errResp(w, 403, "SIN_AEROPUERTO", "Tu cuenta no tiene un aeropuerto asignado")
		return
	}
	idEnvio := r.PathValue("id")
	if idEnvio == "" {
		errResp(w, 400, "ID_INVALIDO", "Falta id_envio")
		return
	}

	var req struct {
		DestinoIATA     string `json:"destino_iata"`
		CantidadMaletas int    `json:"cantidad_maletas"`
		IDCliente       int    `json:"id_cliente"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		errResp(w, 400, "BODY_INVALIDO", "JSON inválido")
		return
	}
	req.DestinoIATA = strings.ToUpper(strings.TrimSpace(req.DestinoIATA))
	if len(req.DestinoIATA) != 4 {
		errResp(w, 400, "DESTINO_INVALIDO", "destino_iata debe tener 4 letras")
		return
	}
	if req.CantidadMaletas <= 0 || req.CantidadMaletas > maxMaletasPorEnvio {
		errResp(w, 400, "CANTIDAD_INVALIDA", fmt.Sprintf("cantidad_maletas debe estar entre 1 y %d", maxMaletasPorEnvio))
		return
	}
	if req.IDCliente == 0 {
		req.IDCliente = 7729
	}

	var registroUTC int64
	var operarioID sql.NullInt64
	err := h.DB.QueryRow(`SELECT registro_utc, operario_id FROM envios_operacion
		WHERE id_envio = ? AND origen_iata = ?`, idEnvio, *u.AeropuertoIATA).Scan(&registroUTC, &operarioID)
	if err == sql.ErrNoRows {
		errResp(w, 404, "NO_ENCONTRADO", "Envío no encontrado")
		return
	} else if err != nil {
		errResp(w, 500, "DB_ERROR", err.Error())
		return
	}
	if !operarioID.Valid || operarioID.Int64 != u.ID {
		errResp(w, 403, "NO_AUTORIZADO", "Este envío no lo registraste tú")
		return
	}
	nowUTCMin := time.Now().UTC().Unix() / 60
	if nowUTCMin-registroUTC > ventanaEdicionMin {
		errResp(w, http.StatusConflict, "VENTANA_VENCIDA", fmt.Sprintf("Ya pasaron más de %d minutos desde el registro", ventanaEdicionMin))
		return
	}

	_, destCont, err := h.aeropuertoInfo(req.DestinoIATA)
	if err != nil {
		errResp(w, 400, "DESTINO_INVALIDO", "destino_iata no existe en el catálogo de aeropuertos")
		return
	}
	_, origenCont, _ := h.aeropuertoInfo(*u.AeropuertoIATA)
	ventana := int64(1440)
	if origenCont != destCont {
		ventana = 2880
	}
	deadlineUTC := registroUTC + ventana

	_, err = h.DB.Exec(`UPDATE envios_operacion SET destino_iata=?, cantidad_maletas=?, id_cliente=?, deadline_utc=?
		WHERE id_envio=? AND origen_iata=?`,
		req.DestinoIATA, req.CantidadMaletas, req.IDCliente, deadlineUTC, idEnvio, *u.AeropuertoIATA)
	if err != nil {
		errResp(w, 500, "ACTUALIZACION_FALLIDA", err.Error())
		return
	}
	ok(w, map[string]interface{}{"id_envio": idEnvio}, "Envío actualizado")
}
