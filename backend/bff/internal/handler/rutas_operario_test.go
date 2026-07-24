package handler

import "testing"

// El archivo de rutas del curso viene con líneas de comentario (**) y el
// formato ORIG-DEST-HH:MM-HH:MM-CAP. Este test fija el parseo de la hora, que
// es lo único con lógica real en esa ruta.
func TestParseHHMMaMinutos(t *testing.T) {
	casos := []struct {
		in      string
		quiere  int
		wantErr bool
	}{
		{"00:00", 0, false},
		{"09:12", 552, false},
		{"23:59", 1439, false},
		{" 14:30 ", 870, false}, // el split del archivo deja espacios
		{"24:00", 0, true},      // hora fuera de rango
		{"12:60", 0, true},      // minuto fuera de rango
		{"1230", 0, true},       // sin ':'
		{"ab:cd", 0, true},
	}
	for _, c := range casos {
		got, err := parseHHMMaMinutos(c.in)
		if c.wantErr {
			if err == nil {
				t.Errorf("parseHHMMaMinutos(%q) = %d, se esperaba error", c.in, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("parseHHMMaMinutos(%q) error inesperado: %v", c.in, err)
		} else if got != c.quiere {
			t.Errorf("parseHHMMaMinutos(%q) = %d, se esperaba %d", c.in, got, c.quiere)
		}
	}
}

// validarRuta normaliza el IATA y rechaza lo que rompería la planificación.
// Ojo con la llegada: puede pasar de 1440 porque un vuelo cruza medianoche.
func TestValidarRuta(t *testing.T) {
	ok := rutaInput{OrigenIATA: "spim", DestinoIATA: "scel", SalidaMinutos: 720, LlegadaMinutos: 1080, CapacidadMax: 150}
	if err := validarRuta(&ok); err != nil {
		t.Fatalf("ruta válida rechazada: %v", err)
	}
	if ok.OrigenIATA != "SPIM" || ok.DestinoIATA != "SCEL" {
		t.Errorf("no normalizó el IATA a mayúsculas: %+v", ok)
	}

	cruzaMedianoche := rutaInput{OrigenIATA: "SPIM", DestinoIATA: "EBCI", SalidaMinutos: 1400, LlegadaMinutos: 1800, CapacidadMax: 150}
	if err := validarRuta(&cruzaMedianoche); err != nil {
		t.Errorf("una llegada >1440 (cruza medianoche) debe aceptarse: %v", err)
	}

	malos := map[string]rutaInput{
		"mismo origen y destino": {OrigenIATA: "SPIM", DestinoIATA: "SPIM", SalidaMinutos: 720, LlegadaMinutos: 1080, CapacidadMax: 150},
		"origen vacío":           {OrigenIATA: "", DestinoIATA: "SCEL", SalidaMinutos: 720, LlegadaMinutos: 1080, CapacidadMax: 150},
		"capacidad cero":         {OrigenIATA: "SPIM", DestinoIATA: "SCEL", SalidaMinutos: 720, LlegadaMinutos: 1080, CapacidadMax: 0},
		"salida fuera de rango":  {OrigenIATA: "SPIM", DestinoIATA: "SCEL", SalidaMinutos: 1440, LlegadaMinutos: 1500, CapacidadMax: 150},
	}
	for nombre, in := range malos {
		copia := in
		if err := validarRuta(&copia); err == nil {
			t.Errorf("%s: se esperaba error y pasó la validación", nombre)
		}
	}
}
