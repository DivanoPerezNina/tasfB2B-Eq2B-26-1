# Carga Masiva

**Lenguaje:** Go  
**Puerto:** 8082  
**Estado:** Por implementar

## Responsabilidad

Recibe los archivos `.txt` subidos por el usuario desde la pantalla de Configuración y los ingesta en MySQL. Debe manejar el volumen total del dataset: hasta **9.5 millones de registros** distribuidos en 30 archivos de envíos.

### Archivos que recibe

| Archivo | Descripción |
|---|---|
| `aeropuertos.txt` | 30 aeropuertos con IATA, continente, GMT, capacidad |
| `vuelos.txt` | Planes de vuelo con origen, destino, salida UTC, llegada UTC, capacidad |
| `_envios_XXXX_.txt` × 30 | Envíos por aeropuerto origen (hasta ~450k registros c/u) |

### Estrategia de carga

- Inserción por lotes (batch insert) para no saturar MySQL
- Lectura en streaming línea por línea — nunca cargar el archivo completo en memoria
- Reporte de progreso: porcentaje completado para mostrarlo en el frontend

## Estructura prevista

```
carga-masiva/
├── cmd/
│   └── carga-masiva/
│       └── main.go
├── internal/
│   ├── handler/    # HTTP handler: recibe multipart/form-data
│   ├── parser/     # Parsers de cada formato de archivo .txt
│   └── db/         # Inserción batch en MySQL
├── go.mod
└── README.md
```

## Correr en desarrollo

```bash
go run ./cmd/carga-masiva
```

## Compilar para VM

```bash
GOOS=linux GOARCH=amd64 go build -o bin/carga-masiva ./cmd/carga-masiva
```
