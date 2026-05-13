package parser

import (
	"bufio"
	"fmt"
	"io"
	"strconv"
	"strings"
	"unicode"

	textunicode "golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
)

// ParseAeropuertos lee aeropuertos.txt (UTF-16 BE/LE con BOM) y devuelve los registros.
//
// Formato real de cada línea de aeropuerto:
//
//	01   SKBO   Bogota   Colombia   bogo   -5   430   Latitude: 04° 42' 05" N   Longitude:  74° 08' 49" W
func ParseAeropuertos(r io.Reader) ([]Aeropuerto, error) {
	// El archivo viene con BOM; UseBOM detecta automáticamente BE o LE.
	dec := textunicode.UTF16(textunicode.LittleEndian, textunicode.UseBOM).NewDecoder()
	return parseAeropuertosReader(transform.NewReader(r, dec))
}

func parseAeropuertosReader(r io.Reader) ([]Aeropuerto, error) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 256*1024), 256*1024)

	var result []Aeropuerto
	continente := 1 // 1=América, 2=Europa, 3=Asia
	idActual := 1

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		lower := strings.ToLower(line)

		// Saltar encabezados y comentarios
		if strings.HasPrefix(lower, "*") ||
			strings.HasPrefix(lower, "pdds") ||
			strings.HasPrefix(lower, "#") {
			continue
		}

		// Detectar sección de continente
		if strings.Contains(lower, "america") || strings.Contains(lower, "améric") ||
			strings.Contains(lower, "sur") && strings.Contains(lower, "norte") {
			continente = 1
			continue
		}
		if strings.Contains(lower, "europa") || strings.Contains(lower, "europe") {
			continente = 2
			continue
		}
		if strings.Contains(lower, "asia") && !strings.Contains(lower, "latitude") {
			continente = 3
			continue
		}

		// Solo líneas que contengan "latitude" (con o sin dos puntos)
		if !strings.Contains(lower, "latitude") {
			continue
		}

		parts := strings.Fields(line)

		// Buscar el índice de "Latitude" (puede ser "Latitude:" con colon)
		kwIdx := -1
		for i, p := range parts {
			if strings.EqualFold(strings.TrimRight(p, ":"), "latitude") {
				kwIdx = i
				break
			}
		}
		if kwIdx < 2 {
			continue
		}

		// GMT: 2 posiciones antes de Latitude
		gmt, err := parseGMT(parts[kwIdx-2])
		if err != nil {
			continue
		}
		// Capacidad: 1 posición antes de Latitude
		cap, err := strconv.Atoi(parts[kwIdx-1])
		if err != nil {
			continue
		}

		// IATA: primera palabra de exactamente 4 letras mayúsculas en la línea
		iata := ""
		for _, p := range parts {
			if len(p) == 4 && isAllUpper(p) {
				iata = p
				break
			}
		}
		if iata == "" {
			continue
		}

		// Ciudad, país, alias: tokens entre IATA y kwIdx-2
		ciudad, pais, alias := extractCiudadPaisAlias(parts, iata, kwIdx)

		// Latitud: DMS en las 4 posiciones tras "Latitude:" → "04°" "42'" "05\"" "N"
		lat := parseDMS(parts, kwIdx+1)

		// Longitud: buscar "Longitude:" y tomar las 4 posiciones siguientes
		var lng float64
		for j := kwIdx + 1; j < len(parts); j++ {
			if strings.EqualFold(strings.TrimRight(parts[j], ":"), "longitude") {
				lng = parseDMS(parts, j+1)
				break
			}
		}

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

// parseDMS convierte coordenadas DMS a decimal.
// Espera 4 tokens consecutivos a partir de startIdx: "04°" "42'" "05\"" "N|S|E|W"
// Si el formato es inválido devuelve 0.0 sin error (latitud/longitud opcionales).
func parseDMS(parts []string, startIdx int) float64 {
	if startIdx+3 >= len(parts) {
		return 0
	}
	deg, err1 := strconv.ParseFloat(stripNonDigits(parts[startIdx]), 64)
	min, err2 := strconv.ParseFloat(stripNonDigits(parts[startIdx+1]), 64)
	sec, err3 := strconv.ParseFloat(stripNonDigits(parts[startIdx+2]), 64)
	if err1 != nil || err2 != nil || err3 != nil {
		return 0
	}
	dir := strings.ToUpper(parts[startIdx+3])
	decimal := deg + min/60.0 + sec/3600.0
	if dir == "S" || dir == "W" {
		decimal = -decimal
	}
	return decimal
}

// stripNonDigits elimina todo carácter que no sea dígito ni punto decimal.
func stripNonDigits(s string) string {
	var b strings.Builder
	for _, r := range s {
		if unicode.IsDigit(r) || r == '.' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// isAllUpper devuelve true si todos los runes de s son letras mayúsculas ASCII.
func isAllUpper(s string) bool {
	for _, r := range s {
		if r < 'A' || r > 'Z' {
			return false
		}
	}
	return true
}

// extractCiudadPaisAlias extrae ciudad, país y alias desde los tokens entre IATA y kwIdx.
func extractCiudadPaisAlias(parts []string, iata string, kwIdx int) (ciudad, pais, alias string) {
	iataPos := -1
	for i, p := range parts {
		if p == iata {
			iataPos = i
			break
		}
	}
	if iataPos < 0 || kwIdx-2 <= iataPos+1 {
		return "Desconocido", "Desconocido", ""
	}
	// Tokens entre IATA+1 y kwIdx-3 (exclusive): ciudad, pais, alias
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
		// Último token = alias, penúltimo = país, resto = ciudad (puede ser multipalabra)
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
