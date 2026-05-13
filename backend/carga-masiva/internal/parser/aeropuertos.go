package parser

import (
	"bufio"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"

	"golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
)

// rexIATA detecta un código IATA de 4 letras mayúsculas.
var rexIATA = regexp.MustCompile(`\b([A-Z]{4})\b`)

// ParseAeropuertos lee aeropuertos.txt (UTF-16 LE o UTF-8) y devuelve los 30 registros.
//
// Formato esperado por línea (campos separados por espacios):
//
//	01 SKBO Bogota Colombia BOG -5 430 Latitude 4.701389 Longitude -74.146944
//	   ↑ID  ↑IATA ↑ciudad  ↑país ↑alias ↑GMT ↑cap  ↑kw  ↑lat       ↑kw    ↑lng
//
// Encabezados de continente: líneas que contienen "america", "europa" o "asia" (case-insensitive).
func ParseAeropuertos(r io.Reader) ([]Aeropuerto, error) {
	// Intentar decodificar UTF-16 LE (con BOM), si falla leer como UTF-8.
	utf16r := transform.NewReader(r, unicode.UTF16(unicode.LittleEndian, unicode.UseBOM).NewDecoder())
	return parseAeropuertosReader(utf16r)
}

func parseAeropuertosReader(r io.Reader) ([]Aeropuerto, error) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 256*1024), 256*1024)

	var result []Aeropuerto
	continente := 1 // 1=América por defecto
	idActual := 1

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "*") || strings.HasPrefix(line, "PDDS") {
			continue
		}

		lower := strings.ToLower(line)
		if strings.Contains(lower, "america") || strings.Contains(lower, "améric") {
			continente = 1
			continue
		}
		if strings.Contains(lower, "europa") || strings.Contains(lower, "europe") {
			continente = 2
			continue
		}
		if strings.Contains(lower, "asia") {
			continente = 3
			continue
		}

		// Solo procesamos líneas con "Latitude" o "latitude"
		latIdx := strings.Index(lower, "latitude")
		if latIdx < 0 {
			continue
		}

		parts := strings.Fields(line)
		// Buscar el índice de "Latitude" dentro del slice
		kwIdx := -1
		for i, p := range parts {
			if strings.EqualFold(p, "latitude") {
				kwIdx = i
				break
			}
		}
		if kwIdx < 2 {
			continue
		}

		// GMT y capacidad están justo antes de "Latitude"
		gmt, err1 := parseGMT(parts[kwIdx-2])
		cap, err2 := strconv.Atoi(parts[kwIdx-1])
		if err1 != nil || err2 != nil {
			continue
		}

		// Latitud: siguiente token después de "Latitude"
		if kwIdx+1 >= len(parts) {
			continue
		}
		lat, err := strconv.ParseFloat(parts[kwIdx+1], 64)
		if err != nil {
			continue
		}

		// Longitud: 2 tokens después (kwIdx+2 = "Longitude", kwIdx+3 = valor)
		var lng float64
		if kwIdx+3 < len(parts) {
			lng, _ = strconv.ParseFloat(parts[kwIdx+3], 64)
		}

		// IATA: primera palabra de 4 letras mayúsculas en la línea
		iata := ""
		for _, p := range parts {
			if rexIATA.MatchString(p) && p == strings.ToUpper(p) {
				iata = p
				break
			}
		}
		if iata == "" {
			continue
		}

		// Ciudad y país: tokens entre IATA y la zona de GMT/cap
		// Búscamos la posición del IATA en parts para extraer ciudad y país
		ciudad, pais, alias := extractCiudadPaisAlias(parts, iata, kwIdx)

		result = append(result, Aeropuerto{
			ID:               idActual,
			IATA:             iata,
			Ciudad:           ciudad,
			Pais:             pais,
			Alias:            alias,
			GMTOffset:        gmt,
			CapacidadAlmacen: cap,
			Latitud:          lat,
			Longitud:         lng,
			Continente:       continente,
		})
		idActual++
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("scanner: %w", err)
	}
	if len(result) == 0 {
		return nil, fmt.Errorf("no se encontraron aeropuertos en el archivo")
	}
	return result, nil
}

// extractCiudadPaisAlias extrae ciudad, país y alias desde los tokens entre IATA y kwIdx.
// Layout aproximado: [id] [IATA] [ciudad] [pais] [alias] [gmt] [cap] Latitude ...
func extractCiudadPaisAlias(parts []string, iata string, kwIdx int) (ciudad, pais, alias string) {
	iataPos := -1
	for i, p := range parts {
		if p == iata {
			iataPos = i
			break
		}
	}
	if iataPos < 0 {
		return "Desconocido", "Desconocido", ""
	}
	// Entre IATA+1 y kwIdx-2 (GMT y cap) hay ciudad, pais y alias
	middle := parts[iataPos+1 : kwIdx-2]
	switch len(middle) {
	case 0:
		return "Desconocido", "Desconocido", ""
	case 1:
		return middle[0], "Desconocido", ""
	case 2:
		return middle[0], middle[1], ""
	case 3:
		return middle[0], middle[1], middle[2]
	default:
		// Ciudad puede ser multipalabra; último token es alias, penúltimo es país
		alias = middle[len(middle)-1]
		pais = middle[len(middle)-2]
		ciudad = strings.Join(middle[:len(middle)-2], " ")
		return ciudad, pais, alias
	}
}

func parseGMT(s string) (int, error) {
	s = strings.TrimPrefix(s, "+")
	return strconv.Atoi(s)
}
