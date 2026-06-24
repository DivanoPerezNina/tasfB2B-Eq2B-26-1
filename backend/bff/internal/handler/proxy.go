package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
)

// corsHopHeaders son los headers CORS que el upstream puede devolver y que el BFF
// ya gestiona con su propio middleware. Deben eliminarse antes de reenviar al browser
// para evitar el error "multiple values" que bloquea la petición por CORS policy.
var corsHopHeaders = []string{
	"Access-Control-Allow-Origin",
	"Access-Control-Allow-Methods",
	"Access-Control-Allow-Headers",
	"Access-Control-Allow-Credentials",
	"Access-Control-Expose-Headers",
	"Access-Control-Max-Age",
}

// NuevoProxy crea un reverse proxy hacia baseURL, opcionalmente quitando un prefijo del path.
func NuevoProxy(baseURL, stripPrefix string) http.HandlerFunc {
	target, _ := url.Parse(baseURL)
	proxy := httputil.NewSingleHostReverseProxy(target)

	proxy.Director = func(req *http.Request) {
		req.URL.Scheme = target.Scheme
		req.URL.Host = target.Host
		if stripPrefix != "" {
			req.URL.Path = strings.TrimPrefix(req.URL.Path, stripPrefix)
			if req.URL.Path == "" {
				req.URL.Path = "/"
			}
		}
		req.Host = target.Host
	}

	// Eliminar headers CORS del upstream antes de copiarlos al cliente;
	// el middleware CORS del BFF ya pone los valores correctos.
	proxy.ModifyResponse = func(resp *http.Response) error {
		for _, h := range corsHopHeaders {
			resp.Header.Del(h)
		}
		return nil
	}

	return func(w http.ResponseWriter, r *http.Request) {
		proxy.ServeHTTP(w, r)
	}
}

// NuevoProxySSE proxea un stream SSE del servicio interno al browser línea a línea.
func NuevoProxySSE(baseURL, stripPrefix string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "Streaming no soportado", http.StatusInternalServerError)
			return
		}

		path := r.URL.Path
		if stripPrefix != "" {
			path = strings.TrimPrefix(path, stripPrefix)
		}
		targetURL := baseURL + path
		if r.URL.RawQuery != "" {
			targetURL += "?" + r.URL.RawQuery
		}

		req, err := http.NewRequestWithContext(r.Context(), "GET", targetURL, nil)
		if err != nil {
			http.Error(w, fmt.Sprintf("error creando request: %v", err), 500)
			return
		}
		req.Header.Set("Accept", "text/event-stream")

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			http.Error(w, fmt.Sprintf("error conectando servicio: %v", err), 502)
			return
		}
		defer resp.Body.Close()

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		// Access-Control-Allow-Origin lo pone el middleware CORS del BFF; no duplicar aquí.
		w.WriteHeader(http.StatusOK)

		// Passthrough por chunks (NO line-by-line): un evento SSE como plan-tramos
		// puede tener una línea `data:` de cientos de KB / varios MB. bufio.Scanner
		// corta líneas >64 KB (bufio.MaxScanTokenSize) → truncaba el plan y el mapa
		// se quedaba sin aviones. Copiamos bytes tal cual y flush tras cada lectura.
		buf := make([]byte, 32*1024)
		for {
			n, err := resp.Body.Read(buf)
			if n > 0 {
				if _, werr := w.Write(buf[:n]); werr != nil {
					return
				}
				flusher.Flush()
			}
			if err != nil {
				return
			}
		}
	}
}

// ── Helpers compartidos ───────────────────────────────────────────────────────

type envelope struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data"`
	Message string      `json:"message"`
	Error   interface{} `json:"error"`
}

func ok(w http.ResponseWriter, data interface{}, msg string) {
	respond(w, 200, envelope{Success: true, Data: data, Message: msg, Error: nil})
}

func errResp(w http.ResponseWriter, code int, errKey, msg string) {
	respond(w, code, envelope{
		Success: false, Data: nil, Message: msg, Error: errKey,
	})
}

func respond(w http.ResponseWriter, code int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(body)
}
