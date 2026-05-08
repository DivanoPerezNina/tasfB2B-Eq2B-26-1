#!/bin/bash
# Detiene todos los servicios de TASF.B2B
BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$BASE_DIR/logs"

echo "================================================"
echo "  TASF.B2B — Deteniendo servicios"
echo "================================================"

for SERVICE in planificador bff carga-masiva ejecutor; do
  PID_FILE="$LOG_DIR/$SERVICE.pid"
  if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
      kill "$PID"
      echo "[$SERVICE] detenido (PID $PID)"
    else
      echo "[$SERVICE] ya estaba detenido"
    fi
    rm -f "$PID_FILE"
  else
    echo "[$SERVICE] sin PID registrado — omitiendo"
  fi
done

echo "Listo."
