package db

import (
	"database/sql"
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
// Para envios usa dataset_meta y evita ejecutar COUNT(*) sobre millones de
// registros en cada consulta de estado o al comenzar una nueva carga.
func ContarRegistros(db *sql.DB) (aeropuertos, vuelos, envios int, err error) {
	if err = db.QueryRow("SELECT COUNT(*) FROM aeropuertos").Scan(&aeropuertos); err != nil {
		return
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM vuelos").Scan(&vuelos); err != nil {
		return
	}

	info, infoErr := ObtenerDatasetInfo(db, false)
	if infoErr == nil && info != nil {
		envios = int(info.TotalEnvios)
		return
	}

	// Compatibilidad para instalaciones antiguas que aún no tienen metadata.
	err = db.QueryRow("SELECT COUNT(*) FROM envios").Scan(&envios)
	return
}

// LimpiarDatos borra todos los registros de las tablas de dominio. Para Periodo/Colapso, los envíos se cuentan en envios.
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

	// Mantener sincronizada la caché que consumen el BFF y la configuración.
	if _, err := RecalcularDatasetInfo(db); err != nil {
		return na, nv, ne, err
	}
	return na, nv, ne, nil
}
