package handler

import (
	"encoding/json"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// MuroHandler implementa un "muro" de comentarios anónimos persistido en un
// archivo JSON. Por cada comentario captura toda la metadata de la petición que
// el servidor puede ver (IP pública, headers, User-Agent, fecha/hora) además de
// la huella del cliente (fingerprint) que el navegador envía en el cuerpo.
type MuroHandler struct {
	Archivo string
	mu      sync.Mutex
}

// Comentario es una entrada del muro con toda su metadata.
type Comentario struct {
	ID        string                 `json:"id"`
	Texto     string                 `json:"texto"`
	FechaUTC  string                 `json:"fecha_utc"`   // timestamp del servidor (ISO-8601)
	IP        string                 `json:"ip"`          // IP pública vista por el servidor
	UserAgent string                 `json:"user_agent"`  // navegador/SO (User-Agent)
	Idioma    string                 `json:"idioma"`      // Accept-Language
	Referer   string                 `json:"referer"`     // página de origen
	Headers   map[string]string      `json:"headers"`     // todos los headers HTTP de la petición
	Cliente   map[string]interface{} `json:"cliente"`     // fingerprint enviado por el navegador
}

// Crear — POST /api/muro  body {"texto":"...","cliente":{...fingerprint...}}
func (h *MuroHandler) Crear(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Texto   string                 `json:"texto"`
		Cliente map[string]interface{} `json:"cliente"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		errResp(w, 400, "BODY_INVALIDO", "JSON inválido")
		return
	}
	texto := strings.TrimSpace(req.Texto)
	if texto == "" {
		errResp(w, 400, "TEXTO_VACIO", "El comentario no puede estar vacío")
		return
	}
	if len(texto) > 2000 {
		texto = texto[:2000]
	}

	// Capturar TODOS los headers de la petición.
	headers := make(map[string]string, len(r.Header))
	for k, v := range r.Header {
		headers[k] = strings.Join(v, ", ")
	}

	c := Comentario{
		ID:        time.Now().UTC().Format("20060102T150405.000000000"),
		Texto:     texto,
		FechaUTC:  time.Now().UTC().Format(time.RFC3339),
		IP:        ipReal(r),
		UserAgent: r.UserAgent(),
		Idioma:    r.Header.Get("Accept-Language"),
		Referer:   r.Referer(),
		Headers:   headers,
		Cliente:   req.Cliente,
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	lista := h.leer()
	lista = append(lista, c)
	if err := h.escribir(lista); err != nil {
		errResp(w, 500, "ESCRITURA_FALLIDA", err.Error())
		return
	}
	ok(w, c, "Comentario publicado")
}

// Listar — GET /api/muro  (más recientes primero)
func (h *MuroHandler) Listar(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	lista := h.leer()
	h.mu.Unlock()

	// Invertir para mostrar lo más reciente primero.
	for i, j := 0, len(lista)-1; i < j; i, j = i+1, j-1 {
		lista[i], lista[j] = lista[j], lista[i]
	}
	ok(w, lista, "")
}

// ── Persistencia en archivo JSON (bajo h.mu) ─────────────────────────────────

func (h *MuroHandler) leer() []Comentario {
	data, err := os.ReadFile(h.Archivo)
	if err != nil || len(data) == 0 {
		return []Comentario{}
	}
	var lista []Comentario
	if err := json.Unmarshal(data, &lista); err != nil {
		return []Comentario{} // archivo corrupto → empezar de cero
	}
	return lista
}

func (h *MuroHandler) escribir(lista []Comentario) error {
	data, err := json.MarshalIndent(lista, "", "  ")
	if err != nil {
		return err
	}
	// Escritura atómica: archivo temporal + rename.
	tmp := h.Archivo + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, h.Archivo)
}

// ipReal extrae la IP pública priorizando X-Forwarded-For / X-Real-IP (cuando
// hay un proxy nginx delante) y cae a RemoteAddr.
func ipReal(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// El primer valor es el cliente original.
		if i := strings.IndexByte(xff, ','); i >= 0 {
			return strings.TrimSpace(xff[:i])
		}
		return strings.TrimSpace(xff)
	}
	if xr := r.Header.Get("X-Real-IP"); xr != "" {
		return strings.TrimSpace(xr)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
