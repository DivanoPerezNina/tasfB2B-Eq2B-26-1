# Plan de Tests — Simulación de Periodo

## Flujo backend (3 pasos)

```
POST /api/periodo/iniciar        ← todos los parámetros de una vez
GET  /api/periodo/status/{jobId} ← polling hasta COMPLETADO
POST /api/periodo/ejecutar/{jobId} ← inicia simulación (sin parámetros extra)
```

## Pre-requisitos

Levantar los 3 servicios necesarios (en terminales separadas):

```bat
cd backend\planificador && start.bat   :: :8084
cd backend\ejecutor    && start.bat    :: :8083
cd backend\bff         && start.bat    :: :8081
```

Verificar:
```bat
curl http://localhost:8081/api/health
```
Esperado: `"planificador":"ok","ejecutor":"ok","mysql":"ok"`

---

## TEST 1 — 7 días, 60 min reales, EDF

```bat
curl -X POST http://localhost:8081/api/periodo/iniciar ^
  -H "Content-Type: application/json" ^
  -d "{\"fechaInicio\":\"2026-01-15\",\"dias\":7,\"criterio\":\"EDF\",\"semilla\":42,\"duracion_real_min\":60,\"umbrales\":{\"verde_hasta\":0.6,\"ambar_hasta\":0.85}}"
```

**Esperado:**
```json
{
  "success": true,
  "data": {
    "job_id": "<uuid>",
    "estado": "EN_PROCESO",
    "dias": 7,
    "duracion_real_min": 60,
    "velocidad_efectiva": "2.80"
  }
}
```

Guardar `job_id`. Hacer polling (repetir cada 30 seg):
```bat
curl http://localhost:8081/api/periodo/status/<job_id>
```

Cuando `"estado":"COMPLETADO"` y `"progreso":100`, iniciar simulación:
```bat
curl -X POST http://localhost:8081/api/periodo/ejecutar/<job_id>
```

**Esperado:**
```json
{
  "estado": "ejecutando",
  "avance_por_tick_min": "2.8000",
  "total_envios": ...,
  "duracion_real_min": 60
}
```

Ver el stream SSE en otra terminal:
```bat
curl -N -H "Accept: text/event-stream" http://localhost:8081/api/simulacion/eventos
```

Verificar estado durante la ejecución:
```bat
curl http://localhost:8081/api/simulacion/estado
```

### Resultados de ejecución ✅ PASADO (2026-05-13)

```
POST /api/periodo/iniciar → job_id: 763ed825-259b-498e-8f4d-361b4c08f7b6
Warm-up: 13 días (2026-01-02 → 2026-01-15)
Planificación: 4184/4184 envíos asignados (100% éxito)
velocidad_efectiva: 2.80×

SSE confirmado:
  event: tick  → progreso_pct incrementando, en_vuelo subiendo
  event: aeropuertos → 30 aeropuertos, todos semaforo "verde", ocupación ~51%
```

- [x] `velocidad_efectiva` = 2.80×
- [x] `avance_por_tick_min` ≈ 2.8
- [x] Stream SSE emite eventos `tick` cada segundo
- [x] `progreso_pct` incrementa
- [x] 30 aeropuertos reportando en evento `aeropuertos`

---

## TEST 2 — 5 días, 45 min reales, EDF + pausa/reanuda

```bat
curl -X POST http://localhost:8081/api/periodo/iniciar ^
  -H "Content-Type: application/json" ^
  -d "{\"fechaInicio\":\"2027-06-01\",\"dias\":5,\"criterio\":\"EDF\",\"semilla\":42,\"duracion_real_min\":45,\"umbrales\":{\"verde_hasta\":0.6,\"ambar_hasta\":0.85}}"
```

**Velocidad esperada:** 2.67× (`5×1440 / (45×60) = 2.666`)

Tras COMPLETADO:
```bat
curl -X POST http://localhost:8081/api/periodo/ejecutar/<job_id>
```

Probar pausa y reanudación:
```bat
curl -X POST http://localhost:8081/api/simulacion/pausar
curl http://localhost:8081/api/simulacion/estado
:: Esperado: "estado":"pausado"

curl -X POST http://localhost:8081/api/simulacion/reanudar
curl http://localhost:8081/api/simulacion/estado
:: Esperado: "estado":"ejecutando"
```

### Criterios ✅
- [ ] `velocidad_efectiva` = 2.67×
- [ ] Pausa detiene el tick engine (progreso_pct se congela)
- [ ] Reanuda correctamente desde donde se pausó
- [ ] Fecha 2027 (warm-up más largo) no genera errores

---

## TEST 3 — 3 días, 30 min reales, FIFO + detención

```bat
curl -X POST http://localhost:8081/api/periodo/iniciar ^
  -H "Content-Type: application/json" ^
  -d "{\"fechaInicio\":\"2028-12-15\",\"dias\":3,\"criterio\":\"FIFO\",\"semilla\":123,\"duracion_real_min\":30,\"umbrales\":{\"verde_hasta\":0.6,\"ambar_hasta\":0.85}}"
```

**Velocidad esperada:** 2.40× (`3×1440 / (30×60) = 2.4`)

Tras COMPLETADO:
```bat
curl -X POST http://localhost:8081/api/periodo/ejecutar/<job_id>
```

Probar detención anticipada:
```bat
curl -X POST http://localhost:8081/api/simulacion/detener
:: Esperado: {"estado":"detenido"}

curl http://localhost:8081/api/simulacion/estado
:: Esperado: 404 SIN_SIMULACION

:: Se puede iniciar una nueva simulación sin reiniciar servicios:
curl -X POST http://localhost:8081/api/periodo/iniciar ^
  -H "Content-Type: application/json" ^
  -d "{\"fechaInicio\":\"2028-12-15\",\"dias\":3,\"criterio\":\"FIFO\",\"semilla\":123,\"duracion_real_min\":30,\"umbrales\":{\"verde_hasta\":0.6,\"ambar_hasta\":0.85}}"
```

### Criterios ✅
- [ ] Criterio FIFO funciona sin errores
- [ ] `velocidad_efectiva` = 2.40×
- [ ] Detención libera el simulador (siguiente inicio devuelve 202, no 409)
- [ ] Fecha cercana al fin del dataset (2029-01-05) no genera errores

---

## Tabla resumen

| Test | Fecha inicio | Días | Duración | Criterio | Velocidad | Extra |
|------|-------------|------|----------|----------|-----------|-------|
| T1   | 2026-01-15  | 7    | 60 min   | EDF      | 2.80×     | SSE completo |
| T2   | 2027-06-01  | 5    | 45 min   | EDF      | 2.67×     | Pausa/reanuda |
| T3   | 2028-12-15  | 3    | 30 min   | FIFO     | 2.40×     | Detención + reuso |
