# Ejecutor — Especificación del Módulo

**Lenguaje:** Go  
**Puerto:** 8083  
**Responsable:** [asignar integrante]

---

## 1. Responsabilidad

Recibe el plan generado por el Planificador, lo carga en memoria y ejecuta la simulación tick a tick según la velocidad calculada. Emite eventos SSE al frontend con el estado actual filtrado por lo que el cliente está mirando. Maneja pausas, reinicios y el protocolo de re-planificación ante cancelaciones.

**El Ejecutor no escribe en MySQL durante la simulación.** Todo el estado vive en memoria hasta que la simulación termina.

---

## 2. Modos de Velocidad por Escenario

### Fórmula general

```
avance_sim_por_tick = (dias_escenario × 1440) / duracion_real_seg
```

Un tick ocurre cada **1 segundo real**. Por cada tick, el reloj simulado avanza `avance_sim_por_tick` minutos.

### Por escenario

| Escenario | Configurado por | Velocidad |
|---|---|---|
| `TIEMPO_REAL` | Sistema (fijo) | 1 min simulado / 1 seg real |
| `PERIODO_3D` | Usuario: elige duración real 30–90 min | `(3 × 1440) / duración_real_seg` |
| `PERIODO_5D` | Usuario: elige duración real 30–90 min | `(5 × 1440) / duración_real_seg` |
| `PERIODO_7D` | Usuario: elige duración real 30–90 min | `(7 × 1440) / duración_real_seg` |
| `COLAPSO` | Sistema (fijo) | 1440 min simulados / 1 seg real (= 1 día/seg) |

### Ejemplo de cálculo — Periodo 3 días en 45 minutos reales

```
avance = (3 × 1440) / (45 × 60) = 4320 / 2700 = 1.6 min simulados por segundo real
→ en 45 min reales se simulan exactamente 3 días
```

### Parámetros que recibe del frontend (vía BFF)

```json
{
  "simulacion_id": 1,
  "escenario": "PERIODO_3D",
  "duracion_real_min": 45
}
```

El Ejecutor calcula `avance_sim_por_tick` internamente y no lo expone al usuario.

---

## 3. Estado en Memoria

Al iniciar, el Ejecutor carga desde MySQL (una sola lectura):

```
rutas_envio  WHERE simulacion_id = X
→ Go: map[string]*EstadoEnvio   (key = "id_envio:origen_iata")

vuelos       (todos)
→ Go: map[int]*EstadoVuelo      (key = vuelo_id)

aeropuertos  (todos)
→ Go: map[string]*EstadoAeropuerto  (key = iata)
```

### Estructuras en memoria

```go
type EstadoEnvio struct {
    IDEnvio      string
    OrigenIATA   string
    DestinoIATA  string
    Segmentos    []SegmentoRuta   // máx 3
    SegmentoActual int
    Estado       string           // pendiente|en_vuelo|en_escala|entregado|rechazado|salvado_gvns
    DeadlineUTC  int64
}

type SegmentoRuta struct {
    VueloID      int
    SalidaUTC    int64
    LlegadaUTC   int64
    Estado       string
}

type EstadoVuelo struct {
    ID           int
    OrigenIATA   string
    DestinoIATA  string
    CapacidadMax int
    OcupacionActual int          // maletas actualmente asignadas en este tick
}

type EstadoAeropuerto struct {
    IATA              string
    CapacidadAlmacen  int
    OcupacionActual   int        // maletas en espera en el almacén
    Semaforo          string     // verde|ambar|rojo (calculado por umbrales)
}
```

**Uso estimado de RAM para 9.5M envíos × 3 segmentos:**
- `EstadoEnvio`: ~120 bytes × 9.5M ≈ **1.14 GB**
- `EstadoVuelo`: ~50 bytes × 5000 ≈ **0.24 MB** (despreciable)
- `EstadoAeropuerto`: ~80 bytes × 30 ≈ **0.002 MB** (despreciable)
- **Total estimado: ~1.2 GB** — dentro del presupuesto de 4 GB de RAM

---

## 4. Tick Engine

```
goroutine tickEngine() {
  ticker := time.NewTicker(1 * time.Second)
  for {
    select {
    case <-ticker.C:
      tiempoActual += avanceSimPorTick
      procesarEventos(tiempoActual)
      emitirEventosTick(tiempoActual)
    case <-señalPausa:
      esperar()
    case <-señalStop:
      return
    }
  }
}
```

### Lo que hace `procesarEventos(t)` en cada tick

1. **Salidas de vuelo** — busca todos los segmentos donde `salida_utc ≤ t` y estado = `pendiente`
   - Mueve el envío a estado `en_vuelo`
   - Incrementa `OcupacionActual` del vuelo
   - Decrementa `OcupacionActual` del aeropuerto origen

2. **Llegadas de vuelo** — busca todos los segmentos donde `llegada_utc ≤ t` y estado = `en_vuelo`
   - Si tiene segmento siguiente → estado `en_escala`, incrementa almacén del aeropuerto escala
   - Si es último segmento → estado `entregado`
   - Decrementa `OcupacionActual` del vuelo

3. **Vencimientos de deadline** — busca envíos donde `deadline_utc < t` y estado ≠ `entregado`
   - Marca como `rechazado` (o `salvado_gvns` si el GVNS lo recuperó)

4. **Recalcular semáforos** — actualiza `Semaforo` de cada aeropuerto con base en umbrales configurados

---

## 5. API REST

### Base URL
```
http://localhost:8083
```

---

### 5.1 Iniciar ejecución de simulación

```
POST /api/simulacion/iniciar
Content-Type: application/json
```

```json
{
  "simulacion_id": 1,
  "escenario": "PERIODO_3D",
  "duracion_real_min": 45,
  "umbrales_semaforo": {
    "verde_hasta": 0.60,
    "ambar_hasta": 0.85
  }
}
```

**Respuesta `202 Accepted`:**
```json
{
  "ejecucion_id": 1,
  "estado": "cargando",
  "avance_sim_por_tick_min": 1.6,
  "mensaje": "Cargando plan desde MySQL..."
}
```

**Respuesta si ya hay una simulación activa `409 Conflict`:**
```json
{
  "error": "SIMULACION_ACTIVA",
  "mensaje": "Ya hay una simulación en ejecución. Deténgala antes de iniciar otra."
}
```

---

### 5.2 Consultar estado de la ejecución

```
GET /api/simulacion/{ejecucion_id}/estado
```

```json
{
  "ejecucion_id": 1,
  "estado": "ejecutando",
  "tiempo_sim_actual_utc": 1755563400,
  "dia_simulado": 2,
  "progreso_pct": 38.5,
  "contadores": {
    "total": 9519995,
    "pendiente": 5102340,
    "en_vuelo": 1840210,
    "en_escala": 420300,
    "entregado": 1904120,
    "rechazado": 210880,
    "salvado_gvns": 42145
  },
  "tiempo_real_transcurrido_seg": 1012
}
```

---

### 5.3 Pausar simulación

```
POST /api/simulacion/{ejecucion_id}/pausar
```

```json
{ "estado": "pausado", "tiempo_sim_pausado_utc": 1755563400 }
```

---

### 5.4 Reanudar simulación

```
POST /api/simulacion/{ejecucion_id}/reanudar
```

```json
{ "estado": "ejecutando" }
```

---

### 5.5 Detener simulación

```
POST /api/simulacion/{ejecucion_id}/detener
```

Libera toda la memoria. La simulación no puede reanudarse.

```json
{ "estado": "detenido", "memoria_liberada": true }
```

---

### 5.6 Reportar cancelación

```
POST /api/simulacion/{ejecucion_id}/cancelar
Content-Type: application/json
```

```json
{
  "tipo": "VUELO",
  "id_afectado": 2847,
  "tiempo_sim_utc": 1755520000
}
```

**Flujo interno al recibir cancelación:**

```
1. Ejecutor pausa el tick engine
2. Ejecutor identifica envíos afectados en memoria
3. Ejecutor llama POST /api/planificacion/{simulacion_id}/replanificar (Planificador)
4. Ejecutor hace polling GET /api/planificacion/{simulacion_id} hasta estado = "listo"
5. Ejecutor lee las nuevas rutas_envio de MySQL y actualiza su estado en memoria
6. Ejecutor reanuda el tick engine
7. Ejecutor emite evento SSE tipo "replanificacion_completada"
```

**Respuesta `202 Accepted`:**
```json
{
  "estado": "replanificando",
  "envios_afectados": 340,
  "mensaje": "Simulación pausada. Re-planificando con GVNS..."
}
```

> ⚠️ Durante la re-planificación el frontend debe mostrar un indicador de "Re-calculando rutas..." y bloquear la interacción.

---

### 5.7 Stream SSE — eventos en tiempo real

```
GET /api/simulacion/{ejecucion_id}/eventos
Accept: text/event-stream
```

**Query params de filtro (al menos uno requerido):**

| Parámetro | Ejemplo | Descripción |
|---|---|---|
| `aeropuerto` | `?aeropuerto=SKBO` | Eventos de un aeropuerto específico |
| `vuelo_id` | `?vuelo_id=42` | Eventos de un vuelo específico |
| `envio_id` | `?envio_id=00000001&origen=SKBO` | Seguimiento de un envío específico |

**Evento de tick (siempre, a todos los suscriptores):**
```
event: tick
data: {"tiempo_sim_utc":1755563400,"dia":2,"hora_sim":"14:20","progreso_pct":38.5}
```

**Evento de estado de aeropuerto (solo al suscriptor de ese aeropuerto):**
```
event: aeropuerto_estado
data: {
  "iata": "SKBO",
  "ocupacion_almacen": 0.72,
  "semaforo": "ambar",
  "maletas_en_almacen": 309,
  "capacidad_almacen": 430,
  "vuelos_activos": 3
}
```

**Evento de salida de vuelo:**
```
event: vuelo_salida
data: {
  "vuelo_id": 42,
  "origen": "SKBO",
  "destino": "SEQM",
  "maletas_embarcadas": 218,
  "capacidad": 250,
  "tiempo_sim_utc": 1755563400
}
```

**Evento de llegada de vuelo:**
```
event: vuelo_llegada
data: {
  "vuelo_id": 42,
  "destino": "SEQM",
  "maletas_descargadas": 218,
  "entregadas": 195,
  "en_escala": 23,
  "tiempo_sim_utc": 1755577800
}
```

**Evento de seguimiento de envío individual:**
```
event: envio_actualizado
data: {
  "id_envio": "00000001",
  "estado": "en_vuelo",
  "vuelo_actual": 42,
  "desde": "SKBO",
  "hacia": "SEQM",
  "llegada_estimada_utc": 1755577800,
  "deadline_utc": 1755648000,
  "tiempo_restante_min": 1200
}
```

**Evento de re-planificación:**
```
event: replanificacion_completada
data: {
  "tipo_cancelacion": "VUELO",
  "id_afectado": 2847,
  "envios_replanificados": 340,
  "envios_sin_solucion": 12
}
```

---

### 5.8 Consultar estado de un envío específico (HTTP, no SSE)

```
GET /api/simulacion/{ejecucion_id}/envio/{id_envio}?origen={iata}
```

```json
{
  "id_envio": "00000001",
  "origen_iata": "SKBO",
  "destino_iata": "EBCI",
  "estado": "en_escala",
  "segmento_actual": 1,
  "ruta": [
    { "segmento": 0, "vuelo_id": 42,  "desde": "SKBO", "hacia": "SEQM", "estado": "entregado_escala" },
    { "segmento": 1, "vuelo_id": 187, "desde": "SEQM", "hacia": "EBCI", "estado": "pendiente" }
  ],
  "deadline_utc": 1755648000,
  "en_plazo": true
}
```

---

### 5.9 Consultar estado de un aeropuerto específico (HTTP, no SSE)

```
GET /api/simulacion/{ejecucion_id}/aeropuerto/{iata}
```

```json
{
  "iata": "SKBO",
  "semaforo": "ambar",
  "ocupacion_almacen": 0.72,
  "maletas_en_almacen": 309,
  "capacidad_almacen": 430,
  "vuelos_proximos": [
    { "vuelo_id": 45, "destino": "SBBR", "salida_sim_utc": 1755567000, "ocupacion": 0.88 }
  ],
  "envios_pendientes": 340,
  "envios_retrasados": 12
}
```

---

### 5.10 Health check

```
GET /api/health
```

```json
{
  "estado": "ok",
  "simulacion_activa": true,
  "ejecucion_id": 1,
  "memoria_envios_cargados": 9519995
}
```

---

## 6. Estructura de Carpetas

```
ejecutor/
├── cmd/
│   └── ejecutor/
│       └── main.go                  # Entry point, configura rutas HTTP
├── internal/
│   ├── handler/
│   │   ├── simulacion.go            # Endpoints iniciar/pausar/reanudar/detener
│   │   ├── cancelacion.go           # Endpoint cancelar + protocolo re-planificación
│   │   ├── eventos.go               # SSE: gestión de suscriptores y emisión
│   │   └── consultas.go             # Endpoints HTTP envío/aeropuerto
│   ├── engine/
│   │   ├── tick.go                  # Goroutine del tick engine
│   │   ├── eventos_sim.go           # procesarEventos(): salidas, llegadas, vencimientos
│   │   └── semaforo.go              # Cálculo de semáforos por umbral
│   ├── estado/
│   │   ├── memoria.go               # Estructuras en RAM y su ciclo de vida
│   │   └── cargador.go              # Lee rutas_envio de MySQL al iniciar
│   ├── sse/
│   │   ├── broker.go                # Gestiona N clientes SSE concurrentemente
│   │   └── filtro.go                # Filtra eventos por suscripción (aeropuerto/vuelo/envío)
│   └── cliente/
│       └── planificador.go          # Cliente HTTP hacia el Planificador (re-planificación)
├── go.mod
└── EJECUTOR.md                      # este archivo
```

---

## 7. Variables de Configuración

| Variable | Valor por defecto | Descripción |
|---|---|---|
| `PORT` | `8083` | Puerto del servicio |
| `DB_HOST` | `localhost` | Host MySQL (solo lectura al inicio) |
| `DB_PORT` | `3306` | Puerto MySQL |
| `DB_NAME` | `tasfb2b` | Base de datos |
| `DB_USER` | `tasf` | Usuario |
| `DB_PASS` | — | Contraseña (obligatoria) |
| `PLANIFICADOR_URL` | `http://localhost:8080` | URL del Planificador |
| `TICK_INTERVAL_MS` | `1000` | Intervalo real entre ticks (ms) |
| `SSE_MAX_CLIENTES` | `50` | Máximo de clientes SSE simultáneos |

---

## 8. TODOs

- [ ] **TODO-1** Implementar `cargador.go` — carga eficiente de `rutas_envio` desde MySQL con streaming (no cargar todo en un solo query para no saturar RAM)
- [ ] **TODO-2** Implementar `broker.go` con goroutines concurrentes seguras (uso de `sync.RWMutex` o canales para el mapa de suscriptores)
- [ ] **TODO-3** Revisar protocolo de cancelación — coordinar con Planificador qué pasa si la re-planificación demora más de 5 min (timeout, qué notifica al frontend)
- [ ] **TODO-4** Manejo de desconexión SSE — si el frontend se desconecta y reconecta, definir si puede retomar desde el tick actual o recibe solo eventos nuevos
- [ ] **TODO-5** Escenario COLAPSO — definir criterio de parada (¿cuándo se considera que las operaciones colapsaron? ¿% de rechazos > umbral?)
