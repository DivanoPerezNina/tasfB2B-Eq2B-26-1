package engine

import "fmt"

func (o *Orquestador) colapsoHabilitado() bool {
	return o.Colapso != nil && o.Colapso.Habilitado
}

func (o *Orquestador) detectarColapso(sim *Simulacion, taSeg, saSeg float64, tiempoSimUTC int64) (*ResultadoColapso, bool) {
	if !o.colapsoHabilitado() {
		return nil, false
	}

	sim.mu.RLock()
	aeropuertos := sim.snapshotAeropuertos()
	cont := sim.calcularContadores()
	rechazosSLA := sim.contarRechazosSLA()
	detalleSLA := sim.detalleRechazosSLA(3)
	sim.mu.RUnlock()

	// 1) Colapso técnico: la planificación tarda tanto o más que el intervalo Sa.
	// Sim5D por aproximaciones usa exclusivamente el criterio académico de SLA.
	if !o.Colapso.SoloSLA && taSeg >= saSeg {
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
	if cont.Total > 0 {
		if rechazosSLA > 0 {
			motivo := fmt.Sprintf("primer incumplimiento SLA detectado: %d envío(s) superan deadline 24/48h", rechazosSLA)
			if detalleSLA != "" {
				motivo = fmt.Sprintf("%s | detalle: %s", motivo, detalleSLA)
			}
			resultado := o.nuevoResultadoColapso(
				"rechazos",
				motivo,
				"",
				0,
				taSeg,
				saSeg,
				tiempoSimUTC,
				cont,
			)
			resultado.RechazosSLA = rechazosSLA
			return resultado, true
		}
	}

	// Sim5D por aproximaciones no debe detenerse por almacenes rojos: el
	// enunciado define colapso como la primera maleta que incumple su entrega.
	if o.Colapso.SoloSLA {
		return nil, false
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
	return &ResultadoColapso{
		Tipo:         tipo,
		Motivo:       motivo,
		Aeropuerto:   aeropuerto,
		Ocupacion:    ocupacion,
		TaSeg:        taSeg,
		SaSeg:        saSeg,
		TiempoSimUTC: tiempoSimUTC,
		DiaSimulado:  o.diaSimulado(tiempoSimUTC),
		Contadores:   cont,
	}
}

func (o *Orquestador) diaSimulado(tiempoSimUTC int64) int {
	dia := int((tiempoSimUTC - o.T0UTC) / 1440)
	if dia < 0 {
		dia = 0
	}
	return dia + 1
}
