package db

import (
	"database/sql"
	"fmt"
)

type Sesion struct {
	Token          string
	Tipo           string
	Archivo        string
	Estado         string
	RegistrosTotal int
	RegistrosOK    int
	DetalleError   *string
}

func InsertarSesion(db *sql.DB, s Sesion) error {
	_, err := db.Exec(
		`INSERT INTO carga_sesiones (token, tipo, archivo, estado)
		 VALUES (?, ?, ?, 'recibido')`,
		s.Token, s.Tipo, s.Archivo,
	)
	return err
}

func ActualizarSesion(db *sql.DB, token, estado string, total, ok int, detalle *string) error {
	_, err := db.Exec(
		`UPDATE carga_sesiones
		 SET estado=?, registros_total=?, registros_ok=?, detalle_error=?
		 WHERE token=?`,
		estado, total, ok, detalle, token,
	)
	return err
}

func ObtenerSesion(db *sql.DB, token string) (*Sesion, error) {
	s := &Sesion{}
	err := db.QueryRow(
		`SELECT token, tipo, archivo, estado, registros_total, registros_ok, detalle_error
		 FROM carga_sesiones WHERE token=?`, token,
	).Scan(&s.Token, &s.Tipo, &s.Archivo, &s.Estado,
		&s.RegistrosTotal, &s.RegistrosOK, &s.DetalleError)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return s, err
}

// ContarRegistros devuelve el total de filas en cada tabla de dominio.
func ContarRegistros(db *sql.DB) (aeropuertos, vuelos, envios int, err error) {
	for _, q := range []struct {
		tabla string
		dest  *int
	}{
		{"aeropuertos", &aeropuertos},
		{"vuelos", &vuelos},
		{"envios", &envios},
	} {
		if e := db.QueryRow(fmt.Sprintf("SELECT COUNT(*) FROM %s", q.tabla)).Scan(q.dest); e != nil {
			err = e
			return
		}
	}
	return
}

// LimpiarDatos borra todos los registros de las tablas de dominio.
func LimpiarDatos(db *sql.DB) (int64, int64, int64, error) {
	var na, nv, ne int64
	// Orden respeta FK implícitas (envíos primero, luego vuelos, luego aeropuertos)
	for _, q := range []struct {
		sql  string
		dest *int64
	}{
		{"DELETE FROM envios", &ne},
		{"DELETE FROM vuelos", &nv},
		{"DELETE FROM aeropuertos", &na},
	} {
		r, err := db.Exec(q.sql)
		if err != nil {
			return 0, 0, 0, err
		}
		n, _ := r.RowsAffected()
		*q.dest = n
	}
	return na, nv, ne, nil
}
