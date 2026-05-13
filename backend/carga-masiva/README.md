# Carga Masiva

**Lenguaje:** Go  
**Puerto:** 8082  
**Estado:** ✅ Implementado y operativo

## Responsabilidad

Recibe los archivos `.txt` subidos por el usuario desde la pantalla de Configuración y los ingesta en MySQL. Maneja el volumen total del dataset: **9,519,995 registros** distribuidos en 30 archivos de envíos.

## Archivos que acepta

| Archivo | Descripción |
|---|---|
| `aeropuertos.txt` | 30 aeropuertos (UTF-16 BE, coordenadas DMS, formato propietario) |
| `vuelos.txt` | 2866 vuelos (origen, destino, salida/llegada UTC, capacidad) |
| `_envios_XXXX_.txt` × 30 | Envíos por aeropuerto origen (≈316k registros c/u) |

## API REST

### Base URL: `http://localhost:8082`

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/upload/aeropuertos` | Sube `aeropuertos.txt` (multipart, campo `archivo`) |
| `POST` | `/upload/vuelos` | Sube `vuelos.txt` |
| `POST` | `/upload/envios` | Sube un archivo `_envios_XXXX_.txt` |
| `GET`  | `/estado` | Estado actual: aeropuertos, vuelos, envíos por aeropuerto |
| `POST` | `/dataset/recalcular` | Recalcula y guarda fecha_min/max en `dataset_meta` |
| `GET`  | `/sesiones` | Historial de cargas con token de seguimiento |
| `GET`  | `/sesion/{token}` | Estado de una carga específica |

### Ejemplo: subir envíos

```bash
curl -X POST http://localhost:8082/upload/envios \
     -F archivo=@C:\tmp\tasf\_envios_SKBO_.txt
```

Respuesta `202 Accepted`:
```json
{
  "archivo": "_envios_SKBO_.txt",
  "estado": "procesando",
  "origen_iata": "SKBO",
  "tipo": "envios",
  "token": "d18913de-..."
}
```

### Verificar estado general

```bash
curl http://localhost:8082/estado
```

```json
{
  "aeropuertos": 30,
  "vuelos": 2866,
  "dataset": {
    "fecha_min": "2026-01-02",
    "fecha_max": "2029-01-05",
    "total_envios": 9519995
  },
  "envios": {
    "total": 9519995,
    "por_aeropuerto": { "SKBO": 380677, "SLLP": 446729, ... }
  },
  "listo_para_simular": true
}
```

## Estrategia de carga

- Respuesta `202` inmediata; inserción en goroutine background
- Inserción por lotes de 1000 filas (batch `INSERT`)
- Lectura streaming línea a línea — nunca carga el archivo completo en memoria
- Caché de `dataset_meta` en MySQL (se recalcula con `POST /dataset/recalcular`)

## Estructura

```
carga-masiva/
├── cmd/carga-masiva/main.go
├── internal/
│   ├── config/config.go
│   ├── db/
│   │   ├── db.go                # Conexión MySQL
│   │   └── dataset.go           # ObtenerDatasetInfo / RecalcularDatasetInfo
│   ├── handler/
│   │   ├── upload.go            # Handlers de subida de archivos
│   │   └── estado.go            # GET /estado + POST /dataset/recalcular
│   └── parser/
│       ├── aeropuertos.go       # Parser UTF-16 BE, coords DMS
│       ├── vuelos.go
│       └── envios.go
├── go.mod
├── start.bat
└── README.md
```

## Levantar en desarrollo

```bat
cd backend\carga-masiva
start.bat
```

O manualmente:
```bat
set DB_HOST=tasfb2b-db.cpll0i02mkbl.us-east-1.rds.amazonaws.com
set DB_PORT=3306
set DB_NAME=tasfb2b
set DB_USER=admin
set DB_PASS=12345678
set TEMP_DIR=C:\tmp\tasf
set PORT=8082
go run ./cmd/carga-masiva/main.go
```

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `PORT` | `8082` | Puerto del servicio |
| `DB_HOST` | — | Host MySQL |
| `DB_PORT` | `3306` | Puerto MySQL |
| `DB_NAME` | `tasfb2b` | Base de datos |
| `DB_USER` | — | Usuario |
| `DB_PASS` | — | Contraseña |
| `TEMP_DIR` | `C:\tmp\tasf` | Directorio donde guarda los archivos subidos |

## Dataset actual

Los 30 archivos de envíos están cargados en MySQL:

- **Total:** 9,519,995 envíos
- **Rango:** 2026-01-02 → 2029-01-05
- **Aeropuertos:** EBCI, EDDI, EHAM, EKCH, LATI, LBSF, LDZA, LKPR, LOWW, OAKB, OERK, OJAI, OMDB, OOMS, OPKC, OSDI, OYSN, SABE, SBBR, SCEL, SEQM, SGAS, SKBO, SLLP, SPIM, SUAA, SVMI, UBBB, UMMS, VIDP
