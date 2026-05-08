#!/bin/bash
# Levanta todos los servicios de TASF.B2B en la VM Ubuntu 24 LTS
set -e

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$BASE_DIR/logs"
mkdir -p "$LOG_DIR"

echo "================================================"
echo "  TASF.B2B — Iniciando servicios"
echo "================================================"

# ── 1. Planificador (Java Spring Boot) ───────────────────────────────────────
echo "[1/4] Planificador Java..."
JAR="$BASE_DIR/backend/planificador/target/planificador-gvns-1.0.0.jar"
if [ ! -f "$JAR" ]; then
  echo "      ERROR: JAR no encontrado en $JAR"
  echo "      Ejecuta ./scripts/build-all.sh primero."
  exit 1
fi
java -jar "$JAR" --server.port=8080 \
  > "$LOG_DIR/planificador.log" 2>&1 &
echo $! > "$LOG_DIR/planificador.pid"
echo "      PID $(cat $LOG_DIR/planificador.pid) — log: logs/planificador.log"

# ── 2. BFF ────────────────────────────────────────────────────────────────────
echo "[2/4] BFF (Go)..."
BFF="$BASE_DIR/backend/bff/bin/bff"
if [ ! -f "$BFF" ]; then
  echo "      ERROR: binario no encontrado en $BFF"
  exit 1
fi
"$BFF" > "$LOG_DIR/bff.log" 2>&1 &
echo $! > "$LOG_DIR/bff.pid"
echo "      PID $(cat $LOG_DIR/bff.pid) — log: logs/bff.log"

# ── 3. Carga Masiva ───────────────────────────────────────────────────────────
echo "[3/4] Carga Masiva (Go)..."
CARGA="$BASE_DIR/backend/carga-masiva/bin/carga-masiva"
if [ ! -f "$CARGA" ]; then
  echo "      ERROR: binario no encontrado en $CARGA"
  exit 1
fi
"$CARGA" > "$LOG_DIR/carga-masiva.log" 2>&1 &
echo $! > "$LOG_DIR/carga-masiva.pid"
echo "      PID $(cat $LOG_DIR/carga-masiva.pid) — log: logs/carga-masiva.log"

# ── 4. Ejecutor ───────────────────────────────────────────────────────────────
echo "[4/4] Ejecutor (Go)..."
EJECUTOR="$BASE_DIR/backend/ejecutor/bin/ejecutor"
if [ ! -f "$EJECUTOR" ]; then
  echo "      ERROR: binario no encontrado en $EJECUTOR"
  exit 1
fi
"$EJECUTOR" > "$LOG_DIR/ejecutor.log" 2>&1 &
echo $! > "$LOG_DIR/ejecutor.pid"
echo "      PID $(cat $LOG_DIR/ejecutor.pid) — log: logs/ejecutor.log"

echo ""
echo "Todos los servicios iniciados."
echo "  Planificador : http://localhost:8080"
echo "  BFF          : http://localhost:8081"
echo "  Carga Masiva : http://localhost:8082"
echo "  Ejecutor     : http://localhost:8083"
echo ""
echo "Para detener: ./scripts/stop-all.sh"
