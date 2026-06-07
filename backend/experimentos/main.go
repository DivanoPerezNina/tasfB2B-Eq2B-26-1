// Módulo de experimentación — calibración de Ta, Sa, Sc y K.
//
// Mide el tiempo de ejecución del GVNS (Ta) para distintos tamaños de bloque de
// datos (Sc) y reporta qué combinaciones (Sc, Sa) hacen que la Simulación 5D
// dure entre 30 y 90 minutos reales SIN violar la estabilidad (Ta < Sa).
//
// NO inventa valores: los mide llamando al endpoint /api/planificacion/benchmark
// del Planificador con ventanas reales del dataset.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// ── Parámetros (flags) ───────────────────────────────────────────────────────

var (
	planificador = flag.String("planificador", "http://localhost:8084", "URL del Planificador")
	fechaStr     = flag.String("fecha", "2026-07-20T08:15", "t=0 de la Sim5D (YYYY-MM-DDTHH:MM, interpretada como UTC)")
	dias         = flag.Int("dias", 5, "días a simular (Sim5D = 5)")
	criterio     = flag.String("criterio", "EDF", "criterio GVNS: EDF | FIFO | ALEATORIO")
	scLista      = flag.String("sc", "60,120,240,480,720", "tamaños de bloque Sc a probar (minutos de datos, CSV)")
	objMin       = flag.Float64("obj-min", 30, "duración real mínima deseada (min)")
	objMax       = flag.Float64("obj-max", 90, "duración real máxima deseada (min)")
	muestras     = flag.Int("muestras", 0, "si >0, mide solo N bloques espaciados (rápido); 0 = todos (preciso)")
)

// ── Respuesta del endpoint benchmark ─────────────────────────────────────────

// El Planificador devuelve el JSON PLANO (sin envelope {data:...} como el BFF).
type benchResp struct {
	TotalEnvios int     `json:"totalEnvios"`
	Exitosos    int     `json:"exitosos"`
	Rechazados  int     `json:"rechazados"`
	TaSeg       float64 `json:"taSeg"`
	Fase2Seg    float64 `json:"fase2Seg"`
	Fase3Seg    float64 `json:"fase3Seg"`
}

func main() {
	flag.Parse()

	t0 := fechaAMinutosUTC(*fechaStr)
	if t0 < 0 {
		fmt.Fprintln(os.Stderr, "fecha inválida, usa YYYY-MM-DDTHH:MM")
		os.Exit(1)
	}
	totalMin := int64(*dias) * 1440

	fmt.Printf("Experimento de calibración Ta/Sa/Sc/K\n")
	fmt.Printf("  Planificador: %s\n", *planificador)
	fmt.Printf("  t=0:          %s  (%d min UTC)\n", *fechaStr, t0)
	fmt.Printf("  Ventana:      %d días = %d min de datos\n", *dias, totalMin)
	fmt.Printf("  Criterio:     %s\n", *criterio)
	fmt.Printf("  Objetivo:     %.0f–%.0f min reales\n\n", *objMin, *objMax)

	fmt.Printf("%-8s %-8s %-10s %-9s %-9s %-9s %-9s %-9s %s\n",
		"Sc(min)", "bloques", "envíos", "Ta_max(s)", "Ta_avg(s)", "rech", "Sa_min*", "K_max**", "¿factible 30-90?")
	fmt.Println(strings.Repeat("─", 110))

	for _, scStr := range strings.Split(*scLista, ",") {
		sc, err := strconv.ParseInt(strings.TrimSpace(scStr), 10, 64)
		if err != nil || sc <= 0 {
			continue
		}
		evaluarSc(t0, totalMin, sc)
	}

	fmt.Println(strings.Repeat("─", 110))
	fmt.Println("*  Sa_min = Ta_max (estabilidad: Sa debe ser > Ta). Duración mínima = bloques·Ta_max.")
	fmt.Println("** K_max = Sc / (Sa_min en min) — la aceleración máxima estable para ese Sc.")
	fmt.Println("   Una combinación es 'factible' si existe Sa con Ta_max < Sa tal que bloques·Sa ∈ [obj-min, obj-max].")
}

func evaluarSc(t0, totalMin, sc int64) {
	nBloques := int(totalMin / sc)
	if nBloques == 0 {
		return
	}

	// Selección de bloques a medir (todos, o muestreo uniforme).
	indices := make([]int, 0, nBloques)
	if *muestras > 0 && *muestras < nBloques {
		paso := nBloques / *muestras
		for i := 0; i < nBloques; i += paso {
			indices = append(indices, i)
		}
	} else {
		for i := 0; i < nBloques; i++ {
			indices = append(indices, i)
		}
	}

	var taMax, taSum float64
	var enviosTot, rechTot int
	medidos := 0
	for _, i := range indices {
		ini := t0 + int64(i)*sc
		fin := ini + sc
		r, err := medirBloque(ini, fin)
		if err != nil {
			fmt.Printf("  [Sc=%d bloque %d] error: %v\n", sc, i, err)
			continue
		}
		if r.TaSeg > taMax {
			taMax = r.TaSeg
		}
		taSum += r.TaSeg
		enviosTot += r.TotalEnvios
		rechTot += r.Rechazados
		medidos++
	}
	if medidos == 0 {
		return
	}
	taAvg := taSum / float64(medidos)
	// Si se muestreó, extrapolar envíos totales al nº real de bloques.
	enviosEstim := enviosTot
	if medidos < nBloques {
		enviosEstim = enviosTot * nBloques / medidos
	}

	// Estabilidad: Sa debe superar Ta_max. Duración mínima posible = bloques·Ta_max.
	durMinPosibleMin := float64(nBloques) * taMax / 60.0
	saMin := taMax                       // segundos
	kMax := float64(sc) / (saMin / 60.0) // Sc[min] / Sa[min]

	// ¿Existe Sa con Ta_max < Sa tal que bloques·Sa ∈ [objMin, objMax] (en min)?
	// bloques·Sa(seg)/60 ∈ [objMin,objMax]  →  Sa ∈ [objMin*60/n, objMax*60/n]
	saLo := *objMin * 60.0 / float64(nBloques)
	saHi := *objMax * 60.0 / float64(nBloques)
	factible := saHi > taMax && saLo <= saHi // existe Sa>Ta_max dentro del rango de duración
	veredicto := "NO (Ta domina)"
	if factible {
		// Sa recomendado = max(taMax*margen, saLo), acotado a saHi.
		saRec := taMax * 1.3
		if saRec < saLo {
			saRec = saLo
		}
		if saRec > saHi {
			saRec = saHi
		}
		dur := float64(nBloques) * saRec / 60.0
		kRec := float64(sc) / (saRec / 60.0)
		veredicto = fmt.Sprintf("SÍ → Sa≈%.1fs K≈%.0f dur≈%.0fmin", saRec, kRec, dur)
	} else if durMinPosibleMin > *objMax {
		veredicto = fmt.Sprintf("NO (mín %.0fmin > %.0f)", durMinPosibleMin, *objMax)
	}

	fmt.Printf("%-8d %-8d %-10d %-9.3f %-9.3f %-9d %-9.2f %-9.0f %s\n",
		sc, nBloques, enviosEstim, taMax, taAvg, rechTot, saMin, kMax, veredicto)
}

func medirBloque(iniUTC, finUTC int64) (*benchResp, error) {
	body, _ := json.Marshal(map[string]interface{}{
		"iniUTC": iniUTC, "finUTC": finUTC, "criterio": *criterio,
	})
	resp, err := http.Post(*planificador+"/api/planificacion/benchmark",
		"application/json", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	var r benchResp
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return nil, err
	}
	return &r, nil
}

// fechaAMinutosUTC convierte "YYYY-MM-DDTHH:MM" (interpretada como UTC) a minutos
// absolutos desde Epoch — equivale a calcularEpochMinutos con GMT=0.
func fechaAMinutosUTC(s string) int64 {
	t, err := time.Parse("2006-01-02T15:04", s)
	if err != nil {
		// admitir solo fecha
		t, err = time.Parse("2006-01-02", s)
		if err != nil {
			return -1
		}
	}
	return t.UTC().Unix() / 60
}
