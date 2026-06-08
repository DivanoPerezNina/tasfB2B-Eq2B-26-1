#!/bin/bash
# start-linux.sh — Build completo + arranque de servicios en la VM Linux.
# Flujo: git pull → build → restart systemd
# Uso: cd /opt/tasfb2b && ./scripts/start-linux.sh
set -e

# Forzar Java 21 para Maven (el mvn de apt puede apuntar a otra JVM)
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export PATH="$JAVA_HOME/bin:$PATH"

REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$REPO/logs"
mkdir -p "$LOG_DIR"

echo "================================================"
echo "  TASF.B2B — Deploy Linux"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "================================================"

# ── 1. git pull ───────────────────────────────────────────────────────────────
echo ""
echo "[1/5] git pull..."
cd "$REPO"
git pull
echo "      OK — rama: $(git branch --show-current) @ $(git log -1 --format='%h %s')"

# ── 1.5 Apuntar a la BD LOCAL de la VM ────────────────────────────────────────
# Forzamos el host/puerto/nombre de la BD local en el .env (idempotente). Las
# credenciales DB_USER/DB_PASS NO se tocan aquí (son secretos): déjalas puestas
# en el .env apuntando a un usuario de la BD MySQL local.
ENV_FILE="$REPO/.env"
ensure_env() {
  local key="$1" val="$2"
  touch "$ENV_FILE"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}
echo ""
echo "[1.5] Apuntando servicios a la BD local (127.0.0.1)..."
ensure_env DB_HOST 127.0.0.1
ensure_env DB_PORT 3306
ensure_env DB_NAME tasfb2b
if ! grep -q "^DB_USER=" "$ENV_FILE" || ! grep -q "^DB_PASS=" "$ENV_FILE"; then
  echo "      ⚠ Falta DB_USER/DB_PASS en $ENV_FILE — añádelos (usuario de la BD local)."
fi
echo "      OK ($ENV_FILE → DB_HOST=127.0.0.1)"

# ── 2. Frontend ───────────────────────────────────────────────────────────────
echo ""
echo "[2/5] Frontend (npm build)..."
cd "$REPO/Frontend"
npm install --silent
npm run build
echo "      OK → Frontend/dist/"

# ── 3. Planificador Java ──────────────────────────────────────────────────────
echo ""
echo "[3/5] Planificador (mvn package)..."
cd "$REPO/backend/planificador"
mvn package -q -DskipTests
echo "      OK → target/planificador-gvns-1.0.0.jar"

# ── 4. Servicios Go ───────────────────────────────────────────────────────────
echo ""
echo "[4/5] Servicios Go (build nativo Linux)..."
for SVC in bff carga-masiva ejecutor; do
  cd "$REPO/backend/$SVC"
  mkdir -p bin
  go build -o bin/$SVC ./cmd/$SVC
  echo "      OK → backend/$SVC/bin/$SVC"
done

# ── 5. Reiniciar servicios systemd ────────────────────────────────────────────
echo ""
echo "[5/5] Reiniciando servicios..."
sudo systemctl restart tasfb2b-planificador tasfb2b-bff tasfb2b-ejecutor tasfb2b-carga-masiva
sleep 4

echo ""
echo "================================================"
echo "  Estado de servicios:"
systemctl is-active tasfb2b-planificador tasfb2b-bff tasfb2b-ejecutor tasfb2b-carga-masiva \
  | paste - - - - | awk '{print "  planificador="$1" bff="$2" ejecutor="$3" carga="$4}'
echo ""
echo "  Frontend: http://$(hostname -I | awk '{print $1}')"
echo "  Health:   http://$(hostname -I | awk '{print $1}')/api/health"
echo ""
echo "  Logs: tail -f $LOG_DIR/<servicio>.log"
echo "================================================"
