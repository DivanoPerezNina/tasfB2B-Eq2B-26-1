package handler

import (
	"database/sql"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// OperacionesHandler expone metadatos de envíos para vincular el plan visual
// (que usa envioIndice) con el identificador real registrado en MySQL.
//
// La numeración debe usar exactamente el mismo orden que el servicio Consultas:
// registro_utc, origen_iata, id_envio. De este modo indice_plan coincide con el
// índice que el planificador y el ejecutor publican en plan-tramos.
type OperacionesHandler struct {
	DB *sql.DB
}

type envioOperacion struct {
	IDEnvio         string `json:"id_envio"`
	OrigenIATA      string `json:"origen_iata"`
	DestinoIATA     string `json:"destino_iata"`
	CantidadMaletas int    `json:"cantidad_maletas"`
	RegistroUTC     int64  `json:"registro_utc"`
	DeadlineUTC     int64  `json:"deadline_utc"`
	IndicePlan      int    `json:"indice_plan"`
}

var bagSuffix = regexp.MustCompile(`(?i)(?:[-#:]?M(?:ALETA)?[-#:]?\d+)$`)

func parseWindow(r *http.Request) (int64, int64, error) {
	ini, errIni := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("ini")), 10, 64)
	fin, errFin := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("fin")), 10, 64)
	if errIni != nil || errFin != nil || fin <= ini {
		return 0, 0, fmt.Errorf("se requieren ini y fin (minutos UTC) con fin > ini")
	}
	return ini, fin, nil
}

func normalizeShipmentQuery(value string) string {
	q := strings.ToUpper(strings.TrimSpace(value))
	q = bagSuffix.ReplaceAllString(q, "")
	return strings.TrimSpace(q)
}

func scanEnvios(rows *sql.Rows) ([]envioOperacion, error) {
	items := make([]envioOperacion, 0, 64)
	for rows.Next() {
		var item envioOperacion
		if err := rows.Scan(
			&item.IDEnvio,
			&item.OrigenIATA,
			&item.DestinoIATA,
			&item.CantidadMaletas,
			&item.RegistroUTC,
			&item.DeadlineUTC,
			&item.IndicePlan,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// BuscarEnvios — GET /api/operaciones/envios/buscar?q=...&ini=...&fin=...&limit=20
// Acepta el ID del envío y también un identificador sintético de maleta como
// 00000001-M001; el sufijo de maleta se elimina y se busca el envío contenedor.
func (h *OperacionesHandler) BuscarEnvios(w http.ResponseWriter, r *http.Request) {
	ini, fin, err := parseWindow(r)
	if err != nil {
		errResp(w, http.StatusBadRequest, "VENTANA_INVALIDA", err.Error())
		return
	}
	q := normalizeShipmentQuery(r.URL.Query().Get("q"))
	if len(q) < 2 {
		errResp(w, http.StatusBadRequest, "BUSQUEDA_INVALIDA", "ingrese al menos 2 caracteres del ID de envío o maleta")
		return
	}
	limit := 20
	if parsed, parseErr := strconv.Atoi(r.URL.Query().Get("limit")); parseErr == nil && parsed > 0 {
		if parsed > 100 {
			parsed = 100
		}
		limit = parsed
	}

	rows, err := h.DB.Query(`
		SELECT id_envio, origen_iata, destino_iata, cantidad_maletas,
		       registro_utc, deadline_utc, indice_plan
		FROM (
			SELECT id_envio, origen_iata, destino_iata, cantidad_maletas,
			       registro_utc, deadline_utc,
			       ROW_NUMBER() OVER (
				ORDER BY registro_utc, origen_iata, id_envio
			       ) - 1 AS indice_plan
			FROM envios
			WHERE registro_utc >= ? AND registro_utc < ?
		) ranked
		WHERE UPPER(id_envio) LIKE ?
		ORDER BY registro_utc, origen_iata, id_envio
		LIMIT ?`, ini, fin, "%"+q+"%", limit)
	if err != nil {
		errResp(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	defer rows.Close()

	items, err := scanEnvios(rows)
	if err != nil {
		errResp(w, http.StatusInternalServerError, "SCAN_ERROR", err.Error())
		return
	}
	ok(w, items, "envíos encontrados en la ventana del plan")
}

// EnviosPorIndices — GET /api/operaciones/envios/por-indices?indices=1,2,3&ini=...&fin=...
// Devuelve metadatos reales para las filas visibles de paneles y tablas.
func (h *OperacionesHandler) EnviosPorIndices(w http.ResponseWriter, r *http.Request) {
	ini, fin, err := parseWindow(r)
	if err != nil {
		errResp(w, http.StatusBadRequest, "VENTANA_INVALIDA", err.Error())
		return
	}

	raw := strings.Split(r.URL.Query().Get("indices"), ",")
	unique := make(map[int]struct{}, len(raw))
	for _, value := range raw {
		idx, parseErr := strconv.Atoi(strings.TrimSpace(value))
		if parseErr == nil && idx >= 0 {
			unique[idx] = struct{}{}
		}
	}
	if len(unique) == 0 {
		ok(w, []envioOperacion{}, "sin índices solicitados")
		return
	}
	if len(unique) > 250 {
		errResp(w, http.StatusBadRequest, "LIMITE", "se permiten hasta 250 índices por petición")
		return
	}

	indices := make([]int, 0, len(unique))
	for idx := range unique {
		indices = append(indices, idx)
	}
	sort.Ints(indices)
	placeholders := make([]string, len(indices))
	args := make([]interface{}, 0, len(indices)+2)
	args = append(args, ini, fin)
	for i, idx := range indices {
		placeholders[i] = "?"
		args = append(args, idx)
	}

	query := fmt.Sprintf(`
		SELECT id_envio, origen_iata, destino_iata, cantidad_maletas,
		       registro_utc, deadline_utc, indice_plan
		FROM (
			SELECT id_envio, origen_iata, destino_iata, cantidad_maletas,
			       registro_utc, deadline_utc,
			       ROW_NUMBER() OVER (
				ORDER BY registro_utc, origen_iata, id_envio
			       ) - 1 AS indice_plan
			FROM envios
			WHERE registro_utc >= ? AND registro_utc < ?
		) ranked
		WHERE indice_plan IN (%s)
		ORDER BY indice_plan`, strings.Join(placeholders, ","))

	rows, err := h.DB.Query(query, args...)
	if err != nil {
		errResp(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	defer rows.Close()

	items, err := scanEnvios(rows)
	if err != nil {
		errResp(w, http.StatusInternalServerError, "SCAN_ERROR", err.Error())
		return
	}
	ok(w, items, "metadatos de envíos del plan")
}
