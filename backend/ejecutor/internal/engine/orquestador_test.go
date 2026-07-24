package engine

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// El body de /desde-datos ahora se genera por io.Pipe (cabecera + encoder + "}").
// Riesgo: que el JSON salga malformado. Este test captura el body que recibe un
// planificador simulado y verifica que es JSON válido con los campos correctos.
func TestPlanificarBodyStreamingEsJSONValido(t *testing.T) {
	var captured []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured, _ = io.ReadAll(r.Body)
		io.WriteString(w, `{"resumen":{"ventanaIniUTC":5,"ventanaFinUTC":50,"observacionIniUTC":100},"aeropuertos":[],"envios":[]}`)
	}))
	defer srv.Close()

	o := &Orquestador{PlanificadorURL: srv.URL, T0UTC: 100, Criterio: "EDF"}
	envios := []envioConsulta{
		{Origen: "AAAA", Destino: "BBBB", Maletas: 2, RegistroUTC: 10, DeadlineUTC: 20},
	}
	cancelados := []cancelacion{{Origen: "AAAA", Destino: "BBBB", SalidaUTC: 14460}}
	resp, err := o.planificar(envios, cancelados, nil, 5, 50)
	if err != nil {
		t.Fatalf("planificar: %v", err)
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()

	var got struct {
		IniUTC     int64           `json:"iniUTC"`
		FinUTC     int64           `json:"finUTC"`
		ObsUTC     int64           `json:"observacionIniUTC"`
		Criterio   string          `json:"criterio"`
		Envios     []envioConsulta `json:"envios"`
		Cancelados []cancelacion   `json:"cancelados"`
	}
	if err := json.Unmarshal(captured, &got); err != nil {
		t.Fatalf("body no es JSON válido: %v\nbody=%s", err, captured)
	}
	if got.IniUTC != 5 || got.FinUTC != 50 || got.ObsUTC != 100 || got.Criterio != "EDF" {
		t.Errorf("cabecera incorrecta: %+v", got)
	}
	if len(got.Envios) != 1 || got.Envios[0].Origen != "AAAA" || got.Envios[0].DeadlineUTC != 20 {
		t.Errorf("envíos mal serializados: %+v", got.Envios)
	}
	if len(got.Cancelados) != 1 || got.Cancelados[0].Origen != "AAAA" ||
		got.Cancelados[0].Destino != "BBBB" || got.Cancelados[0].SalidaUTC != 14460 {
		t.Errorf("cancelados mal serializados: %+v", got.Cancelados)
	}
}

// En día a día las rutas viajan en el body (tabla vuelos_operacion); en
// Periodo/Colapso NO deben ir (el planificador usa su archivo). Este test fija
// las dos mitades de esa regla, que es lo único que separa ambos caminos.
func TestPlanificarIncluyeVuelosSoloSiSeLePasan(t *testing.T) {
	var captured []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured, _ = io.ReadAll(r.Body)
		io.WriteString(w, `{"resumen":{"ventanaIniUTC":5,"ventanaFinUTC":50,"observacionIniUTC":100},"aeropuertos":[],"envios":[]}`)
	}))
	defer srv.Close()

	o := &Orquestador{PlanificadorURL: srv.URL, T0UTC: 100, Criterio: "EDF"}
	envios := []envioConsulta{{Origen: "AAAA", Destino: "BBBB", Maletas: 2, RegistroUTC: 10, DeadlineUTC: 20}}

	// Con vuelos (día a día): el campo debe estar y llegar intacto.
	vuelos := []vueloConsulta{{Origen: "SPIM", Destino: "SCEL", Salida: 720, Llegada: 1080, Capacidad: 150}}
	resp, err := o.planificar(envios, nil, vuelos, 5, 50)
	if err != nil {
		t.Fatalf("planificar con vuelos: %v", err)
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()

	var conVuelos struct {
		Vuelos []vueloConsulta `json:"vuelos"`
	}
	if err := json.Unmarshal(captured, &conVuelos); err != nil {
		t.Fatalf("body no es JSON válido: %v\nbody=%s", err, captured)
	}
	if len(conVuelos.Vuelos) != 1 || conVuelos.Vuelos[0].Origen != "SPIM" ||
		conVuelos.Vuelos[0].Llegada != 1080 || conVuelos.Vuelos[0].Capacidad != 150 {
		t.Errorf("vuelos mal serializados: %+v", conVuelos.Vuelos)
	}

	// Sin vuelos (Periodo/Colapso): el campo NO debe aparecer, para que el
	// planificador caiga a su archivo en vez de recibir una red vacía.
	resp2, err := o.planificar(envios, nil, nil, 5, 50)
	if err != nil {
		t.Fatalf("planificar sin vuelos: %v", err)
	}
	io.Copy(io.Discard, resp2.Body)
	resp2.Body.Close()

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(captured, &raw); err != nil {
		t.Fatalf("body no es JSON válido: %v\nbody=%s", err, captured)
	}
	if _, existe := raw["vuelos"]; existe {
		t.Errorf("sin vuelos no debe emitirse la clave 'vuelos'; body=%s", captured)
	}
}

// Round-trip: consultas → planificar (body en streaming) → nuevaDesdeReader
// (parseo del plan en streaming). Verifica que la Simulación se construye bien.
func TestPlanificarYcargarStreamingRoundTrip(t *testing.T) {
	cons := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"total":1,"envios":[{"origen":"AAAA","destino":"BBBB","maletas":2,"registroUTC":10,"deadlineUTC":20}]}`)
	}))
	defer cons.Close()

	plan := `{"resumen":{"totalEnvios":1,"exitosos":1,"rechazados":0,"ventanaIniUTC":5,"ventanaFinUTC":50,"observacionIniUTC":100},` +
		`"aeropuertos":[{"iata":"AAAA","capacidad":400}],` +
		`"envios":[{"indice":0,"origen":"AAAA","destino":"BBBB","maletas":2,"registroUTC":10,"deadlineUTC":20,"estado":"Exitoso","tramos":[]}]}`
	plani := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, plan)
	}))
	defer plani.Close()

	o := &Orquestador{
		ConsultasURL: cons.URL, PlanificadorURL: plani.URL,
		IniPlanUTC: 5, T0UTC: 100, Criterio: "EDF",
	}
	sim, err := o.planificarYcargar(50, 100)
	if err != nil {
		t.Fatalf("planificarYcargar: %v", err)
	}
	if sim == nil || sim.FinUTC != 50 {
		t.Fatalf("simulación mal construida: %+v", sim)
	}
}

// Un status != 200 del planificador debe propagarse como error (no panickear ni
// quedar a medias), para que el orquestador emita "fallo" y no corte el SSE en seco.
func TestPlanificarYcargarPropagaErrorHTTP(t *testing.T) {
	cons := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"envios":[]}`)
	}))
	defer cons.Close()
	plani := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		io.WriteString(w, `{"error":"PLAN_ERROR"}`)
	}))
	defer plani.Close()

	o := &Orquestador{ConsultasURL: cons.URL, PlanificadorURL: plani.URL, IniPlanUTC: 5, T0UTC: 100, Criterio: "EDF"}
	if _, err := o.planificarYcargar(50, 100); err == nil {
		t.Fatal("se esperaba error ante HTTP 500 del planificador")
	}
}
