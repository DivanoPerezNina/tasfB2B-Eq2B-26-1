package handler

import (
	"database/sql"
	"fmt"
	"net/http"

	dbpkg "github.com/tasfb2b/carga-masiva/internal/db"
)

type EstadoHandler struct {
	DB *sql.DB
}

// GET /estado — totales actuales en BD + rango de fechas del dataset
func (h *EstadoHandler) Estado(w http.ResponseWriter, r *http.Request) {
	aero, vuelos, envios, err := dbpkg.ContarRegistros(h.DB)
	if err != nil {
		errResp(w, 500, "DB_ERROR", err.Error())
		return
	}

	porAeropuerto, err := h.enviosPorAeropuerto()
	if err != nil {
		errResp(w, 500, "DB_ERROR", err.Error())
		return
	}

	listo := aero >= 30 && vuelos > 0 && envios > 0

	// Rango de fechas del dataset (desde caché, sin forzar recálculo)
	var dataset interface{}
	if info, infoErr := dbpkg.ObtenerDatasetInfo(h.DB, false); infoErr == nil {
		dataset = map[string]interface{}{
			"fecha_min":    info.FechaMin,
			"fecha_max":    info.FechaMax,
			"total_envios": info.TotalEnvios,
			"calculado_en": info.Calculado,
		}
	}

	respond(w, 200, map[string]interface{}{
		"aeropuertos": aero,
		"vuelos":      vuelos,
		"envios": map[string]interface{}{
			"total":          envios,
			"por_aeropuerto": porAeropuerto,
		},
		"listo_para_simular": listo,
		"dataset":            dataset,
	})
}

// POST /dataset/recalcular — fuerza recálculo del rango de fechas desde envios
func (h *EstadoHandler) RecalcularDataset(w http.ResponseWriter, r *http.Request) {
	info, err := dbpkg.RecalcularDatasetInfo(h.DB)
	if err != nil {
		errResp(w, 500, "CALCULO_ERROR", err.Error())
		return
	}
	respond(w, 200, map[string]interface{}{
		"fecha_min":    info.FechaMin,
		"fecha_max":    info.FechaMax,
		"total_envios": info.TotalEnvios,
		"calculado_en": info.Calculado,
	})
}

// GET /plantillas/{tipo} — descarga plantilla de ejemplo
func (h *EstadoHandler) Plantilla(w http.ResponseWriter, r *http.Request) {
	tipo := r.URL.Path[len("/plantillas/"):]
	var content, filename string

	switch tipo {
	case "aeropuertos":
		filename = "aeropuertos_plantilla.txt"
		content = plantillaAeropuertos
	case "vuelos":
		filename = "vuelos_plantilla.txt"
		content = plantillaVuelos
	case "envios":
		filename = "_envios_XXXX__plantilla.txt"
		content = plantillaEnvios
	case "cancelaciones":
		filename = "cancelaciones_plantilla.csv"
		content = plantillaCancelaciones
	default:
		errResp(w, 404, "TIPO_INVALIDO", fmt.Sprintf("Tipo %q no reconocido. Use: aeropuertos, vuelos, envios, cancelaciones", tipo))
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.WriteHeader(200)
	w.Write([]byte(content))
}

func (h *EstadoHandler) enviosPorAeropuerto() (map[string]int, error) {
	rows, err := h.DB.Query(
		`SELECT origen_iata, COUNT(*) FROM envios GROUP BY origen_iata ORDER BY origen_iata`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	m := make(map[string]int)
	for rows.Next() {
		var iata string
		var cnt int
		if err := rows.Scan(&iata, &cnt); err != nil {
			return nil, err
		}
		m[iata] = cnt
	}
	return m, rows.Err()
}

// ── Plantillas de ejemplo ────────────────────────────────────────────────────

const plantillaAeropuertos = `* TASF.B2B — Archivo de aeropuertos
* Formato: id IATA ciudad pais alias GMT capacidad Latitude lat Longitude lng
* Secciones: America, Europa, Asia

PDDS Aeropuertos

America
01 SKBO Bogota Colombia BOG -5 430 Latitude 4.701389 Longitude -74.146944
02 SEQM Quito Ecuador UIO -5 490 Latitude -0.125556 Longitude -78.354722

Europa
11 LATI Tirana Albania TIA +1 520 Latitude 41.414722 Longitude 19.720556

Asia
21 VIDP Delhi India DEL +5 600 Latitude 28.566690 Longitude 77.103100
`

const plantillaVuelos = `# TASF.B2B — Archivo de vuelos
# Formato: ORIG-DEST-HH:MM_salida-HH:MM_llegada-CAPACIDAD
# Horas en hora LOCAL del aeropuerto de origen/destino
SKBO-SEQM-19:00-07:00-220
SEQM-SKBO-08:00-20:00-220
SKBO-LATI-23:00-15:00-350
`

const plantillaEnvios = `# TASF.B2B — Archivo de envíos (un archivo por aeropuerto origen)
# Nombre del archivo: _envios_IATA_.txt   (ej: _envios_SKBO_.txt)
# Formato: idEnvio-YYYYMMDD-HH-MM-destIATA-maletas-idCliente
00000001-20260102-01-38-EBCI-006-0007729
00000002-20260102-03-15-LATI-012-0004521
00000003-20260103-10-00-VIDP-003-0001234
`

const plantillaCancelaciones = `# TASF.B2B — Archivo de cancelaciones de vuelo (CSV)
# Formato: origen,destino,fecha,hora   (fecha=YYYY-MM-DD, hora=HH:MM en hora LOCAL del origen)
# Una línea por ocurrencia (vuelo, día) a cancelar. No se valida: rutas o fechas
# inexistentes simplemente no afectan la simulación.
origen,destino,fecha,hora
SKBO,EDDI,2026-01-15,19:01
SEQM,SKBO,2026-01-16,08:00
`
