package db

import (
	"database/sql"
	"fmt"
	"time"
)

const datasetFuente = "envios_colapso"

// DatasetInfo contiene el rango de fechas y totales del dataset cargado.
type DatasetInfo struct {
	FechaMin    string `json:"fecha_min"`
	FechaMax    string `json:"fecha_max"`
	TotalEnvios int64  `json:"total_envios"`
	Calculado   string `json:"calculado_en"`
}

// ObtenerDatasetInfo usa caché únicamente cuando fue calculada desde
// envios_colapso. La caché antigua de la tabla envios se descarta.
func ObtenerDatasetInfo(db *sql.DB, forzar bool) (*DatasetInfo, error) {
	if !forzar {
		info, err := leerCache(db)
		if err == nil && info != nil {
			return info, nil
		}
	}
	return calcularYGuardar(db)
}

// RecalcularDatasetInfo fuerza el recálculo desde envios_colapso.
func RecalcularDatasetInfo(db *sql.DB) (*DatasetInfo, error) {
	return calcularYGuardar(db)
}

func leerCache(db *sql.DB) (*DatasetInfo, error) {
	rows, err := db.Query(
		`SELECT clave, valor FROM dataset_meta
		 WHERE clave IN (
		   'fecha_min','fecha_max','total_envios','calculado_en','dataset_fuente'
		 )`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	m := make(map[string]string, 5)
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

	if m["dataset_fuente"] != datasetFuente {
		return nil, fmt.Errorf("caché pertenece a otra tabla")
	}

	var total int64
	fmt.Sscanf(m["total_envios"], "%d", &total)

	if total > 0 && (m["fecha_min"] == "" || m["fecha_max"] == "") {
		return nil, fmt.Errorf("caché incompleta")
	}

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
		`SELECT DATE_FORMAT(MIN(fecha_registro), '%Y-%m-%d'),
		        DATE_FORMAT(MAX(fecha_registro), '%Y-%m-%d'),
		        COUNT(*)
		 FROM envios_colapso`,
	).Scan(&minFecha, &maxFecha, &total)
	if err != nil {
		return nil, fmt.Errorf("calcular rango de envios_colapso: %w", err)
	}

	min := ""
	max := ""
	if minFecha.Valid {
		min = minFecha.String
	}
	if maxFecha.Valid {
		max = maxFecha.String
	}

	ahora := time.Now().Format(time.RFC3339)
	upsert := `INSERT INTO dataset_meta (clave, valor) VALUES (?,?)
	           ON DUPLICATE KEY UPDATE valor=VALUES(valor)`

	for _, kv := range [][2]string{
		{"fecha_min", min},
		{"fecha_max", max},
		{"total_envios", fmt.Sprintf("%d", total)},
		{"calculado_en", ahora},
		{"dataset_fuente", datasetFuente},
	} {
		if _, err := db.Exec(upsert, kv[0], kv[1]); err != nil {
			return nil, fmt.Errorf("guardar %s: %w", kv[0], err)
		}
	}

	return &DatasetInfo{
		FechaMin:    min,
		FechaMax:    max,
		TotalEnvios: total,
		Calculado:   ahora,
	}, nil
}
