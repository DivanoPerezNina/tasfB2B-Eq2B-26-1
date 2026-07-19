package sse

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Un cliente que se conecta a MITAD de simulación (el admin reabriendo la
// pestaña) debe recibir de inmediato el último evento de cada tipo (snapshot),
// sin esperar al siguiente tick/replanificación.
func TestBrokerReenviaSnapshotAlReconectar(t *testing.T) {
	b := Nuevo(10)
	// Estado ya emitido antes de que el cliente se conecte.
	b.Publicar("plan-tramos", map[string]any{"tramos": 3})
	b.Publicar("tick", map[string]any{"contadores": map[string]int{"entregado": 7}})

	srv := httptest.NewServer(http.HandlerFunc(b.ServeHTTP))
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("conectar SSE: %v", err)
	}
	defer resp.Body.Close()

	got := make(chan string, 1)
	go func() {
		acc := ""
		buf := make([]byte, 2048)
		for {
			n, err := resp.Body.Read(buf)
			acc += string(buf[:n])
			if strings.Contains(acc, "plan-tramos") && strings.Contains(acc, "tick") {
				got <- acc
				return
			}
			if err != nil {
				got <- acc
				return
			}
		}
	}()

	select {
	case acc := <-got:
		if !strings.Contains(acc, "plan-tramos") || !strings.Contains(acc, "tick") {
			t.Fatalf("snapshot incompleto; recibido:\n%s", acc)
		}
		if !strings.Contains(acc, "\"entregado\":7") {
			t.Fatalf("el snapshot no trae los datos del último tick; recibido:\n%s", acc)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("no se recibió el snapshot al conectar (timeout)")
	}
}

// Solo se cachea el ÚLTIMO evento de cada tipo: un segundo tick reemplaza al
// primero, así el snapshot refleja el estado más reciente.
func TestBrokerCacheaSoloElUltimoPorTipo(t *testing.T) {
	b := Nuevo(10)
	b.Publicar("tick", map[string]any{"n": 1})
	b.Publicar("tick", map[string]any{"n": 2})

	if len(b.ordenUltimos) != 1 {
		t.Fatalf("se esperaba 1 tipo de evento cacheado, hay %d", len(b.ordenUltimos))
	}
	if !strings.Contains(b.ultimos["tick"].Data, "\"n\":2") {
		t.Fatalf("el cache debe tener el último tick (n=2), tiene: %s", b.ultimos["tick"].Data)
	}
}
