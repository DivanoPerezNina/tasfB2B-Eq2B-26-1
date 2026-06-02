# Ejecutor — Motor de Simulación

**Lenguaje:** Go  
**Puerto:** 8083  
**Estado:** ✅ Implementado y operativo

---

## 1. Responsabilidad

Recibe el `job_id` de un plan generado por el Planificador, lo carga en memoria y ejecuta la simulación tick a tick. Emite eventos **SSE** al frontend con el estado en tiempo real. Soporta pausa, reanudación y detención.

> El Ejecutor **no escribe en MySQL**. Todo el estado vive en memoria.

---

## 2. Velocidad — Fórmula

```
avance_por_tick (min_sim/seg_real) = (dias × 1440) / (duracion_real_min × 60)
```

Un **tick** ocurre cada 1 segundo real. Por cada tick, el reloj simulado avanza `avance_por_tick` minutos.

### Ejemplos

| Días | Duración real | Velocidad efectiva |
|------|---------------|--------------------|
| 3    | 30 min        | 2.4×               |
| 3    | 60 min        | 1.2×               |
| 5    | 45 min        | 2.67×              |
| 7    | 60 min        | 2.8×               |
| 7    | 90 min        | 1.87×              |

---

## 3. API REST

### Base URL
```
http://localhost:8083  (o vía BFF: http://localhost:8081/api/simulacion/...)
```

### `POST /api/simulacion/iniciar`
```json
{
  "job_id": "<uuid del Planificador>",
  "duracion_real_min": 60,
  "umbrales": { "verde_hasta": 0.60, "ambar_hasta": 0.85 }
}
```
**202 Accepted** — devuelve `simulacion_id`, `ini_utc`, `fin_utc`, `avance_por_tick_min`, `total_envios`.

### `POST /api/simulacion/pausar`
Suspende el tick engine. **200 OK** `{"estado":"pausado"}`.

### `POST /api/simulacion/reanudar`
Reanuda el tick engine. **200 OK** `{"estado":"ejecutando"}`.

### `POST /api/simulacion/detener`
Para y libera memoria. **200 OK** `{"estado":"detenido"}`.

### `GET /api/simulacion/estado`
```json
{
  "simulacion_id": "...",
  "estado": "ejecutando",
  "tiempo_sim_utc": 1755563400,
  "progreso_pct": "38.5",
  "contadores": { "total": 484, "pendiente": 200, "en_vuelo": 100, "en_escala": 50, "entregado": 120, "rechazado": 14 },
  "clientes_sse": 1
}
```

### `GET /api/simulacion/aeropuertos`
Lista con estado actual de cada aeropuerto (maletas, ocupación, semáforo).

### `GET /api/simulacion/eventos` — **SSE**
Stream de eventos en tiempo real.

**Evento `tick`** (cada segundo):
```
event: tick
data: {"tiempo_sim_utc":1755563400,"progreso_pct":"38.5","tick":120,"contadores":{...}}
```

**Evento `aeropuertos`** (cada 5 ticks):
```
event: aeropuertos
data: [{"iata":"SKBO","maletas_almacen":50,"capacidad_almacen":430,"ocupacion":0.116,"semaforo":"verde"},...]
```

**Evento `completado`**:
```
event: completado
data: {"mensaje":"Simulación completada","contadores":{...}}
```

### `GET /api/health`
```json
{"status":"ok","service":"ejecutor","simulacion_id":"...","estado":"ejecutando","total_envios":484}
```

---

## 4. Estructura

```
ejecutor/
├── cmd/ejecutor/main.go
├── internal/
│   ├── config/config.go          # Vars de entorno
│   ├── engine/
│   │   ├── simulacion.go         # Motor central (tick engine, control, SSE)
│   │   └── tipos.go              # EstadoEnvio, TramoSim, Contadores, etc.
│   ├── handler/simulacion.go     # HTTP handlers + SimulacionHandler
│   └── sse/broker.go             # Broker SSE multi-cliente thread-safe
├── go.mod
├── start.bat
└── EJECUTOR.md
```

---

## 5. Levantar en desarrollo

```bat
cd backend\ejecutor
start.bat
```

O manualmente:
```bat
set PORT=8083
set PLANIFICADOR_URL=http://localhost:8084
set TICK_INTERVAL_MS=1000
set SSE_MAX_CLIENTES=50
go run ./cmd/ejecutor/main.go
```

---

## 6. Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `PORT` | `8083` | Puerto del servicio |
| `PLANIFICADOR_URL` | `http://localhost:8084` | URL del Planificador (para obtener el plan) |
| `TICK_INTERVAL_MS` | `1000` | Milisegundos entre ticks (1000 = 1 seg) |
| `SSE_MAX_CLIENTES` | `50` | Máximo de clientes SSE simultáneos |

---

## 7. TODOs pendientes

- [ ] Cancelaciones de vuelo (re-planificación mid-simulation)
- [ ] Escenario COLAPSO (criterio de parada automático)
- [ ] Persistencia de resultados en MySQL al completar
