package handler

import (
	"database/sql"
	"fmt"
	"net/http"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

// UsuariosHandler es el CRUD (sin borrado, solo activar/desactivar) de la
// tabla usuarios, para que el admin cree operarios desde la UI en vez de
// INSERT manual (ver migracion_usuarios.sql).
type UsuariosHandler struct {
	DB *sql.DB
}

type usuarioInput struct {
	Usuario        string `json:"usuario"`
	Clave          string `json:"clave"`
	Rol            string `json:"rol"`
	AeropuertoIATA string `json:"aeropuerto_iata"`
}

func validateUsuario(in *usuarioInput) error {
	in.Usuario = strings.TrimSpace(in.Usuario)
	in.AeropuertoIATA = normalizeIATA(in.AeropuertoIATA)
	if len(in.Usuario) < 3 || len(in.Usuario) > 40 {
		return fmt.Errorf("usuario debe tener entre 3 y 40 caracteres")
	}
	if len(in.Clave) < 8 {
		return fmt.Errorf("la clave debe tener al menos 8 caracteres")
	}
	if in.Rol != "admin" && in.Rol != "operario" {
		return fmt.Errorf("rol debe ser 'admin' u 'operario'")
	}
	if in.Rol == "operario" && in.AeropuertoIATA == "" {
		return fmt.Errorf("un operario necesita un aeropuerto_iata")
	}
	if in.Rol == "admin" {
		in.AeropuertoIATA = "" // un admin nunca queda atado a un aeropuerto
	}
	return nil
}

// ListarUsuarios — GET /api/mantenimiento/usuarios
func (h *UsuariosHandler) ListarUsuarios(w http.ResponseWriter, r *http.Request) {
	rows, err := h.DB.Query(`SELECT id, usuario, rol, aeropuerto_iata, activo, creado_en
		FROM usuarios ORDER BY creado_en DESC`)
	if err != nil {
		errResp(w, 500, "DB_ERROR", err.Error())
		return
	}
	defer rows.Close()

	usuarios := []map[string]interface{}{}
	for rows.Next() {
		var (
			id     int64
			user   string
			rol    string
			aero   sql.NullString
			activo bool
			creado string
		)
		if err := rows.Scan(&id, &user, &rol, &aero, &activo, &creado); err != nil {
			errResp(w, 500, "DB_ERROR", err.Error())
			return
		}
		item := map[string]interface{}{
			"id": id, "usuario": user, "rol": rol, "activo": activo, "creado_en": creado,
		}
		if aero.Valid {
			item["aeropuerto_iata"] = aero.String
		}
		usuarios = append(usuarios, item)
	}
	ok(w, usuarios, "")
}

// CrearUsuario — POST /api/mantenimiento/usuarios
// body: {"usuario":"op_ekch","clave":"...","rol":"operario","aeropuerto_iata":"EKCH"}
func (h *UsuariosHandler) CrearUsuario(w http.ResponseWriter, r *http.Request) {
	var in usuarioInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if err := validateUsuario(&in); err != nil {
		errResp(w, http.StatusBadRequest, "VALIDACION", err.Error())
		return
	}
	if in.Rol == "operario" {
		var existe int
		if err := h.DB.QueryRow(`SELECT COUNT(*) FROM aeropuertos WHERE iata = ?`, in.AeropuertoIATA).Scan(&existe); err != nil {
			errResp(w, 500, "DB_ERROR", err.Error())
			return
		}
		if existe == 0 {
			errResp(w, 400, "AEROPUERTO_INVALIDO", "aeropuerto_iata no existe en el catálogo")
			return
		}
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(in.Clave), bcrypt.DefaultCost)
	if err != nil {
		errResp(w, 500, "HASH_ERROR", err.Error())
		return
	}
	var aeroValue interface{}
	if in.AeropuertoIATA != "" {
		aeroValue = in.AeropuertoIATA
	}
	res, err := h.DB.Exec(`INSERT INTO usuarios (usuario, clave_hash, rol, aeropuerto_iata) VALUES (?, ?, ?, ?)`,
		in.Usuario, string(hash), in.Rol, aeroValue)
	if err != nil {
		if strings.Contains(err.Error(), "Duplicate entry") {
			errResp(w, http.StatusConflict, "USUARIO_EXISTE", "Ya existe una cuenta con ese usuario")
		} else {
			errResp(w, 500, "CREACION_FALLIDA", err.Error())
		}
		return
	}
	id, _ := res.LastInsertId()
	ok(w, map[string]interface{}{"id": id, "usuario": in.Usuario}, "Usuario creado")
}

// ActualizarActivoUsuario — PUT /api/mantenimiento/usuarios/{id}
// body: {"activo": true|false} — activar/desactivar, no se borra la cuenta.
func (h *UsuariosHandler) ActualizarActivoUsuario(w http.ResponseWriter, r *http.Request) {
	id, err := parsePathID(r)
	if err != nil {
		errResp(w, 400, "ID_INVALIDO", err.Error())
		return
	}
	var in struct {
		Activo bool `json:"activo"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}

	quienSoy, _ := UsuarioDeContexto(r)
	if !in.Activo && quienSoy != nil && quienSoy.ID == id {
		errResp(w, http.StatusConflict, "AUTO_DESACTIVACION", "No puedes desactivar tu propia cuenta")
		return
	}

	res, err := h.DB.Exec(`UPDATE usuarios SET activo = ? WHERE id = ?`, in.Activo, id)
	if err != nil {
		errResp(w, 500, "ACTUALIZACION_FALLIDA", err.Error())
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		errResp(w, 404, "NO_ENCONTRADO", "Usuario no encontrado")
		return
	}
	ok(w, map[string]interface{}{"id": id, "activo": in.Activo}, "Usuario actualizado")
}
