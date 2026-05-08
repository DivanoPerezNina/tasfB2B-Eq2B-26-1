#!/bin/bash
# Compila todos los componentes de TASF.B2B listos para deploy en Ubuntu 24 LTS.
# Ejecutar desde Windows (Git Bash, WSL) o Linux/Mac.
# Requisitos en tu máquina: pnpm, Java 17+, Maven 3.9+, Go 1.22+
set -e

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "================================================"
echo "  TASF.B2B — Build completo (target: Linux x86-64)"
echo "================================================"

# ── 1. Frontend ───────────────────────────────────────────────────────────────
echo ""
echo "[1/5] Frontend (React + Vite)..."
cd "$BASE_DIR/Frontend"
pnpm install --frozen-lockfile
pnpm build
echo "      OK → Frontend/dist/"

# ── 2. Planificador Java ──────────────────────────────────────────────────────
echo ""
echo "[2/5] Planificador (Java Spring Boot)..."
cd "$BASE_DIR/backend/planificador"
mvn package -q -DskipTests
echo "      OK → backend/planificador/target/planificador-gvns-1.0.0.jar"

# ── 3. BFF ────────────────────────────────────────────────────────────────────
echo ""
echo "[3/5] BFF (Go)..."
cd "$BASE_DIR/backend/bff"
mkdir -p bin
GOOS=linux GOARCH=amd64 go build -o bin/bff ./cmd/bff
echo "      OK → backend/bff/bin/bff"

# ── 4. Carga Masiva ───────────────────────────────────────────────────────────
echo ""
echo "[4/5] Carga Masiva (Go)..."
cd "$BASE_DIR/backend/carga-masiva"
mkdir -p bin
GOOS=linux GOARCH=amd64 go build -o bin/carga-masiva ./cmd/carga-masiva
echo "      OK → backend/carga-masiva/bin/carga-masiva"

# ── 5. Ejecutor ───────────────────────────────────────────────────────────────
echo ""
echo "[5/5] Ejecutor (Go)..."
cd "$BASE_DIR/backend/ejecutor"
mkdir -p bin
GOOS=linux GOARCH=amd64 go build -o bin/ejecutor ./cmd/ejecutor
echo "      OK → backend/ejecutor/bin/ejecutor"

# ── Instrucciones de deploy ───────────────────────────────────────────────────
echo ""
echo "================================================"
echo "  Build completado. Pasos para deploy en VM:"
echo "================================================"
echo ""
echo "  1. Empaquetar (desde la raíz del repo):"
echo "     zip -r tasfB2B-deploy.zip . \\"
echo "       -x '*.git*' \\"
echo "       -x '*/node_modules/*' \\"
echo "       -x 'backend/planificador/datos/_envios_preliminar_/*'"
echo ""
echo "  2. Subir a la VM:"
echo "     scp tasfB2B-deploy.zip usuario@<ip-vm>:/opt/"
echo ""
echo "  3. En la VM:"
echo "     cd /opt && unzip tasfB2B-deploy.zip -d tasfb2b"
echo "     cd tasfb2b && chmod +x scripts/*.sh"
echo "     ./scripts/start-all.sh"
echo ""
