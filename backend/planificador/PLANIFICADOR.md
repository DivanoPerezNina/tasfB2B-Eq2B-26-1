# Planificador GVNS — Motor de Planificación

**Lenguaje:** Java 17 (Spring Boot 3.3.4)  
**Puerto:** 8084  
**Estado:** ✅ Implementado y operativo

---

## 1. Responsabilidad

Recibe una fecha de inicio y cantidad de días, ejecuta el algoritmo **GVNS** (General Variable Neighborhood Search) con warm-up sobre el dataset histórico, y devuelve un plan completo de rutas para todos los envíos del periodo.

Lee los datos desde archivos `.txt` en disco (`C:\tmp\tasf\`). **No escribe en MySQL.**

---

## 2. Flujo de planificación

```
POST /api/planificacion/iniciar
  └─ Warm-up: greedy sin GVNS para días DATASET_INICIO → fechaInicio
  └─ GVNS real: planificarConRutas() para numDias días
  └─ Serializa JSON → job.resultadoJson
  
GET /api/planificacion/status/{jobId}   ← polling (0-100%)
GET /api/planificacion/resultado/{jobId} ← plan completo en JSON
```

---

## 3. API REST

### `POST /api/planificacion/iniciar`

```json
{
  "fechaInicio": "2026-01-15",
  "dias":        7,
  "criterio":    "EDF",
  "semilla":     42
}
```

**202 Accepted:**
```json
{ "jobId": "550e8400-...", "estado": "EN_PROCESO" }
```

### `GET /api/planificacion/status/{jobId}`

```json
{
  "jobId":    "550e8400-...",
  "estado":   "EN_PROCESO",
  "progreso": 45,
  "mensaje":  "Warm-up: calculando día 12 de 14"
}
```

Estados: `EN_PROCESO` → `COMPLETADO` / `ERROR`

### `GET /api/planificacion/resultado/{jobId}`

Plan completo en JSON:
```json
{
  "resumen": {
    "ventana_ini_utc": 1752624000,
    "ventana_fin_utc": 1753228800,
    "total_envios": 484,
    "exitosos": 470,
    "rechazados": 14
  },
  "envios": [
    {
      "indice": 0,
      "origen": "SKBO",
      "destino": "EBCI",
      "maletas": 3,
      "registro_utc": 1752624000,
      "deadline_utc": 1753228800,
      "estado": "Exitoso",
      "tramos": [
        { "vuelo_idx": 42, "desde": "SKBO", "hasta": "SBBR", "salida_utc": 1752640000, "llegada_utc": 1752700000 },
        { "vuelo_idx": 187, "desde": "SBBR", "hasta": "EBCI", "salida_utc": 1752720000, "llegada_utc": 1752800000 }
      ]
    }
  ]
}
```

### `GET /api/health`

```json
{ "status": "ok", "service": "planificador-gvns" }
```

---

## 4. Criterios disponibles

| Criterio | Descripción |
|----------|-------------|
| `EDF`      | Earliest Deadline First — minimiza incumplimientos (recomendado) |
| `FIFO`     | First In First Out |
| `ALEATORIO`| Orden aleatorio (útil para experimentación) |

---

## 5. Estructura

```
planificador/
├── src/
│   └── pe/edu/pucp/tasf/
│       ├── gvns/
│       │   ├── PlanificadorGVNSConcurrente.java
│       │   ├── PlanificadorService.java    ← fachada principal
│       │   ├── GestorDatos.java            ← carga archivos .txt
│       │   ├── ResultadoPlanificacion.java
│       │   ├── EnvioAsignado.java
│       │   ├── CriterioOrden.java
│       │   └── AuditorRutas.java
│       └── web/
│           ├── PlanificadorController.java ← API REST Spring Boot
│           ├── PlanificadorProperties.java
│           └── JobStore.java               ← registro async de jobs
├── resources/
│   └── application.properties
├── pom.xml
├── start.bat
└── PLANIFICADOR.md
```

---

## 6. Levantar en desarrollo

Primero compilar (sólo la primera vez o tras cambios):
```bat
cd backend\planificador
mvn clean package -DskipTests
```

Luego ejecutar:
```bat
start.bat
```

O manualmente:
```bat
set PLANIFICADOR_RUTA_AEROPUERTOS=C:\tmp\tasf\aeropuertos.txt
set PLANIFICADOR_RUTA_VUELOS=C:\tmp\tasf\vuelos.txt
set PLANIFICADOR_RUTA_ENVIOS=C:\tmp\tasf
set PLANIFICADOR_FECHA_INICIO=20260102
set PLANIFICADOR_CRITERIO=EDF
java -Xmx4g -jar target\planificador-gvns-1.0.0.jar
```

---

## 7. Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `PLANIFICADOR_RUTA_AEROPUERTOS` | `/tmp/tasf/aeropuertos.txt` | Ruta del archivo de aeropuertos |
| `PLANIFICADOR_RUTA_VUELOS` | `/tmp/tasf/vuelos.txt` | Ruta del archivo de vuelos |
| `PLANIFICADOR_RUTA_ENVIOS` | `/tmp/tasf` | Directorio con archivos `_envios_*.txt` |
| `PLANIFICADOR_FECHA_INICIO` | `20260101` | Fecha de inicio del dataset (YYYYMMDD) |
| `PLANIFICADOR_CRITERIO` | `EDF` | Criterio por defecto |

---

## 8. Notas de rendimiento

- **Warm-up:** Procesa días desde `PLANIFICADOR_FECHA_INICIO` hasta `fechaInicio` (greedy, sin GVNS). Con dataset completo (~9.5M) puede tardar varios minutos.
- **Plan real (7 días):** GVNS sobre los envíos del periodo → típicamente 1-5 min con `-Xmx4g`.
- **Total estimado:** La barra de progreso del frontend refleja el progreso real del job.

---

## 9. TODOs pendientes

- [ ] Re-planificación por cancelación de vuelos
- [ ] Experimentación ALNS vs GVNS (endpoints de comparación numérica)
