package parser

import (
	"bufio"
	"fmt"
	"io"
	"strconv"
	"strings"
)

// Cancelacion es una fila del archivo de cancelaciones (CSV).
//
// Formato de línea: origen,destino,fecha,hora
//   - fecha = "YYYY-MM-DD"
//   - hora  = "HH:MM" en hora LOCAL del aeropuerto de origen
//
// SalidaUTC se calcula en el handler con el GMT del origen (igual que envios).
type Cancelacion struct {
	Origen    string
	Destino   string
	Fecha     string // "YYYY-MM-DD"
	Hora      int
	Minuto    int
	SalidaUTC int64 // minuto UTC absoluto; lo rellena el handler
}

// ParseCancelaciones lee el CSV de cancelaciones. Tolerante por diseño: ignora
// líneas vacías, comentarios (#), una cabecera opcional y filas malformadas. NO
// valida contra el catálogo de vuelos: el archivo puede contener rutas o fechas
// inexistentes y simplemente no afectarán la simulación.
func ParseCancelaciones(r io.Reader) ([]Cancelacion, error) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 256*1024), 256*1024)

	var out []Cancelacion
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		// Separador coma (CSV) o punto y coma.
		sep := ","
		if !strings.Contains(line, ",") && strings.Contains(line, ";") {
			sep = ";"
		}
		p := strings.Split(line, sep)
		if len(p) < 4 {
			continue
		}

		origen := strings.ToUpper(strings.TrimSpace(p[0]))
		destino := strings.ToUpper(strings.TrimSpace(p[1]))
		fecha := strings.TrimSpace(p[2])
		hm := strings.TrimSpace(p[3])

		// Cabecera o IATA inválida → se ignora.
		if len(origen) != 4 || len(destino) != 4 {
			continue
		}

		h, m, errHM := parseHoraMinuto(hm)
		if errHM != nil || !esFechaISO(fecha) {
			continue
		}

		out = append(out, Cancelacion{
			Origen: origen, Destino: destino, Fecha: fecha, Hora: h, Minuto: m,
		})
	}
	if err := sc.Err(); err != nil {
		return nil, fmt.Errorf("scanner: %w", err)
	}
	return out, nil
}

func parseHoraMinuto(s string) (int, int, error) {
	parts := strings.Split(s, ":")
	if len(parts) != 2 {
		return 0, 0, fmt.Errorf("hora HH:MM inválida: %q", s)
	}
	h, e1 := strconv.Atoi(strings.TrimSpace(parts[0]))
	m, e2 := strconv.Atoi(strings.TrimSpace(parts[1]))
	if e1 != nil || e2 != nil {
		return 0, 0, fmt.Errorf("hora HH:MM inválida: %q", s)
	}
	return h, m, nil
}

func esFechaISO(s string) bool {
	return len(s) == 10 && s[4] == '-' && s[7] == '-'
}
