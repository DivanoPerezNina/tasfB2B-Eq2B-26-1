#!/bin/bash
# Levanta todos los servicios de TASF.B2B en Ubuntu 24 LTS
# Uso: ./scripts/start-all.sh
set -e

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$BASE_DIR/logs"
mkdir -p "$LOG_DIR"

# ── Cargar variables de entorno desde .env si existe (opcional) ───────────────
ENV_FILE="$BASE_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi
# Las credenciales de BD y URLs están hardcodeadas como defaults en el código;
# el .env solo es necesario si quieres sobreescribir algún valor.

echo "================================================"
echo "  TASF.B2B — Iniciando servicios"
echo "================================================"

# ── 1. Planificador (Java Spring Boot, puerto 8084) ───────────────────────────
echo "[1/4] Planificador Java (puerto 8084)..."
JAR="$BASE_DIR/backend/planificador/target/planificador-gvns-1.0.0.jar"
if [ ! -f "$JAR" ]; then
  echo "      ERROR: JAR no encontrado → $JAR"
  echo "      Ejecuta ./scripts/build-all.sh primero."
  exit 1
fi
# application.properties ya define server.port=8084; NO sobreescribir con 8080
# (Tomcat del sistema ocupa 8080)
java -jar "$JAR" \
  > "$LOG_DIR/planificador.log" 2>&1 &
echo $! > "$LOG_DIR/planificador.pid"
echo "      PID $(cat "$LOG_DIR/planificador.pid") — log: logs/planificador.log"

# ── 2. BFF (Go, puerto 8081) ──────────────────────────────────────────────────
echo "[2/4] BFF (puerto 8081)..."
BFF_BIN="$BASE_DIR/backend/bff/bin/bff"
if [ ! -f "$BFF_BIN" ]; then
  echo "      ERROR: binario no encontrado → $BFF_BIN"
  exit 1
fi
"$BFF_BIN" > "$LOG_DIR/bff.log" 2>&1 &
echo $! > "$LOG_DIR/bff.pid"
echo "      PID $(cat "$LOG_DIR/bff.pid") — log: logs/bff.log"

# ── 3. Carga Masiva (Go, puerto 8082) ─────────────────────────────────────────
echo "[3/4] Carga Masiva (puerto 8082)..."
CARGA_BIN="$BASE_DIR/backend/carga-masiva/bin/carga-masiva"
if [ ! -f "$CARGA_BIN" ]; then
  echo "      ERROR: binario no encontrado → $CARGA_BIN"
  exit 1
fi
"$CARGA_BIN" > "$LOG_DIR/carga-masiva.log" 2>&1 &
echo $! > "$LOG_DIR/carga-masiva.pid"
echo "      PID $(cat "$LOG_DIR/carga-masiva.pid") — log: logs/carga-masiva.log"

# ── 4. Ejecutor (Go, puerto 8083) ─────────────────────────────────────────────
echo "[4/4] Ejecutor (puerto 8083)..."
EJECUTOR_BIN="$BASE_DIR/backend/ejecutor/bin/ejecutor"
if [ ! -f "$EJECUTOR_BIN" ]; then
  echo "      ERROR: binario no encontrado → $EJECUTOR_BIN"
  exit 1
fi
"$EJECUTOR_BIN" > "$LOG_DIR/ejecutor.log" 2>&1 &
echo $! > "$LOG_DIR/ejecutor.pid"
echo "      PID $(cat "$LOG_DIR/ejecutor.pid") — log: logs/ejecutor.log"

echo ""
echo "Todos los servicios iniciados."
echo "  Planificador : http://localhost:8084"
echo "  BFF          : http://localhost:8081"
echo "  Carga Masiva : http://localhost:8082"
echo "  Ejecutor     : http://localhost:8083"
echo ""
echo "  Frontend     : http://$(hostname -I | awk '{print $1}') (via nginx)"
echo ""
echo "Para detener: ./scripts/stop-all.sh"
echo "Para ver logs: tail -f logs/<servicio>.log"
