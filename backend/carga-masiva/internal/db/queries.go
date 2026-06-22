package db

import (
	"database/sql"
	"fmt"
	"strings"

	"github.com/tasfb2b/carga-masiva/internal/parser"
)

// InsertarAeropuertosBatch inserta los aeropuertos en una sola transacción.
func InsertarAeropuertosBatch(db *sql.DB, rows []parser.Aeropuerto) error {
	if len(rows) == 0 {
		return nil
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`
		INSERT INTO aeropuertos
		  (id, iata, ciudad, pais, alias, gmt_offset, capacidad_almacen, latitud, longitud, continente)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
		  ciudad=VALUES(ciudad), pais=VALUES(pais),
		  gmt_offset=VALUES(gmt_offset), capacidad_almacen=VALUES(capacidad_almacen),
		  latitud=VALUES(latitud), longitud=VALUES(longitud), continente=VALUES(continente)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, a := range rows {
		if _, err := stmt.Exec(a.ID, a.IATA, a.Ciudad, a.Pais, a.Alias,
			a.GMTOffset, a.CapacidadAlmacen, a.Latitud, a.Longitud, a.Continente); err != nil {
			return fmt.Errorf("insertar aeropuerto %s: %w", a.IATA, err)
		}
	}
	return tx.Commit()
}

// InsertarVuelosBatch inserta los vuelos borrando los anteriores primero.
func InsertarVuelosBatch(db *sql.DB, rows []parser.Vuelo) error {
	if len(rows) == 0 {
		return nil
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM vuelos"); err != nil {
		return err
	}

	const batchSize = 500
	for i := 0; i < len(rows); i += batchSize {
		end := i + batchSize
		if end > len(rows) {
			end = len(rows)
		}
		batch := rows[i:end]

		placeholders := make([]string, len(batch))
		args := make([]interface{}, 0, len(batch)*6)
		for j, v := range batch {
			placeholders[j] = "(?, ?, ?, ?, ?, ?)"
			mismo := 0
			if v.MismoContinente {
				mismo = 1
			}
			args = append(args, v.OrigenIATA, v.DestinoIATA,
				v.SalidaMinutos, v.LlegadaMinutos, v.CapacidadMax, mismo)
		}
		q := "INSERT INTO vuelos (origen_iata, destino_iata, salida_minutos, llegada_minutos, capacidad_max, mismo_continente) VALUES " +
			strings.Join(placeholders, ",")
		if _, err := tx.Exec(q, args...); err != nil {
			return fmt.Errorf("insertar vuelos batch: %w", err)
		}
	}
	return tx.Commit()
}

// InsertarEnviosBatch inserta un lote de envíos ignorando duplicados.
// Se llama repetidamente desde el handler de streaming.
func InsertarEnviosBatch(tx *sql.Tx, rows []parser.Envio) error {
	if len(rows) == 0 {
		return nil
	}
	placeholders := make([]string, len(rows))
	args := make([]interface{}, 0, len(rows)*10)
	for i, e := range rows {
		placeholders[i] = "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
		args = append(args,
			e.IDEnvio, e.OrigenIATA, e.FechaRegistro,
			e.Hora, e.Minuto, e.DestinoIATA,
			e.CantidadMaletas, e.IDCliente,
			e.RegistroUTC, e.DeadlineUTC,
		)
	}
	q := `INSERT IGNORE INTO envios
		(id_envio, origen_iata, fecha_registro, hora, minuto, destino_iata, cantidad_maletas, id_cliente, registro_utc, deadline_utc)
		VALUES ` + strings.Join(placeholders, ",")
	_, err := tx.Exec(q, args...)
	return err
}
