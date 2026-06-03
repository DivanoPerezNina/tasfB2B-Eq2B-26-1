package handler

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"net/http"
)

// AuthHandler valida un login con credencial compartida (usuario+clave fijos
// definidos por variables de entorno AUTH_USER / AUTH_PASS).
//
// Nota de alcance: esto es un "gate" para evitar que el público entre a la
// simulación sin más. El token devuelto es una marca de sesión que el frontend
// guarda; NO se valida en cada endpoint (suficiente para un proyecto de curso,
// no es seguridad fuerte).
type AuthHandler struct {
	Usuario string
	Clave   string
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

	// Comparación en tiempo constante para no filtrar info por timing.
	okUser := subtle.ConstantTimeCompare([]byte(req.Usuario), []byte(h.Usuario)) == 1
	okPass := subtle.ConstantTimeCompare([]byte(req.Clave), []byte(h.Clave)) == 1
	if !okUser || !okPass {
		errResp(w, 401, "CREDENCIALES_INVALIDAS", "Usuario o clave incorrectos")
		return
	}

	// Token de sesión opaco derivado de las credenciales (estable mientras no
	// cambien). El frontend lo guarda como marca de "sesión iniciada".
	sum := sha256.Sum256([]byte(h.Usuario + ":" + h.Clave + ":tasfb2b"))
	token := hex.EncodeToString(sum[:])

	ok(w, map[string]string{"token": token, "usuario": h.Usuario}, "Sesión iniciada")
}
