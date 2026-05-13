package sse

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
)

// Mensaje es un evento SSE con tipo y datos.
type Mensaje struct {
	Evento string
	Data   string
}

// Broker gestiona N clientes SSE concurrentemente.
type Broker struct {
	mu          sync.Mutex
	clientes    map[chan Mensaje]struct{}
	maxClientes int
}

// Nuevo crea un Broker con límite de clientes.
func Nuevo(maxClientes int) *Broker {
	return &Broker{
		clientes:    make(map[chan Mensaje]struct{}),
		maxClientes: maxClientes,
	}
}

// Publicar envía un evento a todos los clientes conectados.
func (b *Broker) Publicar(evento string, data interface{}) {
	raw, err := json.Marshal(data)
	if err != nil {
		log.Printf("SSE marshal error: %v", err)
		return
	}
	msg := Mensaje{Evento: evento, Data: string(raw)}

	b.mu.Lock()
	defer b.mu.Unlock()
	for ch := range b.clientes {
		select {
		case ch <- msg:
		default:
			// Cliente lento — descartar evento sin bloquear
		}
	}
}

// ServeHTTP implementa http.Handler para el endpoint SSE.
// Cada conexión entrante se convierte en un cliente SSE.
func (b *Broker) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Verificar que el cliente acepta SSE
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming no soportado", http.StatusInternalServerError)
		return
	}

	// Headers SSE
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// Registrar cliente
	b.mu.Lock()
	if len(b.clientes) >= b.maxClientes {
		b.mu.Unlock()
		http.Error(w, "Demasiados clientes SSE", http.StatusTooManyRequests)
		return
	}
	ch := make(chan Mensaje, 32)
	b.clientes[ch] = struct{}{}
	b.mu.Unlock()

	// Limpiar al desconectar
	defer func() {
		b.mu.Lock()
		delete(b.clientes, ch)
		close(ch)
		b.mu.Unlock()
	}()

	// Escribir eventos hasta que el cliente se desconecte
	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, open := <-ch:
			if !open {
				return
			}
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", msg.Evento, msg.Data)
			flusher.Flush()
		}
	}
}

// NumClientes devuelve el número de clientes conectados actualmente.
func (b *Broker) NumClientes() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.clientes)
}
