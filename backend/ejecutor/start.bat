@echo off
set PORT=8083
set PLANIFICADOR_URL=http://localhost:8084
set TICK_INTERVAL_MS=1000
set SSE_MAX_CLIENTES=50
echo Iniciando Ejecutor en :8083 → Planificador en :8084
go run ./cmd/ejecutor/main.go
