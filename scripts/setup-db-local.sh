#!/bin/bash
# ============================================================================
#  setup-db-local.sh — Crea la BD MySQL LOCAL en la VM e ingesta TODO el dataset
#  usando el componente de carga masiva (que ahora precalcula registro_utc).
#
#  Requisitos previos (los haces tú):
#    - MySQL server corriendo en la VM y accesible.
#    - Un usuario MySQL con permisos (root u otro). Define DB_USER/DB_PASS abajo.
#    - Go instalado (para compilar carga-masiva).
#
#  Uso:
#    cd /opt/tasfb2b
#    DB_PASS='tu_clave_mysql' ./scripts/setup-db-local.sh
#
#  Variables (override por entorno):
#    DB_HOST (127.0.0.1)  DB_PORT (3306)  DB_USER (root)  DB_PASS (vacío)
#    DB_NAME (tasfb2b)    CARGA_PORT (18082)   TEMP_DIR (/tmp/tasf)
#    DATOS  → carpeta con aeropuertos.txt, vuelos.txt y _envios_preliminar_/
#             OJO: los _envios_*.txt NO están en git (.gitignore — datos pesados).
#             Apunta DATOS a donde los subiste en la VM (Drive/scp).
#             Default: <repo>/backend/planificador/datos
# ============================================================================
set -euo pipefail

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_PASS="${DB_PASS:-}"
DB_NAME="${DB_NAME:-tasfb2b}"
CARGA_PORT="${CARGA_PORT:-18082}"   # puerto temporal (no choca con el systemd :8082)
TEMP_DIR="${TEMP_DIR:-/tmp/tasf}"

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DATOS="${DATOS:-$REPO/backend/planificador/datos}"
SCHEMA="$REPO/backend/db/schema.sql"
CARGA_URL="http://127.0.0.1:${CARGA_PORT}"

# mysql con o sin password
MYSQL=(mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER")
[ -n "$DB_PASS" ] && MYSQL+=(-p"$DB_PASS")

echo "================================================"
echo "  TASF.B2B — Crear BD local + ingesta completa"
echo "  Repo:   $REPO"
echo "  Datos:  $DATOS"
echo "  MySQL:  $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME"
echo "================================================"

# ── 0. Comprobaciones ────────────────────────────────────────────────────────
[ -f "$SCHEMA" ] || { echo "ERROR: no existe $SCHEMA"; exit 1; }
[ -d "$DATOS" ]  || { echo "ERROR: no existe $DATOS"; exit 1; }
command -v go >/dev/null    || { echo "ERROR: go no está instalado"; exit 1; }
command -v mysql >/dev/null || { echo "ERROR: cliente mysql no está instalado"; exit 1; }

# ── 1. Crear schema (incluye CREATE DATABASE + columnas registro_utc) ─────────
echo ""
echo "[1/5] Creando schema en MySQL..."
"${MYSQL[@]}" < "$SCHEMA"
echo "      OK"

# ── 2. Compilar y arrancar carga-masiva apuntando a la BD LOCAL ───────────────
echo ""
echo "[2/5] Arrancando carga-masiva (temporal, puerto $CARGA_PORT, BD local)..."
cd "$REPO/backend/carga-masiva"
go build -o /tmp/carga-masiva ./cmd/carga-masiva

DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" DB_NAME="$DB_NAME" \
DB_USER="$DB_USER" DB_PASS="$DB_PASS" \
PORT="$CARGA_PORT" TEMP_DIR="$TEMP_DIR" MAX_UPLOAD_MB=50 \
  /tmp/carga-masiva &
CARGA_PID=$!
trap 'kill $CARGA_PID 2>/dev/null || true' EXIT

# Esperar a que levante
for i in $(seq 1 30); do
  sleep 1
  if curl -fs "$CARGA_URL/health" >/dev/null 2>&1; then break; fi
  if [ "$i" = "30" ]; then echo "ERROR: carga-masiva no levantó"; exit 1; fi
done
echo "      OK (pid $CARGA_PID)"

# ── Helper: subir un archivo y esperar a que termine la sesión ────────────────
subir_y_esperar() {
  local endpoint="$1" archivo="$2" extra="${3:-}"
  local resp token estado
  resp=$(curl -fs -F "archivo=@${archivo}" "${CARGA_URL}${endpoint}${extra}") || {
    echo "      ERROR subiendo $(basename "$archivo")"; return 1; }
  token=$(echo "$resp" | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ -z "$token" ]; then echo "      (sin token) resp: $resp"; return 1; fi
  # Polling de la sesión hasta ok/error
  while true; do
    sleep 1
    s=$(curl -fs "${CARGA_URL}/upload/sesion/${token}")
    estado=$(echo "$s" | grep -o '"estado":"[^"]*"' | head -1 | cut -d'"' -f4)
    case "$estado" in
      ok)    echo "      ✓ $(basename "$archivo")  $(echo "$s" | grep -o '"registros_ok":[0-9]*' | cut -d: -f2) filas"; return 0 ;;
      error) echo "      ✗ $(basename "$archivo"): $s"; return 1 ;;
    esac
  done
}

# ── 3. Aeropuertos (primero: vuelos y envíos dependen de él) ──────────────────
echo ""
echo "[3/5] Ingesta de aeropuertos..."
subir_y_esperar "/upload/aeropuertos" "$DATOS/aeropuertos.txt" "?forzar=true"

# ── 4. Vuelos ─────────────────────────────────────────────────────────────────
echo ""
echo "[4/5] Ingesta de vuelos..."
subir_y_esperar "/upload/vuelos" "$DATOS/vuelos.txt" "?forzar=true"

# ── 5. Envíos (todos los _envios_*.txt, secuencial) ───────────────────────────
echo ""
echo "[5/5] Ingesta de envíos (precalculando registro_utc)..."
shopt -s nullglob
archivos=("$DATOS"/_envios_preliminar_/_envios_*.txt)
total=${#archivos[@]}
if [ "$total" = "0" ]; then
  echo "  ✗ No se encontraron _envios_*.txt en $DATOS/_envios_preliminar_/"
  echo "    Esos archivos NO vienen por git (.gitignore). Súbelos a la VM y"
  echo "    re-ejecuta con:  DATOS=/ruta/a/tus/datos DB_PASS=... ./scripts/setup-db-local.sh"
  exit 1
fi
i=0
for f in "${archivos[@]}"; do
  i=$((i+1))
  printf "  [%2d/%2d] %s ... " "$i" "$total" "$(basename "$f")"
  subir_y_esperar "/upload/envios" "$f" || true
done

# ── Recalcular metadatos del dataset (fecha_min/max/total) ────────────────────
echo ""
echo "Recalculando metadatos del dataset..."
curl -fs -X POST "$CARGA_URL/dataset/recalcular" >/dev/null && echo "  OK" || echo "  (omitido)"

echo ""
echo "================================================"
echo "  ✅ BD local lista en $DB_HOST:$DB_PORT/$DB_NAME"
echo "  Verifica:  mysql -u $DB_USER -p -e 'SELECT COUNT(*) FROM ${DB_NAME}.envios; SELECT MIN(registro_utc),MAX(registro_utc) FROM ${DB_NAME}.envios;'"
echo "================================================"
echo ""
echo "  Para que los servicios usen esta BD local, apunta sus variables"
echo "  DB_HOST=127.0.0.1 (en sus units systemd) y reinícialos."
