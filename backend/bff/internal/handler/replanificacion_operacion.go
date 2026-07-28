package handler

import (
	"log"
	"net/http"
	"strings"
	"time"
)

// solicitarReplanificacionOperacion notifica al Ejecutor después de que el BFF
// confirmó una escritura en envios_operacion o vuelos_operacion. La llamada es
// asíncrona para que el operario reciba la confirmación del registro sin esperar
// al planificador. El canal del Ejecutor agrupa señales simultáneas, por lo que
// cuatro operarios pueden registrar a la vez sin lanzar cuatro planes en paralelo.
func solicitarReplanificacionOperacion(ejecutorURL string) {
	base := strings.TrimRight(strings.TrimSpace(ejecutorURL), "/")
	if base == "" {
		return
	}
	go func() {
		req, err := http.NewRequest(http.MethodPost, base+"/api/simulacion/replanificar", nil)
		if err != nil {
			log.Printf("Día a Día: no se pudo crear solicitud de replanificación: %v", err)
			return
		}
		cli := &http.Client{Timeout: 3 * time.Second}
		resp, err := cli.Do(req)
		if err != nil {
			log.Printf("Día a Día: replanificación pendiente; Ejecutor no disponible: %v", err)
			return
		}
		resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			log.Printf("Día a Día: Ejecutor respondió %d al solicitar replanificación", resp.StatusCode)
		}
	}()
}
