package engine

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

// Simulacion es el motor central de la simulación. Una instancia por ejecución.
type Simulacion struct {
	ID    string
	mu    sync.RWMutex

	// Configuración
	IniUTC        int64   // minuto UTC inicio del periodo simulado
	FinUTC        int64   // minuto UTC fin del periodo simulado
	AvancePorTick float64 // minutos simulados por segundo real
	TickInterval  time.Duration

	// Estado
	estado        string  // cargando|ejecutando|pausado|detenido|completado
	TiempoSimUTC  float64 // tiempo simulado actual (minutos UTC)

	// Datos del plan
	Envios      []EstadoEnvio
	Aeropuertos map[string]*EstadoAeropuerto
	Umbrales    Umbrales

	// Control del tick engine
	pauseCh  chan struct{}
	resumeCh chan struct{}
	stopCh   chan struct{}
	doneCh   chan struct{}

	// SSE: función de broadcast inyectada desde fuera
	Broadcast func(event string, data interface{})

	// Métricas de tiempo real
	inicioReal time.Time
	tickCount  int64
}

// Nueva crea e inicializa una simulación a partir del JSON del Planificador.
func Nueva(id string, planJSON string, duracionRealMin float64,
	umbrales Umbrales, tickInterval time.Duration) (*Simulacion, error) {

	var plan PlanResponse
	if err := json.Unmarshal([]byte(planJSON), &plan); err != nil {
		return nil, fmt.Errorf("parsear plan: %w", err)
	}

	ini := plan.Resumen.VentanaIniUTC
	fin := plan.Resumen.VentanaFinUTC
	ventanaMin := float64(fin - ini) // minutos simulados totales

	var avance float64
	if duracionRealMin <= 0 {
		avance = 1.0 // tiempo real: 1 min sim / 1 seg real
	} else {
		avance = ventanaMin / (duracionRealMin * 60.0)
	}

	s := &Simulacion{
		ID:            id,
		IniUTC:        ini,
		FinUTC:        fin,
		AvancePorTick: avance,
		TickInterval:  tickInterval,
		estado:        "cargando",
		TiempoSimUTC:  float64(ini),
		Aeropuertos:   make(map[string]*EstadoAeropuerto),
		Umbrales:      umbrales,
		pauseCh:       make(chan struct{}, 1),
		resumeCh:      make(chan struct{}, 1),
		stopCh:        make(chan struct{}),
		doneCh:        make(chan struct{}),
		Broadcast:     func(string, interface{}) {}, // no-op hasta que se inyecte
	}

	s.cargarPlan(plan)
	s.estado = "listo"
	return s, nil
}

// NuevaDesde fetches el plan desde el Planificador y construye la simulación.
func NuevaDesde(id, planificadorURL, jobID string,
	duracionRealMin float64, umbrales Umbrales,
	tickInterval time.Duration) (*Simulacion, error) {

	url := fmt.Sprintf("%s/api/planificacion/resultado/%s", planificadorURL, jobID)
	resp, err := http.Get(url)
	if err != nil {
		return nil, fmt.Errorf("GET planificador: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("planificador devolvió %d: %s", resp.StatusCode, body)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("leer respuesta: %w", err)
	}
	return Nueva(id, string(body), duracionRealMin, umbrales, tickInterval)
}

// ─── Getters thread-safe ─────────────────────────────────────────────────────

func (s *Simulacion) GetEstado() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.estado
}

func (s *Simulacion) GetTiempoSim() float64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.TiempoSimUTC
}

func (s *Simulacion) GetContadores() Contadores {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.calcularContadores()
}

func (s *Simulacion) GetAeropuertos() map[string]EstadoAeropuerto {
	s.mu.RLock()
	defer s.mu.RUnlock()
	copia := make(map[string]EstadoAeropuerto, len(s.Aeropuertos))
	for k, v := range s.Aeropuertos {
		copia[k] = *v
	}
	return copia
}

// ─── Control ─────────────────────────────────────────────────────────────────

// Iniciar lanza el tick engine en una goroutine.
func (s *Simulacion) Iniciar() error {
	s.mu.Lock()
	if s.estado != "listo" && s.estado != "pausado" {
		s.mu.Unlock()
		return fmt.Errorf("no se puede iniciar desde estado '%s'", s.estado)
	}
	s.estado = "ejecutando"
	s.inicioReal = time.Now()
	s.mu.Unlock()

	go s.tickLoop()
	return nil
}

// Pausar suspende el tick engine.
func (s *Simulacion) Pausar() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.estado != "ejecutando" {
		return fmt.Errorf("no está ejecutando")
	}
	s.estado = "pausado"
	s.pauseCh <- struct{}{}
	return nil
}

// Reanudar reanuda el tick engine tras una pausa.
func (s *Simulacion) Reanudar() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.estado != "pausado" {
		return fmt.Errorf("no está pausado")
	}
	s.estado = "ejecutando"
	s.resumeCh <- struct{}{}
	return nil
}

// Detener para el tick engine y libera memoria.
func (s *Simulacion) Detener() {
	s.mu.Lock()
	if s.estado == "detenido" {
		s.mu.Unlock()
		return
	}
	s.estado = "detenido"
	s.mu.Unlock()
	close(s.stopCh)
	<-s.doneCh
}

// ─── Tick engine ─────────────────────────────────────────────────────────────

func (s *Simulacion) tickLoop() {
	defer close(s.doneCh)

	ticker := time.NewTicker(s.TickInterval)
	defer ticker.Stop()

	for {
		select {
		case <-s.stopCh:
			return

		case <-s.pauseCh:
			// Esperar señal de reanudación o stop
			select {
			case <-s.resumeCh:
			case <-s.stopCh:
				return
			}

		case <-ticker.C:
			s.mu.Lock()
			n := atomic.AddInt64(&s.tickCount, 1)
			s.TiempoSimUTC += s.AvancePorTick
			t := int64(s.TiempoSimUTC)
			s.procesarEventos(t)
			cont := s.calcularContadores()
			aeropuertos := s.snapshotAeropuertos()
			completado := s.TiempoSimUTC >= float64(s.FinUTC)
			if completado {
				s.estado = "completado"
			}
			s.mu.Unlock()

			// Emitir tick SSE
			progreso := (s.TiempoSimUTC - float64(s.IniUTC)) /
				float64(s.FinUTC-s.IniUTC) * 100.0
			if progreso > 100 {
				progreso = 100
			}

			s.Broadcast("tick", map[string]interface{}{
				"tiempo_sim_utc": t,
				"progreso_pct":   fmt.Sprintf("%.1f", progreso),
				"tick":           n,
				"contadores":     cont,
			})

			// Emitir estado de aeropuertos cada 5 ticks
			if n%5 == 0 {
				s.Broadcast("aeropuertos", aeropuertos)
			}

			if completado {
				s.Broadcast("completado", map[string]interface{}{
					"mensaje":    "Simulación completada",
					"contadores": cont,
				})
				return
			}
		}
	}
}

// ─── Procesamiento de eventos por tick ───────────────────────────────────────

func (s *Simulacion) procesarEventos(t int64) {
	for i := range s.Envios {
		e := &s.Envios[i]
		if e.Estado == "entregado" || e.Estado == "rechazado" {
			continue
		}

		// Verificar deadline
		if e.DeadlineUTC > 0 && t > e.DeadlineUTC &&
			e.Estado != "entregado" {
			if e.Estado != "rechazado" {
				e.Estado = "rechazado"
				// Decrementar almacén si estaba pendiente ahí
				if aero, ok := s.Aeropuertos[e.Origen]; ok {
					if aero.MaletasAlmacen > 0 {
						aero.MaletasAlmacen -= e.Maletas
					}
				}
			}
			continue
		}

		// Procesar tramos
		for j := e.TramoActual; j < len(e.Tramos); j++ {
			tr := &e.Tramos[j]

			switch tr.Estado {
			case "pendiente":
				if t >= tr.SalidaUTC {
					tr.Estado = "en_vuelo"
					e.Estado = "en_vuelo"
					e.TramoActual = j
					// Sale del almacén origen
					if aero, ok := s.Aeropuertos[tr.Desde]; ok {
						aero.MaletasAlmacen -= e.Maletas
						if aero.MaletasAlmacen < 0 {
							aero.MaletasAlmacen = 0
						}
					}
				}

			case "en_vuelo":
				if t >= tr.LlegadaUTC {
					tr.Estado = "completado"
					// ¿Hay tramo siguiente?
					if j+1 < len(e.Tramos) {
						e.Tramos[j+1].Estado = "pendiente"
						e.Estado = "en_escala"
						e.TramoActual = j + 1
						// Entra al almacén de escala
						if aero, ok := s.Aeropuertos[tr.Hasta]; ok {
							aero.MaletasAlmacen += e.Maletas
						}
					} else {
						e.Estado = "entregado"
						e.TramoActual = j
					}
				}
			}
		}
	}

	// Recalcular semáforos
	for _, aero := range s.Aeropuertos {
		aero.Semaforo = calcularSemaforo(aero, s.Umbrales)
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

func (s *Simulacion) cargarPlan(plan PlanResponse) {
	s.Envios = make([]EstadoEnvio, 0, len(plan.Envios))

	for _, ep := range plan.Envios {
		e := EstadoEnvio{
			Indice:      ep.Indice,
			Origen:      ep.Origen,
			Destino:     ep.Destino,
			Maletas:     ep.Maletas,
			RegistroUTC: ep.RegistroUTC,
			DeadlineUTC: ep.DeadlineUTC,
		}

		if ep.Estado == "Rechazado" || len(ep.Tramos) == 0 {
			e.Estado = "rechazado"
		} else {
			e.Estado = "pendiente"
			e.Tramos = make([]TramoSim, len(ep.Tramos))
			for i, t := range ep.Tramos {
				st := "pendiente"
				if i > 0 {
					st = "esperando" // tramos posteriores esperan
				}
				e.Tramos[i] = TramoSim{
					VueloIdx:   t.VueloIdx,
					Desde:      t.Desde,
					Hasta:      t.Hasta,
					SalidaUTC:  t.SalidaUTC,
					LlegadaUTC: t.LlegadaUTC,
					Estado:     st,
				}
			}
			// Contabilizar en almacén origen
			if _, ok := s.Aeropuertos[e.Origen]; !ok {
				s.Aeropuertos[e.Origen] = &EstadoAeropuerto{
					IATA:             e.Origen,
					CapacidadAlmacen: 400, // default; se sobrescribe si hay datos
					Semaforo:         "verde",
				}
			}
			s.Aeropuertos[e.Origen].MaletasAlmacen += e.Maletas
		}
		s.Envios = append(s.Envios, e)
	}
}

func (s *Simulacion) calcularContadores() Contadores {
	c := Contadores{Total: len(s.Envios)}
	for _, e := range s.Envios {
		switch e.Estado {
		case "pendiente":
			c.Pendiente++
		case "en_vuelo":
			c.EnVuelo++
		case "en_escala":
			c.EnEscala++
		case "entregado":
			c.Entregado++
		case "rechazado":
			c.Rechazado++
		}
	}
	return c
}

func (s *Simulacion) snapshotAeropuertos() []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(s.Aeropuertos))
	for _, a := range s.Aeropuertos {
		var ocup float64
		if a.CapacidadAlmacen > 0 {
			ocup = float64(a.MaletasAlmacen) / float64(a.CapacidadAlmacen)
		}
		out = append(out, map[string]interface{}{
			"iata":              a.IATA,
			"maletas_almacen":   a.MaletasAlmacen,
			"capacidad_almacen": a.CapacidadAlmacen,
			"ocupacion":         math.Round(ocup*1000) / 1000, // número 0..1 (3 decimales)
			"semaforo":          a.Semaforo,
		})
	}
	return out
}

func calcularSemaforo(a *EstadoAeropuerto, u Umbrales) string {
	if a.CapacidadAlmacen == 0 {
		return "verde"
	}
	ratio := float64(a.MaletasAlmacen) / float64(a.CapacidadAlmacen)
	switch {
	case ratio <= u.VerdeHasta:
		return "verde"
	case ratio <= u.AmbarHasta:
		return "ambar"
	default:
		return "rojo"
	}
}
