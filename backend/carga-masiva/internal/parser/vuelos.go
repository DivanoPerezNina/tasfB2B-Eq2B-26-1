package parser

import (
	"bufio"
	"fmt"
	"io"
	"strconv"
	"strings"
)

// ParseVuelos lee vuelos.txt y devuelve los vuelos parseados.
//
// Formato de línea: ORIG-DEST-HH:MM-HH:MM-CAPACIDAD
// Ejemplo: SKBO-SEQM-19:00-07:00-220
//
// continenteMap: mapa IATA → continente (1=América, 2=Europa, 3=Asia)
// necesario para calcular mismo_continente.
func ParseVuelos(r io.Reader, continenteMap map[string]int) ([]Vuelo, error) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 256*1024), 256*1024)

	var result []Vuelo

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || !strings.Contains(line, "-") {
			continue
		}
		// Ignorar comentarios
		if strings.HasPrefix(line, "#") || strings.HasPrefix(line, "*") {
			continue
		}

		parts := strings.Split(line, "-")
		if len(parts) < 5 {
			continue
		}

		orig := strings.TrimSpace(parts[0])
		dest := strings.TrimSpace(parts[1])
		if len(orig) != 4 || len(dest) != 4 {
			continue
		}

		salMin, err1 := parseHHMM(strings.TrimSpace(parts[2]))
		lleMin, err2 := parseHHMM(strings.TrimSpace(parts[3]))
		if err1 != nil || err2 != nil {
			continue
		}
		cap, err := strconv.Atoi(strings.TrimSpace(parts[4]))
		if err != nil {
			continue
		}

		// Si llegada ≤ salida el vuelo cruza medianoche
		if lleMin <= salMin {
			lleMin += 1440
		}

		mismo := continenteMap[orig] == continenteMap[dest] &&
			continenteMap[orig] != 0

		result = append(result, Vuelo{
			OrigenIATA:      orig,
			DestinoIATA:     dest,
			SalidaMinutos:   salMin,
			LlegadaMinutos:  lleMin,
			CapacidadMax:    cap,
			MismoContinente: mismo,
		})
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("scanner: %w", err)
	}
	return result, nil
}

// parseHHMM convierte "HH:MM" a minutos desde medianoche.
func parseHHMM(s string) (int, error) {
	parts := strings.Split(s, ":")
	if len(parts) != 2 {
		return 0, fmt.Errorf("formato HH:MM inválido: %q", s)
	}
	h, err1 := strconv.Atoi(parts[0])
	m, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil {
		return 0, fmt.Errorf("parse HH:MM %q", s)
	}
	return h*60 + m, nil
}
