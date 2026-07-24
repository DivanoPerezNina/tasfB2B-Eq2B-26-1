package handler

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

// ModoOperacionHandler es el interruptor explícito del admin para permitir
// que los operarios registren envíos de Día a Día. Deliberadamente NO se
// deriva del estado del orquestador (que puede estar corriendo Periodo o
// Colapso, escenarios que no leen envios_operacion): es una decisión de
// negocio aparte ("ya pueden registrar") que el admin prende/apaga a mano.
// Se guarda en dataset_meta (clave/valor genérico ya existente) para no
// necesitar una tabla nueva.
type ModoOperacionHandler struct {
	DB *sql.DB
}

const claveModoOperacion = "modo_operacion_dia_a_dia"

// modoOperacionActivo la usan también los handlers de operario.go para
// bloquear el registro mientras el admin no haya encendido el modo.
func modoOperacionActivo(db *sql.DB) bool {
	var valor string
	err := db.QueryRow(`SELECT valor FROM dataset_meta WHERE clave = ?`, claveModoOperacion).Scan(&valor)
	return err == nil && valor == "1"
}

// Estado — GET /api/modo-operacion (cualquier sesión válida; el operario lo
// necesita para saber si mostrar el formulario o el aviso de espera).
func (h *ModoOperacionHandler) Estado(w http.ResponseWriter, r *http.Request) {
	ok(w, map[string]interface{}{"activo": modoOperacionActivo(h.DB)}, "")
}

// Actualizar — PUT /api/modo-operacion (solo admin) body {"activo": true|false}
func (h *ModoOperacionHandler) Actualizar(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Activo bool `json:"activo"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		errResp(w, 400, "BODY_INVALIDO", "JSON inválido")
		return
	}
	valor := "0"
	if in.Activo {
		valor = "1"
	}
	_, err := h.DB.Exec(`INSERT INTO dataset_meta (clave, valor) VALUES (?, ?)
		ON DUPLICATE KEY UPDATE valor = VALUES(valor)`, claveModoOperacion, valor)
	if err != nil {
		errResp(w, 500, "DB_ERROR", err.Error())
		return
	}
	ok(w, map[string]interface{}{"activo": in.Activo}, "Modo operación actualizado")
}

// LimpiarDatos — POST /api/modo-operacion/limpiar (solo admin)
// Vacía envíos y rutas del día a día para arrancar un ensayo desde cero.
// No toca `envios`/`vuelos` (los de simulación) ni el interruptor de modo.
//
// ?solo=envios deja las rutas intactas — útil para repetir el registro de
// envíos sin tener que volver a cargar el archivo de rutas del profesor.
func (h *ModoOperacionHandler) LimpiarDatos(w http.ResponseWriter, r *http.Request) {
	if _, err := h.DB.Exec(`TRUNCATE TABLE envios_operacion`); err != nil {
		errResp(w, 500, "DB_ERROR", err.Error())
		return
	}
	if r.URL.Query().Get("solo") == "envios" {
		ok(w, nil, "envios_operacion vaciada (las rutas se conservan)")
		return
	}
	if _, err := h.DB.Exec(`TRUNCATE TABLE vuelos_operacion`); err != nil {
		errResp(w, 500, "DB_ERROR", err.Error())
		return
	}
	ok(w, nil, "envios_operacion y vuelos_operacion vaciadas")
}
