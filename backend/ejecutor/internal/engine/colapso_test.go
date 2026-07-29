package engine

import "testing"

func TestSim5DSoloSLANoColapsaPorOcupacionNiTa(t *testing.T) {
	sim := &Simulacion{
		Envios: []EstadoEnvio{{
			Indice:        1,
			Origen:        "SPIM",
			Destino:       "SKBO",
			Maletas:       10,
			DeadlineUTC:   200,
			Estado:        "pendiente",
			MotivoRechazo: "",
		}},
		Aeropuertos: map[string]*EstadoAeropuerto{
			"SPIM": {
				IATA:             "SPIM",
				CapacidadAlmacen: 100,
				MaletasAlmacen:   500,
				Semaforo:         "rojo",
			},
		},
	}

	o := &Orquestador{
		T0UTC:        100,
		Colapso:      &ConfigColapso{Habilitado: true, SoloSLA: true},
		colapsoRojos: make(map[string]int),
	}

	if res, ok := o.detectarColapso(sim, 999, 120, 150); ok || res != nil {
		t.Fatalf("Sim5D no debe colapsar por Ta ni ocupación: ok=%v res=%+v", ok, res)
	}
}

func TestSim5DSoloSLADetectaPrimerIncumplimiento(t *testing.T) {
	sim := &Simulacion{
		Envios: []EstadoEnvio{{
			Indice:        7,
			Origen:        "VIDP",
			Destino:       "SKBO",
			Maletas:       3,
			DeadlineUTC:   200,
			Estado:        "rechazado",
			MotivoRechazo: "sla",
		}},
		Aeropuertos: map[string]*EstadoAeropuerto{},
	}

	o := &Orquestador{
		T0UTC:        100,
		Colapso:      &ConfigColapso{Habilitado: true, SoloSLA: true},
		colapsoRojos: make(map[string]int),
	}

	res, ok := o.detectarColapso(sim, 0, 120, 201)
	if !ok || res == nil {
		t.Fatal("se esperaba colapso por el primer incumplimiento SLA")
	}
	if res.Tipo != "rechazos" {
		t.Fatalf("tipo=%q; quiero rechazos", res.Tipo)
	}
	if res.RechazosSLA != 1 {
		t.Fatalf("rechazos SLA=%d; quiero 1", res.RechazosSLA)
	}
}
