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
	cerrado     bool

	// ultimos guarda el ÚLTIMO mensaje de cada tipo de evento. Al conectarse un
	// cliente nuevo (p. ej. el admin que reabre la pestaña a mitad de simulación)
	// se le reenvían como SNAPSHOT, para que el mapa y los contadores se
	// reconstruyan sin esperar al siguiente tick/replanificación.
	ultimos      map[string]Mensaje
	ordenUltimos []string // orden de primera aparición, para reenviar coherente
}

// Nuevo crea un Broker con límite de clientes.
func Nuevo(maxClientes int) *Broker {
	return &Broker{
		clientes:    make(map[chan Mensaje]struct{}),
		maxClientes: maxClientes,
		ultimos:     make(map[string]Mensaje),
	}
}

// Cerrar desconecta a todos los clientes y marca el broker como cerrado.
// Tras llamarlo, las conexiones SSE en curso terminan (sus goroutines y las
// del proxy SSE del BFF se liberan) y no se aceptan nuevos clientes.
// Se usa al iniciar una nueva simulación para limpiar la anterior.
func (b *Broker) Cerrar() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.cerrado {
		return
	}
	b.cerrado = true
	for ch := range b.clientes {
		delete(b.clientes, ch)
		close(ch)
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
	if _, visto := b.ultimos[evento]; !visto {
		b.ordenUltimos = append(b.ordenUltimos, evento)
	}
	b.ultimos[evento] = msg
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
	if b.cerrado {
		b.mu.Unlock()
		http.Error(w, "Simulación finalizada", http.StatusGone)
		return
	}
	if len(b.clientes) >= b.maxClientes {
		b.mu.Unlock()
		http.Error(w, "Demasiados clientes SSE", http.StatusTooManyRequests)
		return
	}
	ch := make(chan Mensaje, 64)
	b.clientes[ch] = struct{}{}
	// SNAPSHOT: reenviar el último evento de cada tipo al recién conectado, en su
	// orden de aparición. ch está recién creado y nadie más lo lee aún; el búfer
	// (64) cubre de sobra los pocos tipos de evento.
	for _, ev := range b.ordenUltimos {
		select {
		case ch <- b.ultimos[ev]:
		default:
		}
	}
	b.mu.Unlock()

	// Limpiar al desconectar (idempotente: Cerrar() pudo haber cerrado ch ya)
	defer func() {
		b.mu.Lock()
		if _, existe := b.clientes[ch]; existe {
			delete(b.clientes, ch)
			close(ch)
		}
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
