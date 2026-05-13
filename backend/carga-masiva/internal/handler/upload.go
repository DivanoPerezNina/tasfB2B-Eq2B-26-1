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

	token := uuid.NewString()
	db.InsertarSesion(h.DB, db.Sesion{Token: token, Tipo: "envios", Archivo: header.Filename})

	// Guardar en disco para el Planificador (streaming directo a disco)
	os.MkdirAll(h.TempDir, 0755)
	diskPath := filepath.Join(h.TempDir, header.Filename)

	// Crear archivo temporal en disco mientras también pasamos los bytes al parser
	diskFile, diskErr := os.Create(diskPath)
	if diskErr != nil {
		errResp(w, 500, "DISCO_ERROR", diskErr.Error())
		return
	}

	// Tee: escribe en disco y en buffer para MySQL al mismo tiempo
	var buf bytes.Buffer
	teeReader := io.TeeReader(file, diskFile)
	io.Copy(&buf, teeReader)
	diskFile.Close()

	go func() {
		tx, txErr := h.DB.Begin()
		if txErr != nil {
			msg := txErr.Error()
			db.ActualizarSesion(h.DB, token, "error", 0, 0, &msg)
			return
		}

		totalOK := 0
		parseTotal, parseErr := parser.ParseEnvios(bytes.NewReader(buf.Bytes()), iata, h.BatchSize,
			func(batch []parser.Envio) error {
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
