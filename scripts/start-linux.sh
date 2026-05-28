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
