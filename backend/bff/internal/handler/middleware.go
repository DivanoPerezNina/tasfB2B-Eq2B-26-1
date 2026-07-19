package handler

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"
)

type ctxKey int

const usuarioCtxKey ctxKey = 0

// tokenDe extrae el token del header "Authorization: Bearer <token>".
func tokenDe(r *http.Request) string {
	h := r.Header.Get("Authorization")
	return strings.TrimSpace(strings.TrimPrefix(h, "Bearer"))
}

// UsuarioDeContexto devuelve el usuario autenticado que RequireAuth adjuntó a
// la petición. Solo válido dentro de un handler envuelto por RequireAuth.
func UsuarioDeContexto(r *http.Request) (*Usuario, bool) {
	u, ok := r.Context().Value(usuarioCtxKey).(*Usuario)
	return u, ok
}

// RequireAuth exige un token de sesión válido y, si se pasan roles, que el
// usuario tenga uno de ellos. Sin roles, cualquier sesión válida pasa.
//
// ponytail: consulta la sesión en cada request (sin caché en memoria) — a la
// escala de este proyecto (decenas de usuarios) es más simple que invalidar
// una caché al hacer logout, y sigue siendo una sola query indexada por PK.
func RequireAuth(db *sql.DB, roles ...string) func(http.HandlerFunc) http.HandlerFunc {
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			token := tokenDe(r)
			if token == "" {
				errResp(w, 401, "SIN_SESION", "Falta el header Authorization")
				return
			}

			var u Usuario
			var aero sql.NullString
			var expira time.Time
			err := db.QueryRow(`
				SELECT u.id, u.usuario, u.rol, u.aeropuerto_iata, s.expira_en
				FROM sesiones s
				JOIN usuarios u ON u.id = s.usuario_id
				WHERE s.token = ? AND u.activo = 1`, token,
			).Scan(&u.ID, &u.Usuario, &u.Rol, &aero, &expira)

			if errors.Is(err, sql.ErrNoRows) {
				errResp(w, 401, "SESION_INVALIDA", "Token inválido o usuario desactivado")
				return
			}
			if err != nil {
				errResp(w, 500, "DB_ERROR", err.Error())
				return
			}
			if time.Now().After(expira) {
				db.Exec(`DELETE FROM sesiones WHERE token = ?`, token) // limpieza perezosa
				errResp(w, 401, "SESION_EXPIRADA", "Vuelve a iniciar sesión")
				return
			}
			if aero.Valid {
				u.AeropuertoIATA = &aero.String
			}

			if len(roles) > 0 {
				permitido := false
				for _, rol := range roles {
					if u.Rol == rol {
						permitido = true
						break
					}
				}
				if !permitido {
					errResp(w, 403, "SIN_PERMISO", "Tu rol no tiene acceso a este recurso")
					return
				}
			}

			ctx := context.WithValue(r.Context(), usuarioCtxKey, &u)
			next.ServeHTTP(w, r.WithContext(ctx))
		}
	}
}
