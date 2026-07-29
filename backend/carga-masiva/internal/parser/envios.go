package parser

import (
	"bufio"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"
)

var rexEnvioFilename = regexp.MustCompile(`_envios_([A-Z]{4})_\.txt$`)

// IATADeNombreArchivo extrae el código IATA del nombre del archivo.
// Ejemplo: "_envios_SKBO_.txt" → "SKBO"
func IATADeNombreArchivo(nombre string) (string, error) {
	m := rexEnvioFilename.FindStringSubmatch(nombre)
	if m == nil {
		return "", fmt.Errorf("nombre de archivo no sigue patrón _envios_IATA_.txt: %q", nombre)
	}
	return m[1], nil
}

// ParseEnvios lee _envios_IATA_.txt línea a línea e invoca callback por cada
// lote de batchSize registros. Diseñado para streaming de archivos de ~13 MB.
//
// Formato de línea: 00000001-20250102-01-38-EBCI-006-0007729
//
//	↑id_envio ↑aaaammdd ↑hh ↑mm ↑dest ↑maletas ↑id_cliente
func ParseEnvios(r io.Reader, origenIATA string, batchSize int, fechaMaxInclusive string,
	callback func([]Envio) error) (total int, cortePorFecha bool, err error) {

	scanner := bufio.NewReaderSize(r, 65536)
	var batch []Envio

	for {
		line, err := scanner.ReadString('\n')
		line = strings.TrimSpace(line)

		if line != "" && strings.Contains(line, "-") {
			envio, parseErr := parseLineaEnvio(line, origenIATA)
			if parseErr == nil {
				// Los archivos del dataset vienen ordenados cronológicamente. En
				// Colapso solo se necesita información hasta el 31/03/2027; al
				// encontrar la primera fila posterior, se confirma el lote pendiente
				// y se deja de leer el resto del archivo. Esto evita procesar gigabytes
				// de datos que nunca serán usados por la simulación.
				if fechaMaxInclusive != "" && envio.FechaRegistro > fechaMaxInclusive {
					if len(batch) > 0 {
						if cbErr := callback(batch); cbErr != nil {
							return total, true, cbErr
						}
					}
					return total, true, nil
				}

				batch = append(batch, envio)
				total++
				if len(batch) >= batchSize {
					if cbErr := callback(batch); cbErr != nil {
						return total, false, cbErr
					}
					batch = batch[:0]
				}
			}
		}

		if err == io.EOF {
			break
		}
		if err != nil {
			return total, false, fmt.Errorf("lectura: %w", err)
		}
	}

	// Último lote parcial
	if len(batch) > 0 {
		if cbErr := callback(batch); cbErr != nil {
			return total, false, cbErr
		}
	}
	return total, false, nil
}

// parseLineaEnvio parsea una línea individual del archivo de envíos.
func parseLineaEnvio(line, origenIATA string) (Envio, error) {
	// split con límite 7 para no romper si id_cliente tiene guiones
	parts := strings.SplitN(line, "-", 7)
	if len(parts) < 6 {
		return Envio{}, fmt.Errorf("campos insuficientes: %d", len(parts))
	}

	idEnvio := strings.TrimSpace(parts[0])
	fechaStr := strings.TrimSpace(parts[1]) // "YYYYMMDD"
	horaStr := strings.TrimSpace(parts[2])
	minStr := strings.TrimSpace(parts[3])
	destIATA := strings.TrimSpace(parts[4])
	maletasStr := strings.TrimSpace(parts[5])

	if len(idEnvio) == 0 || len(fechaStr) != 8 || len(destIATA) != 4 {
		return Envio{}, fmt.Errorf("formato inválido")
	}

	hora, err1 := strconv.Atoi(horaStr)
	min, err2 := strconv.Atoi(minStr)
	maletas, err3 := strconv.Atoi(maletasStr)
	if err1 != nil || err2 != nil || err3 != nil {
		return Envio{}, fmt.Errorf("parse numérico")
	}

	var idCliente int
	if len(parts) >= 7 {
		idCliente, _ = strconv.Atoi(strings.TrimSpace(parts[6]))
	}

	// Convertir YYYYMMDD a "YYYY-MM-DD"
	fecha := fmt.Sprintf("%s-%s-%s",
		fechaStr[0:4], fechaStr[4:6], fechaStr[6:8])

	return Envio{
		IDEnvio:         idEnvio,
		OrigenIATA:      origenIATA,
		FechaRegistro:   fecha,
		Hora:            hora,
		Minuto:          min,
		DestinoIATA:     destIATA,
		CantidadMaletas: maletas,
		IDCliente:       idCliente,
	}, nil
}
