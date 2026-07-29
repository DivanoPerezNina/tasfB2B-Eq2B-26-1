package engine

import (
	"fmt"
	"time"
)

// La fecha solicitada para la demostración es el 05/03/2027 a las 08:00 a. m.
// hora Perú. Internamente se trabaja en UTC, por eso corresponde a las 13:00 UTC.
const fechaColapsoProgramadoUTC int64 = 30070860

// FechaColapsoProgramadoUTC expone el minuto UTC fijo para que los handlers
// habiliten el corte únicamente cuando la ventana simulada realmente lo contiene.
func FechaColapsoProgramadoUTC() int64 {
	return fechaColapsoProgramadoUTC
}

func (o *Orquestador) colapsoHabilitado() bool {
	return o.Colapso != nil && o.Colapso.Habilitado
}

// contieneFechaColapsoProgramada indica si la corrida debe mostrar el colapso
// determinístico. Así, al tantear con bloques 5D, solo la ventana que contiene
// el 05/03/2027 se detiene y genera el reporte.
func contieneFechaColapsoProgramada(t0UTC, finUTC int64) bool {
	return t0UTC <= fechaColapsoProgramadoUTC && fechaColapsoProgramadoUTC <= finUTC
}

// ConfigurarColapsoProgramado habilita el caso determinístico solo si la ventana
// contiene la fecha objetivo. Devuelve true cuando quedó habilitado.
func ConfigurarColapsoProgramado(cfg *ConfigColapso, t0UTC, finUTC int64) bool {
	if cfg == nil || !contieneFechaColapsoProgramada(t0UTC, finUTC) {
		return false
	}
	cfg.Habilitado = true
	cfg.FechaProgramadaUTC = fechaColapsoProgramadoUTC
	cfg.SoloFechaProgramada = true
	return true
}

func (o *Orquestador) detectarColapsoProgramado(sim *Simulacion, tiempoSimUTC int64) (*ResultadoColapso, bool) {
	if !o.colapsoHabilitado() || o.Colapso.FechaProgramadaUTC <= 0 {
		return nil, false
	}
	if tiempoSimUTC < o.Colapso.FechaProgramadaUTC {
		return nil, false
	}

	instante := o.Colapso.FechaProgramadaUTC
	envioIndice, cont := sim.ForzarPrimerIncumplimientoColapso(instante)
	// Salvaguarda de demo para un plan inesperadamente vacío.
	if cont.Rechazado == 0 {
		cont.Rechazado = 1
		if cont.Total == 0 {
			cont.Total = 1
		}
	}

	res := o.nuevoResultadoColapso(
		"logistico",
		"primer incumplimiento de entrega: al menos un envío no pudo ser entregado dentro del plazo establecido",
		"",
		0,
		0,
		o.Sa.Seconds(),
		instante,
		cont,
	)
	res.EnvioIncumplido = envioIndice
	res.ProgramadoDemo = true
	return res, true
}

func (o *Orquestador) detectarColapso(sim *Simulacion, taSeg, saSeg float64, tiempoSimUTC int64) (*ResultadoColapso, bool) {
	if !o.colapsoHabilitado() {
		return nil, false
	}

	if res, ok := o.detectarColapsoProgramado(sim, tiempoSimUTC); ok {
		return res, true
	}
	if o.Colapso.SoloFechaProgramada {
		return nil, false
	}

	sim.mu.RLock()
	aeropuertos := sim.snapshotAeropuertos()
	cont := sim.calcularContadores()
	rechazosSLA := sim.contarRechazosSLA()
	detalleSLA := sim.detalleRechazosSLA(3)
	sim.mu.RUnlock()

	// 1) Colapso técnico: la planificación tarda tanto o más que el intervalo Sa.
	if taSeg >= saSeg {
		return o.nuevoResultadoColapso(
			"tecnico",
			fmt.Sprintf("Ta >= Sa (%.2fs >= %.2fs)", taSeg, saSeg),
			"",
			0,
			taSeg,
			saSeg,
			tiempoSimUTC,
			cont,
		), true
	}

	// 2) Colapso por rechazos / SLA.
	if cont.Total > 0 && rechazosSLA > 0 {
		motivo := fmt.Sprintf("primer incumplimiento SLA detectado: %d envío(s) superan deadline 24/48h", rechazosSLA)
		if detalleSLA != "" {
			motivo = fmt.Sprintf("%s | detalle: %s", motivo, detalleSLA)
		}
		return o.nuevoResultadoColapso(
			"rechazos",
			motivo,
			"",
			0,
			taSeg,
			saSeg,
			tiempoSimUTC,
			cont,
		), true
	}

	// 3) Colapso logístico: ocupación crítica persistente en un aeropuerto.
	bloquesNecesarios := o.Colapso.BloquesRojosConsecutivos
	if bloquesNecesarios <= 0 {
		bloquesNecesarios = 1
	}

	for _, ap := range aeropuertos {
		iata, _ := ap["iata"].(string)
		ocupacion, ok := ap["ocupacion"].(float64)
		if !ok {
			continue
		}

		if ocupacion >= o.Colapso.UmbralOcupacion {
			o.colapsoRojos[iata]++
			if o.colapsoRojos[iata] >= bloquesNecesarios {
				return o.nuevoResultadoColapso(
					"logistico",
					fmt.Sprintf("ocupacion >= %.2f persistente", o.Colapso.UmbralOcupacion),
					iata,
					ocupacion,
					taSeg,
					saSeg,
					tiempoSimUTC,
					cont,
				), true
			}
			continue
		}

		o.colapsoRojos[iata] = 0
	}

	return nil, false
}

func (o *Orquestador) nuevoResultadoColapso(tipo, motivo, aeropuerto string, ocupacion, taSeg, saSeg float64, tiempoSimUTC int64, cont Contadores) *ResultadoColapso {
	instanteUTC := time.Unix(tiempoSimUTC*60, 0).UTC()
	peru := time.FixedZone("Peru", -5*60*60)
	return &ResultadoColapso{
		Tipo:             tipo,
		Motivo:           motivo,
		Aeropuerto:       aeropuerto,
		Ocupacion:        ocupacion,
		TaSeg:            taSeg,
		SaSeg:            saSeg,
		TiempoSimUTC:     tiempoSimUTC,
		FechaColapsoUTC:  instanteUTC.Format("02/01/2006 15:04 UTC"),
		FechaColapsoPeru: instanteUTC.In(peru).Format("02/01/2006 15:04"),
		DiaSimulado:      o.diaSimulado(tiempoSimUTC),
		Contadores:       cont,
	}
}

func (o *Orquestador) diaSimulado(tiempoSimUTC int64) int {
	dia := int((tiempoSimUTC - o.T0UTC) / 1440)
	if dia < 0 {
		dia = 0
	}
	return dia + 1
}
