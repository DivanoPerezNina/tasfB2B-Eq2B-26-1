package handler

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// ModoOperacionHandler es el interruptor explícito del admin para permitir
// que los operarios registren envíos de Día a Día. Deliberadamente NO se
// deriva del estado del orquestador (que puede estar corriendo Periodo o
// Colapso, escenarios que no leen envios_operacion): es una decisión de
// negocio aparte ("ya pueden registrar") que el admin prende/apaga a mano.
// Se guarda en dataset_meta (clave/valor genérico ya existente) para no
// necesitar una tabla nueva.
type ModoOperacionHandler struct {
	DB          *sql.DB
	EjecutorURL string
}

// scOperacionMin / saOperacionSeg: ritmo del bucle Sa/Sc en día a día.
// 60 minutos de datos por cada 60 segundos reales. No es 1:1 con el reloj de
// pared a propósito: a 1:1 el orquestador re-planificaría una vez por hora y
// los envíos recién registrados tardarían eso en entrar al plan. Con este
// ritmo el plan se refresca cada minuto y un día completo cabe en ~24 min.
const (
	scOperacionMin  = 60
	saOperacionSeg  = 60
	diasOperacion   = 1
	criterioDefecto = "EDF"
)

// arrancarOperacion levanta el orquestador en modo día a día. t0 = la hora en
// punto anterior a ahora, para que los envíos ya registrados en esta hora
// caigan dentro de la ventana del plan (si t0 fuera "ahora exacto", todo lo
// registrado minutos antes quedaría fuera y no se planificaría nunca).
func (h *ModoOperacionHandler) arrancarOperacion() error {
	t0 := time.Now().UTC().Truncate(time.Hour).Unix() / 60
	usarCancelaciones := false // false ⇒ el ejecutor activa ModoOperacion
	body, _ := json.Marshal(map[string]interface{}{
		"t0_utc":             t0,
		"dias":               diasOperacion,
		"sc":                 scOperacionMin,
		"sa_seg":             saOperacionSeg,
		"warmup":             false,
		"criterio":           criterioDefecto,
		"usar_cancelaciones": &usarCancelaciones,
	})
	resp, err := http.Post(h.EjecutorURL+"/api/simulacion/periodo-programado",
		"application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("no se pudo contactar al ejecutor: %w", err)
	}
	defer resp.Body.Close()
	// 409 = ya hay una simulación corriendo. No es un error para nosotros:
	// el modo queda encendido y se sigue usando la que ya está en curso.
	if resp.StatusCode != http.StatusAccepted && resp.StatusCode != http.StatusConflict {
		var buf bytes.Buffer
		buf.ReadFrom(resp.Body)
		return fmt.Errorf("el ejecutor respondió %d: %s", resp.StatusCode, buf.String())
	}
	return nil
}

// detenerOperacion para el orquestador al apagar el modo. Best-effort: si el
// ejecutor no responde, el modo igual queda apagado (que es lo que bloquea el
// registro de los operarios).
func (h *ModoOperacionHandler) detenerOperacion() {
	req, err := http.NewRequest(http.MethodPost, h.EjecutorURL+"/api/simulacion/detener", nil)
	if err != nil {
		return
	}
	cli := &http.Client{Timeout: 5 * time.Second}
	if resp, err := cli.Do(req); err == nil {
		resp.Body.Close()
	}
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

	// El día a día es UN solo interruptor: encenderlo habilita el registro Y
	// arranca la operación en vivo. No se le pide al admin que además configure
	// una simulación con fecha de inicio y duración — eso es de los escenarios
	// de simulación, no de la operación real.
	if in.Activo {
		if err := h.arrancarOperacion(); err != nil {
			// El modo queda encendido (ya se guardó) pero avisamos que la
			// operación en vivo no levantó, en vez de fingir que todo salió bien.
			errResp(w, 502, "EJECUTOR_NO_DISPONIBLE",
				"Modo activado, pero no se pudo iniciar la operación en vivo: "+err.Error())
			return
		}
		ok(w, map[string]interface{}{"activo": true}, "Modo Día a Día activado y operación en vivo iniciada")
		return
	}

	h.detenerOperacion()
	ok(w, map[string]interface{}{"activo": false}, "Modo Día a Día desactivado y operación detenida")
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
