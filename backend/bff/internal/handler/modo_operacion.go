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
// Operaciones día a día NO es un escenario de simulación acelerada: debe seguir
// el reloj real de la sede. Por eso se avanza 1 minuto de datos cada 60 segundos
// reales y se re-planifica cada minuto.
const (
	scOperacionMin  = 1
	saOperacionSeg  = 60
	diasOperacion   = 1
	criterioDefecto = "EDF"
)

// arrancarOperacion levanta el orquestador en modo día a día.
//
// Día a Día NO debe iniciar desde la hora en punto anterior. Si se activaba a
// las 18:42 y t0 quedaba en 18:00, con Sc=1 y Sa=60 el reloj visual tardaba
// 42 minutos reales en alcanzar 18:42. Por eso el mapa mostraba "Sin simulación
// activa" o no dibujaba vuelos aunque ya existieran envíos/rutas válidas.
//
// Usamos un pequeño lookback real para incluir envíos recién registrados y
// vuelos que ya están por despegar o acaban de iniciar.
func (h *ModoOperacionHandler) arrancarOperacion() error {
	return h.arrancarOperacionConReintento(false)
}

func (h *ModoOperacionHandler) arrancarOperacionConReintento(reintento bool) error {
	t0 := time.Now().UTC().Unix()/60 - 10
	if t0 < 0 {
		t0 = 0
	}
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

	if resp.StatusCode == http.StatusAccepted {
		return nil
	}

	if resp.StatusCode == http.StatusConflict && !reintento {
		// Había otra simulación/orquestador vivo que no necesariamente era Día a Día.
		// En la práctica dejaba el interruptor activo pero el mapa conectado a nada.
		// Para activar Operaciones Día a Día de forma consistente detenemos lo anterior
		// y arrancamos el orquestador con ModoOperacion=true.
		h.detenerOperacion()
		time.Sleep(500 * time.Millisecond)
		return h.arrancarOperacionConReintento(true)
	}

	var buf bytes.Buffer
	buf.ReadFrom(resp.Body)
	return fmt.Errorf("el ejecutor respondió %d: %s", resp.StatusCode, buf.String())
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

// operacionEnVivo pregunta al ejecutor si todavía hay un orquestador/simulación
// activo. El interruptor puede quedar en "1" después de un reinicio o de que la
// operación de 1 día haya completado; este chequeo permite re-levantarla.
func (h *ModoOperacionHandler) operacionEnVivo() bool {
	cli := &http.Client{Timeout: 3 * time.Second}
	resp, err := cli.Get(h.EjecutorURL + "/api/simulacion/estado")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false
	}
	var body struct {
		Activa        bool   `json:"activa"`
		Estado        string `json:"estado"`
		ModoOperacion bool   `json:"modo_operacion"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return false
	}
	activo := body.Activa || (body.Estado != "" && body.Estado != "detenido" && body.Estado != "completado" && body.Estado != "fallo")
	return activo && body.ModoOperacion
}

// asegurarOperacionEnVivo hace que "modo activo" signifique realmente
// "operación corriendo". Si ya corre, periodo-programado responde 409 y
// arrancarOperacion lo toma como válido; si no corre, se levanta otra vez.
func (h *ModoOperacionHandler) asegurarOperacionEnVivo() bool {
	if h.operacionEnVivo() {
		return true
	}
	return h.arrancarOperacion() == nil
}

// Estado — GET /api/modo-operacion (cualquier sesión válida; el operario lo
// necesita para saber si mostrar el formulario o el aviso de espera).
func (h *ModoOperacionHandler) Estado(w http.ResponseWriter, r *http.Request) {
	activo := modoOperacionActivo(h.DB)
	enVivo := false
	if activo {
		enVivo = h.asegurarOperacionEnVivo()
	}
	ok(w, map[string]interface{}{
		"activo":            activo,
		"simulacion_activa": enVivo,
	}, "")
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
