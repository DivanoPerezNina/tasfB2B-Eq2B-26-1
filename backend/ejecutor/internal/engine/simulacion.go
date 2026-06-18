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
	IniUTC         int64   // minuto UTC inicio del PLAN (= inicio del pre-roll de warm-up)
	ObservacionUTC int64   // minuto UTC donde arranca la simulación VISIBLE en tiempo real
	FinUTC         int64   // minuto UTC fin del periodo simulado
	AvancePorTick  float64 // minutos simulados por segundo real (fase tiempo real)
	TickInterval   time.Duration

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

	// Instante donde arranca la simulación visible (tiempo real). El planificador
	// lo envía en observacionIniUTC; si viene 0 (planes viejos o sin warm-up),
	// arrancamos directamente en el inicio del plan (sin pre-roll).
	obs := plan.Resumen.ObservacionIniUTC
	if obs <= 0 || obs < ini {
		obs = ini
	}
	if obs > fin {
		obs = fin
	}

	// La velocidad de la FASE VISIBLE se calcula sobre [observación, fin], no
	// sobre todo el plan: el tramo de warm-up no consume tiempo real.
	ventanaVisibleMin := float64(fin - obs)

	var avance float64
	if duracionRealMin <= 0 {
		// Tiempo real ESTRICTO 1:1 — el reloj simulado avanza al mismo ritmo
		// que el reloj de pared. Un tick ocurre cada TickInterval (1 seg real),
		// así que en 1 seg real debe avanzar (TickInterval en segundos) minutos
		// simulados / 60. Con tick de 1 seg: 1/60 min sim = 1 seg sim por seg real.
		avance = tickInterval.Seconds() / 60.0
	} else {
		avance = ventanaVisibleMin / (duracionRealMin * 60.0)
	}

	s := &Simulacion{
		ID:             id,
		IniUTC:         ini,
		ObservacionUTC: obs,
		FinUTC:         fin,
		AvancePorTick:  avance,
		TickInterval:   tickInterval,
		estado:         "cargando",
		TiempoSimUTC:   float64(ini),
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

// setEstadoSalvoTerminal cambia el estado salvo que ya sea terminal
// (detenido/completado). Devuelve false si NO cambió porque ya estaba en un
// estado terminal — lo usa el tickLoop para abortar si Detener() llegó durante
// la ventana entre Iniciar() y el arranque real del loop.
func (s *Simulacion) setEstadoSalvoTerminal(e string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.estado == "detenido" || s.estado == "completado" {
		return false
	}
	s.estado = e
	return true
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

	// ── Fase 1: warm-up turbo (sin sleep) ──────────────────────────────────────
	// Reproduce el tramo [IniUTC, ObservacionUTC] a máxima velocidad para sembrar
	// el estado de la red (maletas en almacén / en vuelo) tal como estaría en el
	// instante de observación. No consume tiempo real.
	if s.ObservacionUTC > s.IniUTC {
		if detenido := s.warmUpLoop(); detenido {
			return // se llamó Detener() durante el warm-up
		}
	}

	// Salir si nos detuvieron justo al terminar el warm-up.
	select {
	case <-s.stopCh:
		return
	default:
	}

	// ── Transición a tiempo real ───────────────────────────────────────────────
	if !s.setEstadoSalvoTerminal("ejecutando") {
		return // Detener() llegó durante/justo al terminar el warm-up
	}
	// Snapshot inicial para que el mapa aparezca poblado desde el primer segundo.
	s.mu.Lock()
	contIni := s.calcularContadores()
	aeroIni := s.snapshotAeropuertos()
	s.mu.Unlock()
	s.Broadcast("aeropuertos", aeroIni)
	s.Broadcast("tick", map[string]interface{}{
		"tiempo_sim_utc": int64(s.ObservacionUTC),
		"progreso_pct":   "0.0",
		"tick":           int64(0),
		"contadores":     contIni,
	})

	// ── Fase 2: tiempo real ─────────────────────────────────────────────────────
	ticker := time.NewTicker(s.TickInterval)
	defer ticker.Stop()

	denomVisible := float64(s.FinUTC - s.ObservacionUTC)
	if denomVisible <= 0 {
		denomVisible = 1
	}

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

			// Progreso sobre la ventana VISIBLE [ObservacionUTC, FinUTC]
			progreso := (s.TiempoSimUTC - float64(s.ObservacionUTC)) /
				denomVisible * 100.0
			if progreso > 100 {
				progreso = 100
			}
			if progreso < 0 {
				progreso = 0
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

// warmUpLoop reproduce el tramo [IniUTC, ObservacionUTC] a máxima velocidad
// (sin sleep, en pasos grandes) para reconstruir el estado de la red en el
// instante de observación. Devuelve true si se solicitó Detener() durante el
// proceso (en cuyo caso el llamador debe salir del tickLoop).
func (s *Simulacion) warmUpLoop() bool {
	if !s.setEstadoSalvoTerminal("calentando") {
		return true // ya fue detenido antes de empezar
	}

	const pasoMin = 60.0 // 1 hora simulada por iteración
	total := float64(s.ObservacionUTC - s.IniUTC)
	if total <= 0 {
		return false
	}

	iter := 0
	for {
		// Permitir cancelar el warm-up con Detener().
		select {
		case <-s.stopCh:
			return true
		default:
		}

		s.mu.Lock()
		s.TiempoSimUTC += pasoMin
		if s.TiempoSimUTC > float64(s.ObservacionUTC) {
			s.TiempoSimUTC = float64(s.ObservacionUTC)
		}
		s.procesarEventos(int64(s.TiempoSimUTC))
		alcanzado := s.TiempoSimUTC >= float64(s.ObservacionUTC)
		pct := (s.TiempoSimUTC - float64(s.IniUTC)) / total * 100.0
		s.mu.Unlock()

		iter++
		// Reportar progreso cada ~24 pasos (1 día simulado) para no saturar SSE.
		if iter%24 == 0 || alcanzado {
			if pct > 100 {
				pct = 100
			}
			s.Broadcast("warmup-progress", map[string]interface{}{
				"tiempo_sim_utc": int64(s.TiempoSimUTC),
				"progreso_pct":   fmt.Sprintf("%.1f", pct),
			})
		}

		if alcanzado {
			break
		}
	}

	s.mu.Lock()
	cont := s.calcularContadores()
	s.mu.Unlock()
	s.Broadcast("warmup-completado", map[string]interface{}{
		"tiempo_sim_utc": int64(s.ObservacionUTC),
		"contadores":     cont,
	})
	return false
}

// ─── Procesamiento de eventos por tick ───────────────────────────────────────

func (s *Simulacion) procesarEventos(t int64) {
	for i := range s.Envios {
		e := &s.Envios[i]
		if e.Estado == "entregado" || e.Estado == "rechazado" {
			continue
		}

		// 0) Registro: el envío ingresa al almacén origen cuando se registra.
		//    Antes (cargarPlan) se sumaban todos de golpe → ocupación inflada.
		if !e.Registrado && t >= e.RegistroUTC {
			e.Registrado = true
			if aero, ok := s.Aeropuertos[e.Origen]; ok {
				aero.MaletasAlmacen += e.Maletas
			}
		}

		// 1) Procesar tramos PRIMERO: un mismo paso puede hacer despegar y/o
		//    aterrizar el envío. Es clave hacerlo antes del chequeo de deadline:
		//    si no, un paso grande (los 60 min del warm-up, o un tick comprimido)
		//    que salta por encima de la llegada Y del deadline a la vez marcaría
		//    el envío como "rechazado" aunque en realidad aterrizó a tiempo
		//    (rechazos espurios → falsa sensación de colapso).
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

		// 2) Deadline: solo si el envío SIGUE sin entregarse tras procesar las
		//    llegadas de este paso. Un envío todavía en tránsito cuando t ya pasó
		//    su deadline es un incumplimiento de SLA real (24h/48h). Los envíos
		//    que vienen sin tramos o como rechazos operativos permanecen pendientes
		//    hasta que se supera el deadline y solo entonces se marcan como
		//    "rechazado" por SLA.
		if e.Estado != "entregado" && e.Estado != "rechazado" && e.DeadlineUTC > 0 && t > e.DeadlineUTC {
			estadoPrevio := e.Estado
			e.Estado = "rechazado"
			e.MotivoRechazo = "sla"
			// Liberar las maletas del almacén donde estaban esperando. Solo si
			// seguían registradas y sin despegar (pendiente=origen) o en escala.
			if e.Registrado && estadoPrevio == "pendiente" {
				if aero, ok := s.Aeropuertos[e.Origen]; ok && aero.MaletasAlmacen > 0 {
					aero.MaletasAlmacen -= e.Maletas
				}
			} else if estadoPrevio == "en_escala" && e.TramoActual < len(e.Tramos) {
				escala := e.Tramos[e.TramoActual].Desde
				if aero, ok := s.Aeropuertos[escala]; ok && aero.MaletasAlmacen > 0 {
					aero.MaletasAlmacen -= e.Maletas
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

	// 1) Sembrar aeropuertos con sus capacidades REALES (vienen del Planificador).
	for _, ap := range plan.Aeropuertos {
		cap := ap.Capacidad
		if cap <= 0 {
			cap = capacidadPorDefecto
		}
		s.Aeropuertos[ap.IATA] = &EstadoAeropuerto{
			IATA:             ap.IATA,
			CapacidadAlmacen: cap,
			Semaforo:         "verde",
		}
	}

	// 2) Cargar envíos. NO se suman maletas al almacén aquí: un envío ocupa el
	//    almacén origen solo desde que se REGISTRA (t >= RegistroUTC), no desde
	//    el inicio del plan. Sumarlas todas de golpe inflaba la ocupación muy por
	//    encima de la capacidad (p. ej. 1000/400 en un hub).
	for _, ep := range plan.Envios {
		e := EstadoEnvio{
			Indice:      ep.Indice,
			Origen:      ep.Origen,
			Destino:     ep.Destino,
			Maletas:     ep.Maletas,
			RegistroUTC: ep.RegistroUTC,
			DeadlineUTC: ep.DeadlineUTC,
			Estado:      "pendiente",
		}

		if len(ep.Tramos) > 0 {
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
			// Asegurar que el aeropuerto origen exista (si no vino en la lista de
			// capacidades, se crea con la capacidad por defecto).
			s.asegurarAeropuerto(e.Origen)
			// Asegurar también los aeropuertos de escala/destino de los tramos.
			for _, tr := range e.Tramos {
				s.asegurarAeropuerto(tr.Hasta)
			}
		} else {
			// Sin tramos o plan operativo rechazado: el envío se deja pendiente.
			// Solo se marcará "rechazado" si luego supera el deadline sin entrega.
			e.Tramos = nil
			s.asegurarAeropuerto(e.Origen)
		}
		s.Envios = append(s.Envios, e)
	}
}

const capacidadPorDefecto = 400

// asegurarAeropuerto crea el aeropuerto con capacidad por defecto si no existe.
func (s *Simulacion) asegurarAeropuerto(iata string) {
	if _, ok := s.Aeropuertos[iata]; !ok {
		s.Aeropuertos[iata] = &EstadoAeropuerto{
			IATA:             iata,
			CapacidadAlmacen: capacidadPorDefecto,
			Semaforo:         "verde",
		}
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

func (s *Simulacion) contarRechazosSLA() int {
	c := 0
	for _, e := range s.Envios {
		if e.Estado == "rechazado" && e.MotivoRechazo == "sla" {
			c++
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

// todosLosTramos devuelve todos los tramos del plan (para que el mapa los anime
// con el reloj continuo). Debe llamarse bajo s.mu.
func (s *Simulacion) todosLosTramos() []map[string]interface{} {
	out := make([]map[string]interface{}, 0, 1024)
	for i := range s.Envios {
		e := &s.Envios[i]
		for j := range e.Tramos {
			tr := &e.Tramos[j]
			out = append(out, map[string]interface{}{
				"envioIndice": e.Indice,
				"tramoIndex":  j,
				"desde":       tr.Desde,
				"hasta":       tr.Hasta,
				"salidaUTC":   tr.SalidaUTC,
				"llegadaUTC":  tr.LlegadaUTC,
				"maletas":     e.Maletas,
			})
		}
	}
	return out
}

// vuelosActivos devuelve los tramos EN VUELO en el instante t (salida ≤ t <
// llegada), para que el mapa dibuje los aviones. Debe llamarse bajo s.mu.
func (s *Simulacion) vuelosActivos(t int64) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, 256)
	for i := range s.Envios {
		e := &s.Envios[i]
		if e.Estado != "en_vuelo" {
			continue
		}
		for j := range e.Tramos {
			tr := &e.Tramos[j]
			if tr.Estado == "en_vuelo" && t >= tr.SalidaUTC && t < tr.LlegadaUTC {
				dur := tr.LlegadaUTC - tr.SalidaUTC
				prog := 0.0
				if dur > 0 {
					prog = float64(t-tr.SalidaUTC) / float64(dur)
				}
				out = append(out, map[string]interface{}{
					"desde":      tr.Desde,
					"hasta":      tr.Hasta,
					"salidaUTC":  tr.SalidaUTC,
					"llegadaUTC": tr.LlegadaUTC,
					"maletas":    e.Maletas,
					"progreso":   prog,
				})
			}
		}
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
