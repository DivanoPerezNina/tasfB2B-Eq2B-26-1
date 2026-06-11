package engine

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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

	Broadcast func(event string, data interface{})

	mu       sync.RWMutex
	estado   string // ejecutando|pausado|detenido|completado
	pauseCh  chan struct{}
	resumeCh chan struct{}
	stopCh   chan struct{}
	doneCh   chan struct{}
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

	nBloques := int((o.FinUTC - o.T0UTC) / o.Sc)
	if nBloques < 1 {
		nBloques = 1
	}

	for i := 1; i <= nBloques; i++ {
		// Control: detener / pausar.
		select {
		case <-o.stopCh:
			return
		case <-o.pauseCh:
			select {
			case <-o.resumeCh:
			case <-o.stopCh:
				return
			}
		default:
		}

		H := o.T0UTC + int64(i)*o.Sc
		if H > o.FinUTC {
			H = o.FinUTC
		}

		inicioReal := time.Now()

		// 1) Consultar envíos del bloque acumulado [iniPlan, H].
		envios, err := o.consultar(o.IniPlanUTC, H)
		if err != nil {
			o.Broadcast("fallo", map[string]interface{}{"mensaje": "consultas: " + err.Error()})
			return
		}
		// 2) Planificar (el Planificador no toca BD ni archivos).
		planJSON, err := o.planificar(envios, o.IniPlanUTC, H)
		if err != nil {
			o.Broadcast("fallo", map[string]interface{}{"mensaje": "desde-datos: " + err.Error()})
			return
		}
		// 3) Reconstruir el estado de la red en el instante H.
		sim, err := Nueva("blk", planJSON, 0, o.Umbrales, time.Second)
		if err != nil {
			o.Broadcast("fallo", map[string]interface{}{"mensaje": "estado: " + err.Error()})
			return
		}
		sim.mu.Lock()
		sim.TiempoSimUTC = float64(H)
		sim.procesarEventos(H)
		aeropuertos := sim.snapshotAeropuertos()
		contadores := sim.calcularContadores()
		vuelos := sim.vuelosActivos(H)
		sim.mu.Unlock()

		taSeg := time.Since(inicioReal).Seconds()
		progreso := float64(i) / float64(nBloques) * 100.0

		// 4) Emitir el estado por SSE (mismos eventos que el front ya consume).
		o.Broadcast("tick", map[string]interface{}{
			"tiempo_sim_utc": H,
			"progreso_pct":   fmt.Sprintf("%.1f", progreso),
			"bloque":         i,
			"bloques":        nBloques,
			"ta_seg":         fmt.Sprintf("%.3f", taSeg),
			"contadores":     contadores,
		})
		o.Broadcast("aeropuertos", aeropuertos)
		o.Broadcast("vuelos", vuelos)

		if H >= o.FinUTC {
			break
		}

		// 5) Esperar (Sa − Ta) para mantener el ritmo del esquema.
		espera := o.Sa - time.Since(inicioReal)
		if espera > 0 {
			select {
			case <-time.After(espera):
			case <-o.stopCh:
				return
			}
		}
		// Si Ta > Sa, no se espera: es la señal de "caída de la solución".
	}

	o.setEstado("completado")
	o.Broadcast("completado", map[string]interface{}{"mensaje": "Simulación de periodo completada"})
}

// ─── Llamadas a los servicios ────────────────────────────────────────────────

type envioConsulta struct {
	Origen      string `json:"origen"`
	Destino     string `json:"destino"`
	Maletas     int    `json:"maletas"`
	RegistroUTC int64  `json:"registroUTC"`
	DeadlineUTC int64  `json:"deadlineUTC"`
}

func (o *Orquestador) consultar(ini, fin int64) ([]envioConsulta, error) {
	url := fmt.Sprintf("%s/envios?ini=%d&fin=%d", o.ConsultasURL, ini, fin)
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

func (o *Orquestador) planificar(envios []envioConsulta, ini, fin int64) (string, error) {
	body, _ := json.Marshal(map[string]interface{}{
		"iniUTC":            ini,
		"finUTC":            fin,
		"observacionIniUTC": o.T0UTC,
		"criterio":          o.Criterio,
		"envios":            envios,
	})
	resp, err := http.Post(o.PlanificadorURL+"/api/planificacion/desde-datos",
		"application/json", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("HTTP %d: %s", resp.StatusCode, raw)
	}
	return string(raw), nil
}
