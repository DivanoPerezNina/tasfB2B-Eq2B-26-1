package engine

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

// capturador acumula los eventos SSE emitidos por la simulación de forma
// thread-safe, para poder hacer aserciones desde el test.
type capturador struct {
	mu      sync.Mutex
	eventos []string // solo los nombres de evento, en orden
}

func (c *capturador) fn() func(string, interface{}) {
	return func(evento string, _ interface{}) {
		c.mu.Lock()
		c.eventos = append(c.eventos, evento)
		c.mu.Unlock()
	}
}

func (c *capturador) cuenta(evento string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	n := 0
	for _, e := range c.eventos {
		if e == evento {
			n++
		}
	}
	return n
}

// primerIndice devuelve el índice del primer evento con ese nombre, o -1.
func (c *capturador) primerIndice(evento string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	for i, e := range c.eventos {
		if e == evento {
			return i
		}
	}
	return -1
}

// planJSON construye un plan sintético para los tests.
func planJSON(iniUTC, obsUTC, finUTC int64) string {
	// Dos envíos: uno registrado dentro del lookback (debe procesarse en el
	// warm-up) y otro dentro de la ventana visible.
	return fmt.Sprintf(`{
      "resumen": {
        "totalEnvios": 2, "exitosos": 2, "rechazados": 0,
        "ventanaIniUTC": %d, "ventanaFinUTC": %d, "observacionIniUTC": %d
      },
      "envios": [
        {"indice":0,"origen":"SKBO","destino":"SPIM","maletas":3,
         "registroUTC":%d,"deadlineUTC":%d,"estado":"Exitoso",
         "tramos":[{"vueloIdx":1,"desde":"SKBO","hasta":"SPIM","salidaUTC":%d,"llegadaUTC":%d}]},
        {"indice":1,"origen":"SEQM","destino":"SPIM","maletas":2,
         "registroUTC":%d,"deadlineUTC":%d,"estado":"Exitoso",
         "tramos":[{"vueloIdx":2,"desde":"SEQM","hasta":"SPIM","salidaUTC":%d,"llegadaUTC":%d}]}
      ]
    }`,
		iniUTC, finUTC, obsUTC,
		iniUTC, finUTC, iniUTC+30, iniUTC+90, // envío 0: viaja durante el warm-up
		obsUTC+10, finUTC, obsUTC+30, obsUTC+90, // envío 1: viaja en la ventana visible
	)
}

// TestAvanceTiempoReal verifica que el modo tiempo real es 1:1 con el reloj.
func TestAvanceTiempoReal(t *testing.T) {
	tick := time.Second
	s, err := Nueva("t", planJSON(1000, 1000, 2440), 0 /*tiempo real*/, Umbrales{}, tick)
	if err != nil {
		t.Fatalf("Nueva: %v", err)
	}
	want := tick.Seconds() / 60.0 // 1 seg real = 1/60 min sim = 1 seg sim
	if s.AvancePorTick != want {
		t.Errorf("avance tiempo real = %v; quiero %v (1:1)", s.AvancePorTick, want)
	}
	if s.ObservacionUTC != 1000 {
		t.Errorf("sin warm-up ObservacionUTC=%d; quiero 1000", s.ObservacionUTC)
	}
}

// TestWarmUp verifica que el pre-roll se ejecuta antes del tiempo real y que el
// orden de eventos es: warmup-progress* → warmup-completado → aeropuertos/tick.
func TestWarmUp(t *testing.T) {
	cap := &capturador{}
	// Plan: warm-up de 1440 min (1 día → 24 pasos), ventana visible de 120 min.
	// duracionRealMin=1 → avance visible alto; tick rápido para el test.
	s, err := Nueva("t", planJSON(1000, 1000+1440, 1000+1440+120), 1, Umbrales{}, 10*time.Millisecond)
	if err != nil {
		t.Fatalf("Nueva: %v", err)
	}
	s.Broadcast = cap.fn()

	if err := s.Iniciar(); err != nil {
		t.Fatalf("Iniciar: %v", err)
	}

	// Esperar a que aparezca warmup-completado (warm-up es casi instantáneo).
	esperar(t, 2*time.Second, func() bool { return cap.cuenta("warmup-completado") == 1 })

	// Debe haber reportado progreso de warm-up al menos una vez.
	if cap.cuenta("warmup-progress") == 0 {
		t.Error("no se emitió ningún warmup-progress")
	}

	// Esperar al menos un tick de tiempo real.
	esperar(t, 2*time.Second, func() bool { return cap.cuenta("tick") >= 1 })

	// El warm-up debe ocurrir ANTES del primer tick de tiempo real.
	iWarmFin := cap.primerIndice("warmup-completado")
	iTick := cap.primerIndice("tick")
	if iWarmFin < 0 || iTick < 0 || iWarmFin > iTick {
		t.Errorf("orden incorrecto: warmup-completado en %d, primer tick en %d", iWarmFin, iTick)
	}

	s.Detener()
	if s.GetEstado() != "detenido" {
		t.Errorf("tras Detener estado=%q; quiero detenido", s.GetEstado())
	}
}

// TestPausaReanudarDetener verifica el control del ciclo de vida sin warm-up.
func TestPausaReanudarDetener(t *testing.T) {
	cap := &capturador{}
	// Sin warm-up (obs == ini). Ventana 1000 min, duracionRealMin=10 → avance
	// moderado; tick rápido.
	s, err := Nueva("t", planJSON(1000, 1000, 2000), 10, Umbrales{}, 10*time.Millisecond)
	if err != nil {
		t.Fatalf("Nueva: %v", err)
	}
	s.Broadcast = cap.fn()

	if err := s.Iniciar(); err != nil {
		t.Fatalf("Iniciar: %v", err)
	}

	// Esperar a que avance (estado ejecutando, varios ticks).
	esperar(t, 2*time.Second, func() bool { return cap.cuenta("tick") >= 2 })
	if s.GetEstado() != "ejecutando" {
		t.Fatalf("estado=%q; quiero ejecutando", s.GetEstado())
	}

	// Pausar: el tiempo simulado debe congelarse.
	if err := s.Pausar(); err != nil {
		t.Fatalf("Pausar: %v", err)
	}
	if s.GetEstado() != "pausado" {
		t.Fatalf("estado=%q; quiero pausado", s.GetEstado())
	}
	tA := s.GetTiempoSim()
	time.Sleep(120 * time.Millisecond) // varios ticks de pared
	tB := s.GetTiempoSim()
	if tA != tB {
		t.Errorf("el tiempo avanzó durante la pausa: %v → %v", tA, tB)
	}

	// Pausar de nuevo debe fallar (ya pausado).
	if err := s.Pausar(); err == nil {
		t.Error("Pausar dos veces debería fallar")
	}

	// Reanudar: el tiempo vuelve a avanzar.
	if err := s.Reanudar(); err != nil {
		t.Fatalf("Reanudar: %v", err)
	}
	if s.GetEstado() != "ejecutando" {
		t.Fatalf("tras reanudar estado=%q; quiero ejecutando", s.GetEstado())
	}
	esperar(t, 2*time.Second, func() bool { return s.GetTiempoSim() > tB })

	// Detener: debe retornar pronto y dejar estado detenido.
	hecho := make(chan struct{})
	go func() { s.Detener(); close(hecho) }()
	select {
	case <-hecho:
	case <-time.After(2 * time.Second):
		t.Fatal("Detener se colgó (no retornó en 2s)")
	}
	if s.GetEstado() != "detenido" {
		t.Errorf("estado=%q; quiero detenido", s.GetEstado())
	}

	// Detener de nuevo no debe entrar en pánico ni colgarse.
	s.Detener()
}

// TestDetenerDuranteWarmUp asegura que Detener corta el warm-up sin colgarse.
func TestDetenerDuranteWarmUp(t *testing.T) {
	cap := &capturador{}
	// Warm-up enorme (muchos días) para tener tiempo de detenerlo en pleno vuelo.
	s, err := Nueva("t", planJSON(0, 200*1440, 200*1440+120), 5, Umbrales{}, 10*time.Millisecond)
	if err != nil {
		t.Fatalf("Nueva: %v", err)
	}
	s.Broadcast = cap.fn()
	if err := s.Iniciar(); err != nil {
		t.Fatalf("Iniciar: %v", err)
	}

	hecho := make(chan struct{})
	go func() { s.Detener(); close(hecho) }()
	select {
	case <-hecho:
	case <-time.After(2 * time.Second):
		t.Fatal("Detener durante warm-up se colgó")
	}
	if s.GetEstado() != "detenido" {
		t.Errorf("estado=%q; quiero detenido", s.GetEstado())
	}
}

// TestNoRechazoEspurioPorPasoGrande reproduce el bug donde un paso grande del
// warm-up (60 min) salta por encima de la llegada Y del deadline a la vez. El
// envío llega a tiempo (llegada < deadline) pero un orden incorrecto lo marcaba
// "rechazado". Tras el fix (procesar tramos antes del deadline) debe quedar
// "entregado".
func TestNoRechazoEspurioPorPasoGrande(t *testing.T) {
	// ini=1000, obs=1120 (warm-up de 2 pasos de 60), fin=1240.
	// Envío: registro=1000, deadline=1090; tramo salida=1010, llegada=1080.
	// Llega (1080) ANTES del deadline (1090) → debe entregarse, no rechazarse.
	// El paso de warm-up salta de t=1060 a t=1120, cruzando llegada y deadline.
	plan := `{
      "resumen": {"totalEnvios":1,"exitosos":1,"rechazados":0,
        "ventanaIniUTC":1000,"ventanaFinUTC":1240,"observacionIniUTC":1120},
      "envios": [
        {"indice":0,"origen":"SKBO","destino":"SPIM","maletas":2,
         "registroUTC":1000,"deadlineUTC":1090,"estado":"Exitoso",
         "tramos":[{"vueloIdx":1,"desde":"SKBO","hasta":"SPIM","salidaUTC":1010,"llegadaUTC":1080}]}
      ]
    }`
	cap := &capturador{}
	s, err := Nueva("t", plan, 1, Umbrales{}, 10*time.Millisecond)
	if err != nil {
		t.Fatalf("Nueva: %v", err)
	}
	s.Broadcast = cap.fn()
	if err := s.Iniciar(); err != nil {
		t.Fatalf("Iniciar: %v", err)
	}

	// El warm-up es instantáneo; esperar a que entre en tiempo real.
	esperar(t, 2*time.Second, func() bool { return cap.cuenta("warmup-completado") == 1 })

	cont := s.GetContadores()
	if cont.Rechazado != 0 {
		t.Errorf("rechazo espurio: Rechazado=%d (debería ser 0; el envío llegó a tiempo)", cont.Rechazado)
	}
	if cont.Entregado != 1 {
		t.Errorf("Entregado=%d; quiero 1 (el envío llegó antes del deadline)", cont.Entregado)
	}
	s.Detener()
}

// TestOcupacionRespetaRegistro verifica que un envío NO ocupa el almacén origen
// hasta que se registra (t >= RegistroUTC), y que sale al despegar. Antes se
// sumaban todas las maletas al cargar el plan → ocupación inflada (1000/400).
func TestOcupacionRespetaRegistro(t *testing.T) {
	// Envío registrado en t=2000, vuela en [3000, 3500]. Capacidad real 430.
	plan := `{
      "resumen": {"totalEnvios":1,"exitosos":1,"rechazados":0,
        "ventanaIniUTC":1000,"ventanaFinUTC":5000,"observacionIniUTC":1000},
      "aeropuertos": [{"iata":"SKBO","capacidad":430},{"iata":"SPIM","capacidad":440}],
      "envios": [
        {"indice":0,"origen":"SKBO","destino":"SPIM","maletas":50,
         "registroUTC":2000,"deadlineUTC":3440,"estado":"Exitoso",
         "tramos":[{"vueloIdx":1,"desde":"SKBO","hasta":"SPIM","salidaUTC":3000,"llegadaUTC":3500}]}
      ]
    }`
	s, err := Nueva("t", plan, 10, Umbrales{}, time.Second)
	if err != nil {
		t.Fatalf("Nueva: %v", err)
	}

	// Capacidad real cargada del plan (no el default 400).
	if s.Aeropuertos["SKBO"].CapacidadAlmacen != 430 {
		t.Errorf("capacidad SKBO=%d; quiero 430 (del plan)", s.Aeropuertos["SKBO"].CapacidadAlmacen)
	}
	// Al cargar, el almacén NO debe tener maletas todavía.
	if got := s.Aeropuertos["SKBO"].MaletasAlmacen; got != 0 {
		t.Errorf("tras cargar, almacén SKBO=%d; quiero 0 (aún no registrado)", got)
	}

	// Antes del registro: sigue en 0.
	s.procesarEventos(1500)
	if got := s.Aeropuertos["SKBO"].MaletasAlmacen; got != 0 {
		t.Errorf("t=1500 (antes de registro): almacén=%d; quiero 0", got)
	}

	// Registrado pero aún sin despegar: 50 maletas en almacén.
	s.procesarEventos(2500)
	if got := s.Aeropuertos["SKBO"].MaletasAlmacen; got != 50 {
		t.Errorf("t=2500 (registrado, sin despegar): almacén=%d; quiero 50", got)
	}

	// Tras despegar: el almacén origen vuelve a 0.
	s.procesarEventos(3200)
	if got := s.Aeropuertos["SKBO"].MaletasAlmacen; got != 0 {
		t.Errorf("t=3200 (en vuelo): almacén SKBO=%d; quiero 0", got)
	}
}

// esperar hace polling de una condición hasta timeout.
func esperar(t *testing.T, timeout time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timeout esperando condición tras %v", timeout)
}
