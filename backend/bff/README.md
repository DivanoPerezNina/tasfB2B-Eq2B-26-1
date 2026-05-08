# BFF — API Gateway

**Lenguaje:** Go  
**Puerto:** 8081  
**Estado:** Por implementar

## Responsabilidad

Punto de entrada único del frontend. Recibe todas las peticiones HTTP del navegador y las enruta al servicio interno correspondiente:

| Ruta entrante | Destino |
|---|---|
| `POST /api/carga/...` | Carga Masiva :8082 |
| `POST /api/simulacion/planificar` | Planificador :8080 |
| `POST /api/simulacion/ejecutar` | Ejecutor :8083 |
| `GET  /api/simulacion/estado` | Ejecutor :8083 |

También es responsable de adaptar los contratos si el frontend y los servicios internos hablan formatos distintos.

## Estructura prevista

```
bff/
├── cmd/
│   └── bff/
│       └── main.go
├── internal/
│   ├── handler/    # HTTP handlers por recurso
│   └── client/     # Clientes HTTP hacia los otros servicios
├── go.mod
└── README.md
```

## Correr en desarrollo

```bash
go run ./cmd/bff
```

## Compilar para VM

```bash
GOOS=linux GOARCH=amd64 go build -o bin/bff ./cmd/bff
```
