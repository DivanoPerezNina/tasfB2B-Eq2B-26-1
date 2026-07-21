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

	_, err = h.DB.Exec(`
		INSERT INTO envios_operacion
		  (id_envio, origen_iata, fecha_registro, hora, minuto, destino_iata,
		   cantidad_maletas, id_cliente, registro_utc, deadline_utc, operario_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		idEnvio, origenIATA, localTime.Format("2006-01-02"),
		localTime.Hour(), localTime.Minute(), destinoIATA,
		cantidad, idCliente, registroUTC, deadlineUTC, operarioID)
	return err
}

// Registrar — POST /api/operario/envios
// body: {"destino_iata":"SCEL","cantidad_maletas":180,"id_cliente":7729,
//        "fecha_hora_local":"2026-07-20T08:15"}  (hora tomada del navegador del operario)
func (h *OperarioHandler) Registrar(w http.ResponseWriter, r *http.Request) {
	u, ok_ := UsuarioDeContexto(r)
	if !ok_ || u.AeropuertoIATA == nil {
		errResp(w, 403, "SIN_AEROPUERTO", "Tu cuenta no tiene un aeropuerto asignado")
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

	idEnvio := fmt.Sprintf("OP%d", time.Now().UnixNano())
	if err := h.registrar(u.ID, idEnvio, *u.AeropuertoIATA, localTime, req.DestinoIATA, req.CantidadMaletas, req.IDCliente); err != nil {
		errResp(w, 500, "REGISTRO_FALLIDO", err.Error())
		return
	}
	ok(w, map[string]string{"id_envio": idEnvio}, "Envío registrado")
}

// RegistrarArchivo — POST /api/operario/envios/archivo (multipart, campo "archivo")
// Formato de línea (igual al de carga masiva): id_envío-aaaammdd-hh-mm-dest-###-IdCliente
// El id_envío del archivo se ignora (se regenera) para no chocar con otro operario;
// hh-mm se interpreta como hora local del aeropuerto de origen, igual que el registro manual.
func (h *OperarioHandler) RegistrarArchivo(w http.ResponseWriter, r *http.Request) {
	u, ok_ := UsuarioDeContexto(r)
	if !ok_ || u.AeropuertoIATA == nil {
		errResp(w, 403, "SIN_AEROPUERTO", "Tu cuenta no tiene un aeropuerto asignado")
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

		idEnvio := fmt.Sprintf("OPF%d%04d", horaBase, linea)
		if err := h.registrar(u.ID, idEnvio, *u.AeropuertoIATA, localTime, dest, cant, cliente); err != nil {
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
