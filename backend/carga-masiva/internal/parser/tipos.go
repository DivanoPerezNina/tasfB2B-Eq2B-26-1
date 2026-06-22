package parser

// Aeropuerto es el DTO parseado de aeropuertos.txt y almacenado en MySQL.
type Aeropuerto struct {
	ID               int
	IATA             string
	Ciudad           string
	Pais             string
	Alias            string
	GMTOffset        int
	CapacidadAlmacen int
	Latitud          float64
	Longitud         float64
	Continente       int // 1=América 2=Europa 3=Asia
}

// Vuelo es el DTO parseado de vuelos.txt.
type Vuelo struct {
	OrigenIATA      string
	DestinoIATA     string
	SalidaMinutos   int // minutos UTC desde 00:00
	LlegadaMinutos  int // ídem; puede ser > 1440 si cruza medianoche
	CapacidadMax    int
	MismoContinente bool
}

// Envio es una fila de _envios_IATA_.txt.
type Envio struct {
	IDEnvio         string
	OrigenIATA      string
	FechaRegistro   string // "YYYY-MM-DD"
	Hora            int
	Minuto          int
	DestinoIATA     string
	CantidadMaletas int
	IDCliente       int
	// Precalculados en la carga (0 hasta que se calculan con el GMT/continente).
	RegistroUTC int64 // minutos UTC absolutos desde Epoch
	DeadlineUTC int64 // registro_utc + SLA (24h/48h)
}
