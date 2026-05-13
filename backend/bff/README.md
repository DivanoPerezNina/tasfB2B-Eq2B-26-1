# BFF — API Gateway

**Lenguaje:** Go  
**Puerto:** 8081  
**Estado:** ✅ Implementado y operativo

## Responsabilidad

Punto de entrada único del frontend. Recibe todas las peticiones HTTP del navegador y las enruta al servicio interno correspondiente. También sirve directamente los datos de aeropuertos, vuelos y dataset desde MySQL.

## Endpoints de orquestación — Simulación de Periodo

El BFF expone 3 rutas que orquestan el flujo completo. El usuario pasa **todos los parámetros una sola vez**:

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/periodo/iniciar` | Recibe todos los parámetros, llama al Planificador, guarda `duracion_real_min` |
| `GET`  | `/api/periodo/status/{jobId}` | Polling de progreso (0-100%) |
| `POST` | `/api/periodo/ejecutar/{jobId}` | Inicia simulación usando la duración guardada |

### Body de `/api/periodo/iniciar`

```json
{
  "fechaInicio":       "2026-01-15",
  "dias":              7,
  "criterio":          "EDF",
  "semilla":           42,
  "duracion_real_min": 60,
  "umbrales": { "verde_hasta": 0.60, "ambar_hasta": 0.85 }
}
```

Responde con `job_id` + `velocidad_efectiva` calculada.

---

## Endpoints propios (lee MySQL directamente)

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET`  | `/api/aeropuertos` | Lista de 30 aeropuertos con coordenadas |
| `GET`  | `/api/vuelos`      | Lista de 2866 vuelos |
| `GET`  | `/api/dataset`     | Rango de fechas del dataset (fecha_min, fecha_max, total_envios) |
| `GET`  | `/api/health`      | Estado de todos los servicios |

## Rutas proxy

| Ruta entrante | Destino | Nota |
|---|---|---|
| `/api/carga/*` | Carga Masiva :8082 | Quita prefijo `/api/carga` |
| `/api/planificacion/*` | Planificador :8084 | Sin cambio de path |
| `/api/simulacion/eventos` | Ejecutor :8083 (SSE) | Streaming con flusher |
| `/api/simulacion/*` | Ejecutor :8083 | Sin cambio de path |

## Estructura

```
bff/
├── cmd/bff/main.go              # Entry point, mux, CORS middleware
├── internal/
│   ├── config/config.go         # Vars de entorno
│   ├── db/db.go                 # Conexión MySQL
│   └── handler/
│       ├── dominio.go           # Aeropuertos, vuelos, dataset
│       ├── health.go            # Health check multi-servicio
│       └── proxy.go             # NuevoProxy + NuevoProxySSE + helpers JSON
├── go.mod
├── start.bat                    # Variables de entorno + go run
└── README.md
```

## Levantar en desarrollo

```bat
cd backend\bff
start.bat
```

O manualmente:
```bat
set PORT=8081
set DB_HOST=tasfb2b-db.cpll0i02mkbl.us-east-1.rds.amazonaws.com
set DB_PORT=3306
set DB_NAME=tasfb2b
set DB_USER=admin
set DB_PASS=12345678
set CARGA_MASIVA_URL=http://localhost:8082
set PLANIFICADOR_URL=http://localhost:8084
set EJECUTOR_URL=http://localhost:8083
set CORS_ORIGIN=*
go run ./cmd/bff/main.go
```

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `PORT` | `8081` | Puerto del servicio |
| `DB_HOST` | — | Host MySQL (RDS) |
| `DB_PORT` | `3306` | Puerto MySQL |
| `DB_NAME` | `tasfb2b` | Base de datos |
| `DB_USER` | — | Usuario MySQL |
| `DB_PASS` | — | Contraseña MySQL |
| `CARGA_MASIVA_URL` | `http://localhost:8082` | URL Carga Masiva |
| `PLANIFICADOR_URL` | `http://localhost:8084` | URL Planificador |
| `EJECUTOR_URL`     | `http://localhost:8083` | URL Ejecutor |
| `CORS_ORIGIN`      | `*` | Origen CORS permitido |

## Verificar funcionamiento

```bash
curl http://localhost:8081/api/health
# {"success":true,"data":{"bff":"ok","carga_masiva":"ok","ejecutor":"ok","mysql":"ok","planificador":"ok"}}
```
