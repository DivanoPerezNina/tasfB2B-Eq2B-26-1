package handler

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
	"github.com/tasfb2b/carga-masiva/internal/db"
	"github.com/tasfb2b/carga-masiva/internal/parser"
)

type UploadHandler struct {
	DB        *sql.DB
	TempDir   string
	BatchSize int
	MaxBytes  int64
}

// respond escribe la respuesta JSON estándar.
func respond(w http.ResponseWriter, code int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(body)
}

func errResp(w http.ResponseWriter, code int, errKey, msg string) {
	respond(w, code, map[string]string{"error": errKey, "mensaje": msg})
}

// ── POST /upload/aeropuertos ─────────────────────────────────────────────────

func (h *UploadHandler) Aeropuertos(w http.ResponseWriter, r *http.Request) {
	// Verificar si ya hay aeropuertos (409 si no se forzó)
	aero, _, _, err := db.ContarRegistros(h.DB)
	if err != nil {
		errResp(w, 500, "DB_ERROR", err.Error())
		return
	}
	forzar := r.URL.Query().Get("forzar") == "true"
	if aero > 0 && !forzar {
		respond(w, 409, map[string]interface{}{
			"error":            "DATOS_EXISTENTES",
			"mensaje":          fmt.Sprintf("Ya existen %d aeropuertos cargados.", aero),
			"accion_requerida": "Enviar ?forzar=true para sobreescribir",
		})
		return
	}

	file, header, err := r.FormFile("archivo")
	if err != nil {
		errResp(w, 400, "ARCHIVO_REQUERIDO", "Campo 'archivo' faltante")
		return
	}
	defer file.Close()

	if !strings.HasSuffix(strings.ToLower(header.Filename), ".txt") {
		errResp(w, 400, "FORMATO_INVALIDO", "Se requiere archivo .txt")
		return
	}

	token := uuid.NewString()
	if err := db.InsertarSesion(h.DB, db.Sesion{
		Token:   token,
		Tipo:    "aeropuertos",
		Archivo: header.Filename,
	}); err != nil {
		errResp(w, 500, "DB_ERROR", err.Error())
		return
	}

	// Leer en memoria (≤50 MB)
	buf := new(bytes.Buffer)
	if _, err := io.CopyN(buf, file, h.MaxBytes+1); err != nil && err != io.EOF {
		errResp(w, 500, "LECTURA_ERROR", err.Error())
		return
	}
	data := buf.Bytes()

	// Guardar en disco para el Planificador
	if err := os.MkdirAll(h.TempDir, 0755); err != nil {
		errResp(w, 500, "DISCO_ERROR", err.Error())
		return
	}
	diskPath := filepath.Join(h.TempDir, "aeropuertos.txt")
	if err := os.WriteFile(diskPath, data, 0644); err != nil {
		errResp(w, 500, "DISCO_ERROR", err.Error())
		return
	}

	// Parsear e insertar en MySQL en background
	go func() {
		rows, parseErr := parser.ParseAeropuertos(bytes.NewReader(data))
		if parseErr != nil {
			msg := parseErr.Error()
			db.ActualizarSesion(h.DB, token, "error", 0, 0, &msg)
			return
		}
		if forzar {
			h.DB.Exec("DELETE FROM aeropuertos")
		}
		if insertErr := db.InsertarAeropuertosBatch(h.DB, rows); insertErr != nil {
			msg := insertErr.Error()
			db.ActualizarSesion(h.DB, token, "error", len(rows), 0, &msg)
			return
		}
		db.ActualizarSesion(h.DB, token, "ok", len(rows), len(rows), nil)
	}()

	respond(w, 202, map[string]string{
		"token":   token,
		"tipo":    "aeropuertos",
		"archivo": header.Filename,
		"estado":  "procesando",
	})
}

// ── POST /upload/vuelos ──────────────────────────────────────────────────────

func (h *UploadHandler) Vuelos(w http.ResponseWriter, r *http.Request) {
	// Verificar que haya aeropuertos cargados primero
	aero, vuelos, _, err := db.ContarRegistros(h.DB)
	if err != nil {
		errResp(w, 500, "DB_ERROR", err.Error())
		return
	}
	if aero == 0 {
		respond(w, 412, map[string]string{
			"error":   "DEPENDENCIA_FALTANTE",
			"mensaje": "Cargue aeropuertos.txt antes de cargar vuelos.txt",
		})
		return
	}
	forzar := r.URL.Query().Get("forzar") == "true"
	if vuelos > 0 && !forzar {
		respond(w, 409, map[string]interface{}{
			"error":            "DATOS_EXISTENTES",
			"mensaje":          fmt.Sprintf("Ya existen %d vuelos cargados.", vuelos),
			"accion_requerida": "Enviar ?forzar=true para sobreescribir",
		})
		return
	}

	file, header, err := r.FormFile("archivo")
	if err != nil {
		errResp(w, 400, "ARCHIVO_REQUERIDO", "Campo 'archivo' faltante")
		return
	}
	defer file.Close()

	token := uuid.NewString()
	db.InsertarSesion(h.DB, db.Sesion{Token: token, Tipo: "vuelos", Archivo: header.Filename})

	buf := new(bytes.Buffer)
	io.CopyN(buf, file, h.MaxBytes+1)
	data := buf.Bytes()

	os.MkdirAll(h.TempDir, 0755)
	os.WriteFile(filepath.Join(h.TempDir, "vuelos.txt"), data, 0644)

	go func() {
		// Construir mapa continente para mismo_continente
		continenteMap, mapErr := h.buildContinenteMap()
		if mapErr != nil {
			msg := mapErr.Error()
			db.ActualizarSesion(h.DB, token, "error", 0, 0, &msg)
			return
		}
		rows, parseErr := parser.ParseVuelos(bytes.NewReader(data), continenteMap)
		if parseErr != nil {
			msg := parseErr.Error()
			db.ActualizarSesion(h.DB, token, "error", 0, 0, &msg)
			return
		}
		if insertErr := db.InsertarVuelosBatch(h.DB, rows); insertErr != nil {
			msg := insertErr.Error()
			db.ActualizarSesion(h.DB, token, "error", len(rows), 0, &msg)
			return
		}
		db.ActualizarSesion(h.DB, token, "ok", len(rows), len(rows), nil)
	}()

	respond(w, 202, map[string]string{
		"token":   token,
		"tipo":    "vuelos",
		"archivo": header.Filename,
		"estado":  "procesando",
	})
}

// ── POST /upload/envios ──────────────────────────────────────────────────────

func (h *UploadHandler) Envios(w http.ResponseWriter, r *http.Request) {
	aero, _, _, err := db.ContarRegistros(h.DB)
	if err != nil {
		errResp(w, 500, "DB_ERROR", err.Error())
		return
	}
	if aero == 0 {
		respond(w, 412, map[string]string{
			"error":   "DEPENDENCIA_FALTANTE",
			"mensaje": "Cargue aeropuertos.txt antes de cargar envíos",
		})
		return
	}

	file, header, err := r.FormFile("archivo")
	if err != nil {
		errResp(w, 400, "ARCHIVO_REQUERIDO", "Campo 'archivo' faltante")
		return
	}
	defer file.Close()

	iata, iataErr := parser.IATADeNombreArchivo(header.Filename)
	if iataErr != nil {
		errResp(w, 400, "NOMBRE_INVALIDO", iataErr.Error())
		return
	}

	// GMT y continente del aeropuerto ORIGEN (constantes para todo el archivo,
	// que es de un solo aeropuerto) + mapa de continentes para el destino.
	// Se usan para precalcular registro_utc y deadline_utc al insertar.
	gmtOrigen, contOrigen, metaErr := h.metaAeropuerto(iata)
	if metaErr != nil {
		errResp(w, 500, "DB_ERROR", metaErr.Error())
		return
	}
	contMap, contErr := h.buildContinenteMap()
	if contErr != nil {
		errResp(w, 500, "DB_ERROR", contErr.Error())
		return
	}

	token := uuid.NewString()
	db.InsertarSesion(h.DB, db.Sesion{Token: token, Tipo: "envios", Archivo: header.Filename})

	// Guardar en disco para el Planificador (streaming directo a disco)
	os.MkdirAll(h.TempDir, 0755)
	diskPath := filepath.Join(h.TempDir, header.Filename)

	// Guardar el archivo por streaming. Para datasets grandes NO se mantiene una
	// copia completa en RAM; el parser lo volverá a abrir desde disco en segundo
	// plano. Esto permite cargar archivos mayores que la memoria disponible.
	diskFile, diskErr := os.Create(diskPath)
	if diskErr != nil {
		errResp(w, 500, "DISCO_ERROR", diskErr.Error())
		return
	}
	if _, copyErr := io.Copy(diskFile, file); copyErr != nil {
		diskFile.Close()
		errResp(w, 500, "LECTURA_ERROR", copyErr.Error())
		return
	}
	if closeErr := diskFile.Close(); closeErr != nil {
		errResp(w, 500, "DISCO_ERROR", closeErr.Error())
		return
	}

	go func() {
		input, openErr := os.Open(diskPath)
		if openErr != nil {
			msg := openErr.Error()
			db.ActualizarSesion(h.DB, token, "error", 0, 0, &msg)
			return
		}
		defer input.Close()

		tx, txErr := h.DB.Begin()
		if txErr != nil {
			msg := txErr.Error()
			db.ActualizarSesion(h.DB, token, "error", 0, 0, &msg)
			return
		}

		totalOK := 0
		parseTotal, parseErr := parser.ParseEnvios(input, iata, h.BatchSize,
			func(batch []parser.Envio) error {
				// Precalcular registro_utc y deadline_utc por envío (réplica de
				// la conversión horaria que hacía el Planificador).
				for i := range batch {
					e := &batch[i]
					anio, mes, dia := parsearFechaISO(e.FechaRegistro)
					e.RegistroUTC = parser.EpochMinutosUTC(anio, mes, dia, e.Hora, e.Minuto, gmtOrigen)
					contDest := contMap[e.DestinoIATA]
					e.DeadlineUTC = parser.DeadlineUTC(e.RegistroUTC, contOrigen, contDest)
				}
				if err := db.InsertarEnviosBatch(tx, batch); err != nil {
					return err
				}
				totalOK += len(batch)
				return nil
			})

		if parseErr != nil {
			tx.Rollback()
			msg := parseErr.Error()
			db.ActualizarSesion(h.DB, token, "error", parseTotal, totalOK, &msg)
			return
		}
		if commitErr := tx.Commit(); commitErr != nil {
			msg := commitErr.Error()
			db.ActualizarSesion(h.DB, token, "error", parseTotal, totalOK, &msg)
			return
		}
		db.ActualizarSesion(h.DB, token, "ok", parseTotal, parseTotal, nil)
	}()

	respond(w, 202, map[string]string{
		"token":       token,
		"tipo":        "envios",
		"archivo":     header.Filename,
		"origen_iata": iata,
		"estado":      "procesando",
	})
}

// ── POST /upload/cancelaciones ───────────────────────────────────────────────
//
// Carga el archivo CSV de cancelaciones (origen,destino,fecha,hora local). La
// hora local del origen se convierte a UTC con su GMT (igual que envios) y se
// guarda como salida_utc. Reemplaza las cancelaciones previas. No se valida
// contra el catálogo: rutas/fechas inexistentes simplemente no afectan nada.
func (h *UploadHandler) Cancelaciones(w http.ResponseWriter, r *http.Request) {
	aero, _, _, err := db.ContarRegistros(h.DB)
	if err != nil {
		errResp(w, 500, "DB_ERROR", err.Error())
		return
	}
	if aero == 0 {
		respond(w, 412, map[string]string{
			"error":   "DEPENDENCIA_FALTANTE",
			"mensaje": "Cargue aeropuertos antes de cargar cancelaciones (se necesita el GMT del origen)",
		})
		return
	}

	file, header, err := r.FormFile("archivo")
	if err != nil {
		errResp(w, 400, "ARCHIVO_REQUERIDO", "Campo 'archivo' faltante")
		return
	}
	defer file.Close()

	gmtMap, mapErr := h.buildGmtMap()
	if mapErr != nil {
		errResp(w, 500, "DB_ERROR", mapErr.Error())
		return
	}

	token := uuid.NewString()
	db.InsertarSesion(h.DB, db.Sesion{Token: token, Tipo: "cancelaciones", Archivo: header.Filename})

	buf := new(bytes.Buffer)
	io.CopyN(buf, file, h.MaxBytes+1)
	data := buf.Bytes()

	go func() {
		rows, parseErr := parser.ParseCancelaciones(bytes.NewReader(data))
		if parseErr != nil {
			msg := parseErr.Error()
			db.ActualizarSesion(h.DB, token, "error", 0, 0, &msg)
			return
		}

		// Resolver salida_utc por fila con el GMT del origen; descartar orígenes
		// desconocidos (filtro in-place, comparte el backing array de rows).
		resueltas := rows[:0]
		for _, c := range rows {
			gmt, ok := gmtMap[c.Origen]
			if !ok {
				continue
			}
			anio, mes, dia := parsearFechaISO(c.Fecha)
			c.SalidaUTC = parser.EpochMinutosUTC(anio, mes, dia, c.Hora, c.Minuto, gmt)
			resueltas = append(resueltas, c)
		}

		if insErr := db.InsertarCancelacionesBatch(h.DB, resueltas); insErr != nil {
			msg := insErr.Error()
			db.ActualizarSesion(h.DB, token, "error", len(rows), len(resueltas), &msg)
			return
		}
		db.ActualizarSesion(h.DB, token, "ok", len(rows), len(resueltas), nil)
	}()

	respond(w, 202, map[string]string{
		"token":   token,
		"tipo":    "cancelaciones",
		"archivo": header.Filename,
		"estado":  "procesando",
	})
}

// ── DELETE /upload/cancelaciones ─────────────────────────────────────────────
//
// Vacía la tabla de cancelaciones manualmente. Útil cuando se detiene una
// simulación antes de que termine (el ejecutor solo limpia al terminar/detener
// el escenario) o para descartar un archivo cargado sin correr nada.
func (h *UploadHandler) LimpiarCancelaciones(w http.ResponseWriter, r *http.Request) {
	res, err := h.DB.Exec("DELETE FROM cancelaciones")
	if err != nil {
		// Sin validación: si la tabla no existe, no hay nada que limpiar.
		respond(w, 200, map[string]interface{}{"limpiado": 0})
		return
	}
	n, _ := res.RowsAffected()
	respond(w, 200, map[string]interface{}{"limpiado": n})
}

// ── GET /upload/sesion/{token} ───────────────────────────────────────────────

func (h *UploadHandler) Sesion(w http.ResponseWriter, r *http.Request) {
	// Extraer token del path: /upload/sesion/{token}
	token := strings.TrimPrefix(r.URL.Path, "/upload/sesion/")
	if token == "" {
		errResp(w, 400, "TOKEN_REQUERIDO", "Token no especificado en la URL")
		return
	}

	s, err := db.ObtenerSesion(h.DB, token)
	if err != nil {
		errResp(w, 500, "DB_ERROR", err.Error())
		return
	}
	if s == nil {
		errResp(w, 404, "NO_ENCONTRADO", "Sesión no encontrada: "+token)
		return
	}

	detalle := ""
	if s.DetalleError != nil {
		detalle = *s.DetalleError
	}
	respond(w, 200, map[string]interface{}{
		"token":           s.Token,
		"tipo":            s.Tipo,
		"archivo":         s.Archivo,
		"estado":          s.Estado,
		"registros_total": s.RegistrosTotal,
		"registros_ok":    s.RegistrosOK,
		"detalle_error":   detalle,
	})
}

// ── DELETE /datos ────────────────────────────────────────────────────────────

func (h *UploadHandler) EliminarDatos(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Confirmar-Borrado") != "ELIMINAR-TODO" {
		errResp(w, 400, "CONFIRMACION_REQUERIDA",
			"Header X-Confirmar-Borrado: ELIMINAR-TODO requerido")
		return
	}
	// Eliminar también archivos temporales en disco
	os.RemoveAll(h.TempDir)

	na, nv, ne, err := db.LimpiarDatos(h.DB)
	if err != nil {
		errResp(w, 500, "DB_ERROR", err.Error())
		return
	}
	respond(w, 200, map[string]interface{}{
		"mensaje": "Todos los datos eliminados. El sistema requiere nueva carga.",
		"eliminados": map[string]int64{
			"aeropuertos": na,
			"vuelos":      nv,
			"envios":      ne,
		},
	})
}

// ── helper: GMT + continente de un aeropuerto por IATA ──────────────────────

func (h *UploadHandler) metaAeropuerto(iata string) (gmt int, continente int, err error) {
	err = h.DB.QueryRow(
		"SELECT gmt_offset, continente FROM aeropuertos WHERE iata = ?", iata,
	).Scan(&gmt, &continente)
	return
}

// parsearFechaISO parsea "YYYY-MM-DD" → (anio, mes, dia). Sin validación pesada:
// el parser ya garantizó el formato.
func parsearFechaISO(s string) (anio, mes, dia int) {
	if len(s) < 10 {
		return 0, 0, 0
	}
	anio = atoiSafe(s[0:4])
	mes = atoiSafe(s[5:7])
	dia = atoiSafe(s[8:10])
	return
}

func atoiSafe(s string) int {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return n
		}
		n = n*10 + int(c-'0')
	}
	return n
}

// ── helper: construir mapa IATA → GMT desde MySQL ───────────────────────────

func (h *UploadHandler) buildGmtMap() (map[string]int, error) {
	rows, err := h.DB.Query("SELECT iata, gmt_offset FROM aeropuertos")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	m := make(map[string]int, 30)
	for rows.Next() {
		var iata string
		var gmt int
		if err := rows.Scan(&iata, &gmt); err != nil {
			return nil, err
		}
		m[iata] = gmt
	}
	return m, rows.Err()
}

// ── helper: construir mapa IATA → continente desde MySQL ────────────────────

func (h *UploadHandler) buildContinenteMap() (map[string]int, error) {
	rows, err := h.DB.Query("SELECT iata, continente FROM aeropuertos")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	m := make(map[string]int, 30)
	for rows.Next() {
		var iata string
		var cont int
		if err := rows.Scan(&iata, &cont); err != nil {
			return nil, err
		}
		m[iata] = cont
	}
	return m, rows.Err()
}
