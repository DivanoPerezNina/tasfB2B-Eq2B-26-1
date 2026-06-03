package engine

// ── Tipos del plan recibido desde el Planificador ────────────────────────────

type PlanResponse struct {
	Resumen     ResumenPlan       `json:"resumen"`
	Envios      []EnvioPlan       `json:"envios"`
	Aeropuertos []AeropuertoPlan  `json:"aeropuertos"` // capacidades reales de almacén
}

// AeropuertoPlan trae la capacidad real de almacén de cada aeropuerto, para que
// el Ejecutor no use un valor por defecto al calcular ocupación y semáforo.
type AeropuertoPlan struct {
	IATA      string `json:"iata"`
	Capacidad int    `json:"capacidad"`
}

type ResumenPlan struct {
	TotalEnvios   int   `json:"totalEnvios"`
	Exitosos      int   `json:"exitosos"`
	Rechazados    int   `json:"rechazados"`
	VentanaIniUTC int64 `json:"ventanaIniUTC"` // inicio del PLAN (= inicio del pre-roll de warm-up)
	VentanaFinUTC int64 `json:"ventanaFinUTC"` // fin del periodo simulado
	// ObservacionIniUTC marca el instante donde arranca la simulación VISIBLE en
	// tiempo real. Con warm-up: VentanaIniUTC < ObservacionIniUTC (el tramo previo
	// se reproduce a máxima velocidad para sembrar el estado de la red). Sin
	// warm-up el planificador lo deja igual a VentanaIniUTC (no hay pre-roll).
	ObservacionIniUTC int64 `json:"observacionIniUTC"`
}

type EnvioPlan struct {
	Indice      int         `json:"indice"`
	Origen      string      `json:"origen"`
	Destino     string      `json:"destino"`
	Maletas     int         `json:"maletas"`
	RegistroUTC int64       `json:"registroUTC"`
	DeadlineUTC int64       `json:"deadlineUTC"`
	Estado      string      `json:"estado"` // "Exitoso" | "Rechazado"
	Tramos      []TramoPlan `json:"tramos"`
}

type TramoPlan struct {
	VueloIdx   int    `json:"vueloIdx"`
	Desde      string `json:"desde"`
	Hasta      string `json:"hasta"`
	SalidaUTC  int64  `json:"salidaUTC"`
	LlegadaUTC int64  `json:"llegadaUTC"`
}

// ── Estado en memoria durante la simulación ──────────────────────────────────

// EstadoEnvio representa un envío durante la simulación.
type EstadoEnvio struct {
	Indice      int
	Origen      string
	Destino     string
	Maletas     int
	RegistroUTC int64
	DeadlineUTC int64
	Tramos      []TramoSim
	TramoActual int    // índice del tramo actual (0, 1, 2)
	Estado      string // pendiente|en_vuelo|en_escala|entregado|rechazado
	Registrado  bool   // true cuando el envío ya ingresó al almacén origen (t >= RegistroUTC)
}

// TramoSim es un tramo individual de la ruta de un envío.
type TramoSim struct {
	VueloIdx   int
	Desde      string
	Hasta      string
	SalidaUTC  int64
	LlegadaUTC int64
	Estado     string // pendiente|en_vuelo|completado
}

// EstadoAeropuerto es el estado en memoria de un aeropuerto.
type EstadoAeropuerto struct {
	IATA             string
	CapacidadAlmacen int
	MaletasAlmacen   int    // maletas actualmente en espera
	Semaforo         string // verde|ambar|rojo
}

// Umbrales para el cálculo del semáforo.
type Umbrales struct {
	VerdeHasta float64 // porcentaje de ocupación máxima para verde (ej. 0.60)
	AmbarHasta float64 // porcentaje de ocupación máxima para ámbar (ej. 0.85)
}

// Contadores globales de estado de envíos.
type Contadores struct {
	Total     int `json:"total"`
	Pendiente int `json:"pendiente"`
	EnVuelo   int `json:"en_vuelo"`
	EnEscala  int `json:"en_escala"`
	Entregado int `json:"entregado"`
	Rechazado int `json:"rechazado"`
}
