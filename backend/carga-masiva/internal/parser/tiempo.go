package parser

// Conversión de tiempo a UTC en minutos absolutos desde Epoch (1970-01-01).
//
// Réplica EXACTA de GestorDatos.calcularEpochMinutos / calcularDeadline del
// Planificador (Java), para que el valor precalculado en la carga masiva
// coincida bit a bit con lo que el Planificador esperaría. Algoritmo: Número de
// Día Juliano (Meeus), sin objetos de fecha.

// EpochMinutosUTC convierte una fecha/hora LOCAL del aeropuerto origen a minutos
// absolutos UTC, restando el offset GMT del origen.
//
//	anio, mes (1-12), dia (1-31), horaLoc (0-23), minLoc (0-59)
//	gmtHoras = offset UTC del aeropuerto origen (ej. -5 para Lima, +2 para Berlín)
func EpochMinutosUTC(anio, mes, dia, horaLoc, minLoc, gmtHoras int) int64 {
	// Paso 1: Número de Día Juliano (JDN) de la fecha gregoriana.
	a := (14 - mes) / 12
	y := anio + 4800 - a
	m := mes + 12*a - 3
	jdn := int64(dia) +
		(153*int64(m)+2)/5 +
		365*int64(y) +
		int64(y)/4 -
		int64(y)/100 +
		int64(y)/400 -
		32045

	// Paso 2: Días desde Epoch (JDN del 1970-01-01 = 2 440 588).
	epochDay := jdn - 2_440_588

	// Paso 3: Minutos locales desde Epoch.
	minutosLocales := epochDay*1440 + int64(horaLoc)*60 + int64(minLoc)

	// Paso 4: a UTC restando el offset GMT del origen.
	return minutosLocales - int64(gmtHoras)*60
}

// DeadlineUTC aplica la regla de SLA por continentes:
//
//	mismo continente    → registro + 1440 min (24 h)
//	distinto continente → registro + 2880 min (48 h)
func DeadlineUTC(registroUTC int64, continenteOrigen, continenteDestino int) int64 {
	if continenteOrigen == continenteDestino {
		return registroUTC + 1440
	}
	return registroUTC + 2880
}
