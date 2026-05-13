package db

import (
	"database/sql"
	"fmt"
	"time"
)

// DatasetInfo contiene el rango de fechas y totales del dataset cargado.
type DatasetInfo struct {
	FechaMin    string `json:"fecha_min"`    // "YYYY-MM-DD"
	FechaMax    string `json:"fecha_max"`    // "YYYY-MM-DD"
	TotalEnvios int64  `json:"total_envios"`
	Calculado   string `json:"calculado_en"` // RFC3339
}

// ObtenerDatasetInfo devuelve el rango de fechas desde dataset_meta (caché).
// Si la caché está vacía o forzar=true, recalcula desde la tabla envios y guarda.
func ObtenerDatasetInfo(db *sql.DB, forzar bool) (*DatasetInfo, error) {
	if !forzar {
		info, err := leerCache(db)
		if err == nil && info != nil {
			return info, nil
		}
	}
	return calcularYGuardar(db)
}

// RecalcularDatasetInfo fuerza el recálculo aunque ya exista caché.
func RecalcularDatasetInfo(db *sql.DB) (*DatasetInfo, error) {
	return calcularYGuardar(db)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func leerCache(db *sql.DB) (*DatasetInfo, error) {
	rows, err := db.Query(
		`SELECT clave, valor FROM dataset_meta
		 WHERE clave IN ('fecha_min','fecha_max','total_envios','calculado_en')`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	m := make(map[string]string, 4)
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		m[k] = v
	}
	if rows.Err() != nil {
		return nil, rows.Err()
	}
	if m["fecha_min"] == "" || m["fecha_max"] == "" {
		return nil, fmt.Errorf("caché vacía")
	}

	var total int64
	fmt.Sscanf(m["total_envios"], "%d", &total)

	return &DatasetInfo{
		FechaMin:    m["fecha_min"],
		FechaMax:    m["fecha_max"],
		TotalEnvios: total,
		Calculado:   m["calculado_en"],
	}, nil
}

func calcularYGuardar(db *sql.DB) (*DatasetInfo, error) {
	var minFecha, maxFecha sql.NullString
	var total int64

	err := db.QueryRow(
		`SELECT MIN(fecha_registro), MAX(fecha_registro), COUNT(*)
		 FROM envios`).Scan(&minFecha, &maxFecha, &total)
	if err != nil {
		return nil, fmt.Errorf("calcular rango: %w", err)
	}
	if !minFecha.Valid {
		return nil, fmt.Errorf("tabla envios vacía")
	}

	ahora := time.Now().Format(time.RFC3339)

	upsert := `INSERT INTO dataset_meta (clave, valor) VALUES (?,?)
	           ON DUPLICATE KEY UPDATE valor=VALUES(valor)`
	for _, kv := range [][2]string{
		{"fecha_min", minFecha.String},
		{"fecha_max", maxFecha.String},
		{"total_envios", fmt.Sprintf("%d", total)},
		{"calculado_en", ahora},
	} {
		if _, err := db.Exec(upsert, kv[0], kv[1]); err != nil {
			return nil, fmt.Errorf("guardar %s: %w", kv[0], err)
		}
	}

	return &DatasetInfo{
		FechaMin:    minFecha.String,
		FechaMax:    maxFecha.String,
		TotalEnvios: total,
		Calculado:   ahora,
	}, nil
}
