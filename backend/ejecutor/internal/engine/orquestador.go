package engine

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Orquestador implementa la PLANIFICACIÓN PROGRAMADA (esquema Sa/Sc):
// cada Sa segundos reales planifica el bloque acumulado [iniPlan, H] consultando
// los envíos a la BD (servicio de Consultas) y al Planificador (desde-datos),
// avanza el horizonte H += Sc y emite el estado por SSE. El reloj de la
// simulación avanza Sc minutos de datos por cada Sa segundos reales (K = Sc/Sa).
type Orquestador struct {
	ID              string
	ConsultasURL    string
	PlanificadorURL string

	IniPlanUTC int64 // inicio de PLANIFICACIÓN (t0, o t0−lookback si warm-up)
	T0UTC      int64 // inicio VISIBLE (la fecha/hora elegida)
	FinUTC     int64 // fin visible (t0 + días·1440)
	Sc         int64 // minutos de datos consumidos por bloque
	Sa         time.Duration
	Criterio   string
	Umbrales   Umbrales
	Colapso    *ConfigColapso

	// UsarCancelacionesArchivo controla si se aplican las cancelaciones cargadas
	// por ARCHIVO (servicio de Consultas). Solo aplica a Periodo y Colapso; en
	// Tiempo Real (día a día) se deja en false. Las cancelaciones INTERACTIVAS del
	// buscador funcionan en todos los escenarios, independiente de este flag.
	UsarCancelacionesArchivo bool

	// ModoOperacion, cuando es true, hace que consultar() lea de la tabla
	// envios_operacion (registrados por los operarios en Día a Día) en vez de
	// envios (histórico/proyectado de Periodo y Colapso). Mantiene ambos
	// datasets separados: envios_operacion se puede vaciar con TRUNCATE entre
	// ensayos sin tocar ni un registro del dataset de simulación.
	ModoOperacion bool

	Broadcast func(event string, data interface{})

	mu           sync.RWMutex
	estado       string // ejecutando|pausado|detenido|completado
	pauseCh      chan struct{}
	resumeCh     chan struct{}
	stopCh       chan struct{}
	doneCh       chan struct{}
	colapsoRojos map[string]int

	cancelaciones []cancelacion // cancelaciones (vuelo, día) activas; se envían en cada desde-datos
	cancelCh      chan struct{} // señal para re-planificar el bloque actual de inmediato
}

// cancelacion identifica la OCURRENCIA de vuelo a cancelar por su RUTA
// (origen→destino en IATA) y el minuto UTC absoluto de su salida. El planificador
// resuelve la ruta a su vueloIdx interno (el índice no es estable entre servicios).
type cancelacion struct {
	Origen    string `json:"origen"`
	Destino   string `json:"destino"`
	SalidaUTC int64  `json:"salidaUTC"`
}

// NuevoOrquestador construye el orquestador a partir de los parámetros del
// esquema. `lookbackMin` > 0 activa el warm-up (planifica desde t0−lookback).
func NuevoOrquestador(id, consultasURL, planificadorURL string,
	t0, finUTC, sc int64, sa time.Duration, lookbackMin int64,
	criterio string, umbrales Umbrales) *Orquestador {

	iniPlan := t0
	if lookbackMin > 0 {
		iniPlan = t0 - lookbackMin
	}
	return &Orquestador{
		ID:              id,
		ConsultasURL:    consultasURL,
		PlanificadorURL: planificadorURL,
		IniPlanUTC:      iniPlan,
		T0UTC:           t0,
		FinUTC:          finUTC,
		Sc:              sc,
		Sa:              sa,
		Criterio:        criterio,
		Umbrales:        umbrales,
		Broadcast:       func(string, interface{}) {},
		estado:          "listo",
		pauseCh:         make(chan struct{}, 1),
		resumeCh:        make(chan struct{}, 1),
		stopCh:          make(chan struct{}),
		doneCh:          make(chan struct{}),
		colapsoRojos:    make(map[string]int),
		cancelCh:        make(chan struct{}, 1),
	}
}

// AgregarCancelacion registra una cancelación (vuelo, día) y dispara un re-plan
// inmediato del bloque actual. Thread-safe: lo llama el handler HTTP mientras el
// bucle Sa/Sc corre en su propia goroutine.
func (o *Orquestador) AgregarCancelacion(origen, destino string, salidaUTC int64) {
	o.mu.Lock()
	o.cancelaciones = append(o.cancelaciones, cancelacion{Origen: origen, Destino: destino, SalidaUTC: salidaUTC})
	o.mu.Unlock()
	o.SolicitarReplanificacion()
}

// SolicitarReplanificacion dispara un re-plan inmediato sin agregar
// cancelaciones. Se usa en Día a Día cuando un operario carga rutas o registra
// envíos después de que la operación ya está encendida: sin esto el mapa podía
// quedarse mostrando solo aeropuertos hasta el siguiente bloque Sa/Sc.
func (o *Orquestador) SolicitarReplanificacion() {
	select {
	case o.cancelCh <- struct{}{}:
	default: // ya hay un re-plan pendiente
	}
}

func (o *Orquestador) GetEstado() string {
	o.mu.RLock()
	defer o.mu.RUnlock()
	return o.estado
}

func (o *Orquestador) setEstado(e string) {
	o.mu.Lock()
	o.estado = e
	o.mu.Unlock()
}

// Iniciar lanza el bucle Sa/Sc en una goroutine.
func (o *Orquestador) Iniciar() {
	o.setEstado("ejecutando")
	go o.run()
}

func (o *Orquestador) Pausar() {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.estado != "ejecutando" {
		return
	}
	o.estado = "pausado"
	select {
	case o.pauseCh <- struct{}{}:
	default:
	}
}

func (o *Orquestador) Reanudar() {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.estado != "pausado" {
		return
	}
	o.estado = "ejecutando"
	select {
	case o.resumeCh <- struct{}{}:
	default:
	}
}

func (o *Orquestador) Detener() {
	o.mu.Lock()
	if o.estado == "detenido" || o.estado == "completado" {
		o.mu.Unlock()
		return
	}
	o.estado = "detenido"
	o.mu.Unlock()
	close(o.stopCh)
	<-o.doneCh
}

// ─── Bucle principal ─────────────────────────────────────────────────────────

func (o *Orquestador) run() {
	defer close(o.doneCh)
	// Al terminar el escenario (completado, detenido o fallo) se vacía la tabla de
	// cancelaciones de archivo: son efímeras, válidas solo para esta ejecución.
	defer o.limpiarCancelacionesArchivo()

	// Reloj de VISUALIZACIÓN continuo: avanza Sc minutos de datos por cada Sa
	// segundos reales → avance por segundo = Sc / Sa (min-dato/seg).
	avance := float64(o.Sc) / o.Sa.Seconds()
	tiempoInicial := o.T0UTC
	finIni := o.T0UTC + o.Sc

	// En Día a Día, si el admin/operario activa el modo a las 13:14 y el t0 es
	// 13:00, el mapa debe ubicarse inmediatamente en la hora real actual, no
	// arrancar visualmente desde las 13:00 ni acelerar. Además, el primer plan
	// debe cubrir hasta "ahora" para incluir envíos registrados minutos antes y
	// vuelos que ya están en ejecución.
	if o.ModoOperacion {
		ahoraUTC := time.Now().UTC().Unix() / 60
		if ahoraUTC > tiempoInicial {
			tiempoInicial = ahoraUTC
		}
		if tiempoInicial > o.FinUTC {
			tiempoInicial = o.FinUTC
		}
		finIni = tiempoInicial + o.Sc
	}

	if finIni > o.FinUTC {
		finIni = o.FinUTC
	}
	proximoH := finIni // se re-planifica cuando el reloj cruza este umbral

	// Plan inicial: bloque [iniPlan, finIni].
	start := time.Now()
	sim, err := o.planificarYcargar(finIni, tiempoInicial)
	taSeg := time.Since(start).Seconds()
	if errors.Is(err, errSinRutas) {
		// Operación encendida sin rutas todavía: se arranca con una simulación
		// vacía y el bucle vuelve a intentar cada bloque. El mapa queda visible
		// (aeropuertos, sin aviones) en vez de mostrar un error.
		o.Broadcast("aviso", map[string]interface{}{
			"mensaje": "Operación iniciada sin rutas. Carga las rutas del día a día para que empiecen a planificarse los envíos.",
		})
		sim, err = o.simulacionVacia(finIni)
		if err != nil {
			o.Broadcast("fallo", map[string]interface{}{"mensaje": err.Error()})
			return
		}
	} else if err != nil {
		o.Broadcast("fallo", map[string]interface{}{"mensaje": err.Error()})
		return
	} else {
		if res, ok := o.detectarColapso(sim, taSeg, o.Sa.Seconds(), o.T0UTC); ok {
			o.setEstado("completado")
			o.Broadcast("colapso", res)
			return
		}
		o.emitirTramos(sim)
	}

	tiempo := float64(tiempoInicial)
	finActual := finIni // fin del bloque actualmente cargado (para re-plan por cancelación)
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-o.stopCh:
			return
		case <-o.pauseCh:
			select {
			case <-o.resumeCh:
			case <-o.stopCh:
				return
			}
		case <-o.cancelCh:
			// Re-plan inmediato del bloque actual con las cancelaciones nuevas
			// (Flujo B: cancelar un vuelo desde el buscador). planificar() lee el
			// set de cancelaciones, así que el plan resultante ya re-rutea.
			t := int64(tiempo)
			nsim, err := o.planificarYcargar(finActual, t)
			if errors.Is(err, errSinRutas) {
				continue // nada que re-planificar todavía
			}
			if err != nil {
				o.Broadcast("fallo", map[string]interface{}{"mensaje": err.Error()})
				return
			}
			sim = nsim
			o.emitirTramos(sim)
		case <-ticker.C:
			if o.ModoOperacion {
				tiempo = float64(time.Now().UTC().Unix()) / 60.0

				if tiempo < float64(o.T0UTC) {
					tiempo = float64(o.T0UTC)
				}
				if tiempo > float64(o.FinUTC) {
					tiempo = float64(o.FinUTC)
				}
			} else {
				tiempo += avance
				if tiempo > float64(o.FinUTC) {
					tiempo = float64(o.FinUTC)
				}
			}

			t := int64(tiempo)

			// Re-planificación PROGRAMADA: cada vez que el reloj cruza un bloque
			// (Sc), se consulta+planifica el siguiente tramo de datos y se manda
			// el plan completo al mapa. Aquí está el delay (Ta) del esquema.
			for t >= proximoH && proximoH < o.FinUTC {
				nuevoFin := proximoH + o.Sc
				if nuevoFin > o.FinUTC {
					nuevoFin = o.FinUTC
				}
				start := time.Now()
				nsim, err := o.planificarYcargar(nuevoFin, t)
				taSeg := time.Since(start).Seconds()
				if errors.Is(err, errSinRutas) {
					// Siguen sin cargarse rutas: avanzar el reloj y reintentar
					// en el próximo bloque, sin matar la operación.
					proximoH += o.Sc
					finActual = nuevoFin
					continue
				}
				if err != nil {
					o.Broadcast("fallo", map[string]interface{}{"mensaje": err.Error()})
					return
				}
				sim = nsim
				if res, ok := o.detectarColapso(sim, taSeg, o.Sa.Seconds(), t); ok {
					o.setEstado("completado")
					o.Broadcast("colapso", res)
					return
				}
				o.emitirTramos(sim)
				proximoH += o.Sc
				finActual = nuevoFin
			}

			// Avanzar el estado al instante actual y emitir (cada segundo).
			sim.mu.Lock()
			sim.TiempoSimUTC = tiempo
			sim.procesarEventos(t)
			aeropuertos := sim.snapshotAeropuertos()
			cont := sim.calcularContadores()
			sim.mu.Unlock()

			progreso := (tiempo - float64(o.T0UTC)) / float64(o.FinUTC-o.T0UTC) * 100.0
			if progreso > 100 {
				progreso = 100
			}
			o.Broadcast("tick", map[string]interface{}{
				"tiempo_sim_utc": t,
				"progreso_pct":   fmt.Sprintf("%.1f", progreso),
				"contadores":     cont,
			})
			o.Broadcast("aeropuertos", aeropuertos)

			if t >= o.FinUTC {
				o.setEstado("completado")
				o.Broadcast("completado", map[string]interface{}{
					"mensaje": "Simulación de periodo completada", "contadores": cont,
				})
				return
			}
		}
	}
}

// planificarYcargar consulta [iniPlan, fin], planifica (desde-datos) y carga el
// plan en una Simulacion posicionada en el instante t.
func (o *Orquestador) planificarYcargar(fin, t int64) (*Simulacion, error) {
	envios, err := o.consultar(o.IniPlanUTC, fin)
	if err != nil {
		return nil, fmt.Errorf("consultas: %w", err)
	}
	cancelados := o.cancelacionesParaVentana(fin)
	// En día a día las rutas viajan en el body (tabla vuelos_operacion); en
	// Periodo/Colapso van nil y el planificador usa su archivo, como siempre.
	var vuelos []vueloConsulta
	if o.ModoOperacion {
		v, err := o.consultarVuelos()
		if err != nil {
			return nil, fmt.Errorf("consultas vuelos: %w", err)
		}
		if len(v) == 0 {
			// No es un fallo: en día a día la operación se enciende y los
			// operarios cargan las rutas después. Se espera al próximo ciclo.
			return nil, errSinRutas
		}
		vuelos = v
	}
	resp, err := o.planificar(envios, cancelados, vuelos, o.IniPlanUTC, fin)
	if err != nil {
		return nil, fmt.Errorf("desde-datos: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("desde-datos HTTP %d: %s", resp.StatusCode, b)
	}
	// Parseo del plan en STREAMING desde el body de la respuesta: evita cargar el
	// plan completo (cientos de MB a horizontes grandes) como string + copia []byte.
	sim, err := nuevaDesdeReader("blk", resp.Body, 0, o.Umbrales, time.Second)
	if err != nil {
		return nil, fmt.Errorf("estado: %w", err)
	}
	sim.mu.Lock()
	sim.TiempoSimUTC = float64(t)
	sim.procesarEventos(t)
	sim.mu.Unlock()
	return sim, nil
}

// emitirTramos envía TODOS los tramos del plan actual para que el mapa anime
// los aviones de forma continua (con cada tick el reloj avanza y los mueve).
func (o *Orquestador) emitirTramos(sim *Simulacion) {
	sim.mu.RLock()
	tramos := sim.todosLosTramos()
	sim.mu.RUnlock()
	o.Broadcast("plan-tramos", tramos)
}

// ─── Llamadas a los servicios ────────────────────────────────────────────────

type envioConsulta struct {
	Origen      string `json:"origen"`
	Destino     string `json:"destino"`
	Maletas     int    `json:"maletas"`
	RegistroUTC int64  `json:"registroUTC"`
	DeadlineUTC int64  `json:"deadlineUTC"`
}

// errSinRutas señala que el catálogo del día a día está vacío. NO es un fallo:
// la operación se enciende antes de que los operarios carguen sus rutas, así
// que el bucle se salta ese ciclo y reintenta en el siguiente.
var errSinRutas = errors.New("sin rutas cargadas en vuelos_operacion")

// simulacionVacia arma una Simulacion sin aviones para poder arrancar la
// operación antes de que existan rutas. Reusa el parser de planes en vez de
// un constructor aparte: así no hay dos formas de construir una Simulacion
// que puedan divergir.
func (o *Orquestador) simulacionVacia(fin int64) (*Simulacion, error) {
	plan := fmt.Sprintf(
		`{"resumen":{"ventanaIniUTC":%d,"ventanaFinUTC":%d,"observacionIniUTC":%d},"aeropuertos":[],"envios":[]}`,
		o.T0UTC, fin, o.T0UTC)
	return nuevaDesdeReader("blk", strings.NewReader(plan), 0, o.Umbrales, time.Second)
}

// vueloConsulta es una ruta tal como la entrega el servicio Consultas. Los
// minutos son LOCALES (origen/destino); el planificador los pasa a UTC con el
// gmt_offset de cada aeropuerto, igual que hacía al leer el archivo.
type vueloConsulta struct {
	Origen    string `json:"origen"`
	Destino   string `json:"destino"`
	Salida    int    `json:"salida"`
	Llegada   int    `json:"llegada"`
	Capacidad int    `json:"capacidad"`
}

// consultarVuelos trae el catálogo de rutas de la tabla del día a día. Solo se
// usa en ModoOperacion: en Periodo/Colapso el planificador sigue leyendo su
// archivo vuelos.txt (no se toca ese camino para no cambiar su comportamiento).
func (o *Orquestador) consultarVuelos() ([]vueloConsulta, error) {
	resp, err := http.Get(o.ConsultasURL + "/vuelos?modo=operacion")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, b)
	}
	var r struct {
		Vuelos []vueloConsulta `json:"vuelos"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return nil, err
	}
	return r.Vuelos, nil
}

func (o *Orquestador) consultar(ini, fin int64) ([]envioConsulta, error) {
	url := fmt.Sprintf("%s/envios?ini=%d&fin=%d", o.ConsultasURL, ini, fin)
	if o.ModoOperacion {
		url += "&modo=operacion"
	}
	resp, err := http.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, b)
	}
	var r struct {
		Envios []envioConsulta `json:"envios"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return nil, err
	}
	return r.Envios, nil
}

// planificar hace POST /desde-datos con el body en STREAMING vía io.Pipe: el
// cuerpo de la petición (cabecera + array de envíos) se genera y envía por
// chunks en una goroutine, en vez de materializar el JSON completo (~cientos de
// MB a horizontes grandes) con json.Marshal antes de enviarlo. Devuelve la
// respuesta SIN consumir su body, para que el caller la parsee en streaming.
// cancelacionesParaVentana combina las cancelaciones DECLARATIVAS del archivo
// (servicio de Consultas, ventana [IniPlan, fin)) con las INTERACTIVAS del
// buscador (set en memoria). Sin validación: si Consultas falla, solo se usan las
// interactivas (no se aborta la simulación).
func (o *Orquestador) cancelacionesParaVentana(fin int64) []cancelacion {
	var archivo []cancelacion
	// Solo Periodo y Colapso usan el archivo; Tiempo Real (día a día) lo ignora.
	if o.UsarCancelacionesArchivo {
		if a, err := o.consultarCancelaciones(o.IniPlanUTC, fin); err == nil {
			archivo = a
		}
	}
	o.mu.RLock()
	inter := make([]cancelacion, len(o.cancelaciones))
	copy(inter, o.cancelaciones)
	o.mu.RUnlock()
	if len(archivo) == 0 {
		return inter
	}
	return append(archivo, inter...)
}

// limpiarCancelacionesArchivo vacía la tabla de cancelaciones (vía Consultas) al
// terminar el escenario. Best-effort con timeout corto: si Consultas no responde,
// no se bloquea el cierre del orquestador (Detener espera doneCh).
func (o *Orquestador) limpiarCancelacionesArchivo() {
	req, err := http.NewRequest(http.MethodDelete, o.ConsultasURL+"/cancelaciones", nil)
	if err != nil {
		return
	}
	cli := &http.Client{Timeout: 5 * time.Second}
	resp, err := cli.Do(req)
	if err != nil {
		return
	}
	resp.Body.Close()
}

func (o *Orquestador) consultarCancelaciones(ini, fin int64) ([]cancelacion, error) {
	url := fmt.Sprintf("%s/cancelaciones?ini=%d&fin=%d", o.ConsultasURL, ini, fin)
	cli := &http.Client{Timeout: 10 * time.Second}
	resp, err := cli.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	var r struct {
		Cancelaciones []cancelacion `json:"cancelaciones"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return nil, err
	}
	return r.Cancelaciones, nil
}

func (o *Orquestador) planificar(envios []envioConsulta, cancelados []cancelacion, vuelos []vueloConsulta, ini, fin int64) (*http.Response, error) {
	if cancelados == nil {
		cancelados = []cancelacion{} // json: [] en vez de null
	}
	pr, pw := io.Pipe()
	go func() {
		var werr error
		defer func() { pw.CloseWithError(werr) }()
		if _, werr = fmt.Fprintf(pw,
			`{"iniUTC":%d,"finUTC":%d,"observacionIniUTC":%d,"criterio":%q,"envios":`,
			ini, fin, o.T0UTC, o.Criterio); werr != nil {
			return
		}
		if werr = json.NewEncoder(pw).Encode(envios); werr != nil {
			return
		}
		if _, werr = io.WriteString(pw, `,"cancelados":`); werr != nil {
			return
		}
		if werr = json.NewEncoder(pw).Encode(cancelados); werr != nil {
			return
		}
		// Solo se manda "vuelos" en día a día. Si va ausente, el planificador
		// cae a su archivo vuelos.txt (comportamiento de Periodo/Colapso).
		if vuelos != nil {
			if _, werr = io.WriteString(pw, `,"vuelos":`); werr != nil {
				return
			}
			if werr = json.NewEncoder(pw).Encode(vuelos); werr != nil {
				return
			}
		}
		_, werr = io.WriteString(pw, "}")
	}()

	req, err := http.NewRequest(http.MethodPost,
		o.PlanificadorURL+"/api/planificacion/desde-datos", pr)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	return http.DefaultClient.Do(req)
}
