package handler

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// sesionTTL es cuánto dura un token desde que se emite.
const sesionTTL = 12 * time.Hour

// AuthHandler valida login contra la tabla usuarios (bcrypt) y emite tokens de
// sesión respaldados por la tabla sesiones. Reemplaza el gate de credencial
// compartida: ahora cada usuario tiene rol (admin|operario) y, si es operario,
// un aeropuerto_iata al que queda atado en todos los endpoints que lo usan.
type AuthHandler struct {
	DB *sql.DB
}

// Usuario es la identidad resuelta a partir de un token válido.
type Usuario struct {
	ID             int64
	Usuario        string
	Rol            string  // "admin" | "operario"
	AeropuertoIATA *string // nil para admin
}

// Login — POST /api/login  body {"usuario":"...","clave":"..."}
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Usuario string `json:"usuario"`
		Clave   string `json:"clave"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		errResp(w, 400, "BODY_INVALIDO", "JSON inválido")
		return
	}

	var (
		id        int64
		claveHash string
		rol       string
		aero      sql.NullString
		activo    bool
	)
	err := h.DB.QueryRow(
		`SELECT id, clave_hash, rol, aeropuerto_iata, activo
		 FROM usuarios WHERE usuario = ?`, req.Usuario,
	).Scan(&id, &claveHash, &rol, &aero, &activo)

	// Mismo mensaje de error tanto si el usuario no existe como si la clave es
	// incorrecta, para no revelar qué usuarios existen.
	if errors.Is(err, sql.ErrNoRows) {
		errResp(w, 401, "CREDENCIALES_INVALIDAS", "Usuario o clave incorrectos")
		return
	}
	if err != nil {
		errResp(w, 500, "DB_ERROR", err.Error())
		return
	}
	if !activo || bcrypt.CompareHashAndPassword([]byte(claveHash), []byte(req.Clave)) != nil {
		errResp(w, 401, "CREDENCIALES_INVALIDAS", "Usuario o clave incorrectos")
		return
	}

	token, err := randomToken()
	if err != nil {
		errResp(w, 500, "TOKEN_ERROR", err.Error())
		return
	}
	if _, err := h.DB.Exec(
		`INSERT INTO sesiones (token, usuario_id, expira_en) VALUES (?, ?, ?)`,
		token, id, time.Now().Add(sesionTTL),
	); err != nil {
		errResp(w, 500, "DB_ERROR", err.Error())
		return
	}

	resp := map[string]interface{}{
		"token":   token,
		"usuario": req.Usuario,
		"rol":     rol,
	}
	if aero.Valid {
		resp["aeropuerto_iata"] = aero.String
	}
	ok(w, resp, "Sesión iniciada")
}

// Logout — POST /api/logout  header Authorization: Bearer <token>
func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	token := tokenDe(r)
	if token != "" {
		h.DB.Exec(`DELETE FROM sesiones WHERE token = ?`, token)
	}
	ok(w, nil, "Sesión cerrada")
}

// randomToken genera 32 bytes aleatorios en hex (64 caracteres, calza con
// sesiones.token CHAR(64)).
func randomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
