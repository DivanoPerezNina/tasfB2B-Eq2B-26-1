# Ejecutor

**Lenguaje:** Go  
**Puerto:** 8083  
**Estado:** Por implementar

## Responsabilidad

Recibe el plan de rutas generado por el Planificador y lo ejecuta simulando el paso del tiempo. Es el motor de la simulación en ejecución.

### Funciones principales

1. **Tick engine**: avanza el reloj simulado según la velocidad configurada (ej. 1 minuto real = X minutos simulados)
2. **Estado en memoria**: mantiene el estado actual de cada envío (en origen, en vuelo, en escala, entregado, demorado)
3. **SSE al frontend**: emite eventos en tiempo real con los cambios de estado para que el mapa se actualice
4. **Cancelaciones** *(futuro)*: detecta bloqueo de aeropuerto o ruta → notifica al Planificador → recibe nuevo plan → continúa simulación

### Endpoint SSE

```
GET /api/simulacion/eventos
Content-Type: text/event-stream

// El frontend se suscribe aquí y recibe eventos como:
data: {"tipo":"envio_actualizado","id":"E001","estado":"en_vuelo","vuelo":"V042"}
data: {"tipo":"tick","tiempoSimulado":"2026-08-19T14:30:00Z","dia":2}
data: {"tipo":"metrica","ocupacion":{"SKBO":0.72,"LATI":0.45,...}}
```

## Estructura prevista

```
ejecutor/
├── cmd/
│   └── ejecutor/
│       └── main.go
├── internal/
│   ├── handler/        # HTTP handlers: recibir plan, iniciar/pausar/detener
│   ├── simulacion/     # Tick engine, estado en memoria
│   ├── sse/            # Broadcaster SSE a clientes conectados
│   └── client/         # Cliente HTTP hacia el Planificador (re-planificación)
├── go.mod
└── README.md
```

## Correr en desarrollo

```bash
go run ./cmd/ejecutor
```

## Compilar para VM

```bash
GOOS=linux GOARCH=amd64 go build -o bin/ejecutor ./cmd/ejecutor
```
