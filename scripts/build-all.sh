#!/bin/bash
# Compila todos los componentes de TASF.B2B listos para deploy en Ubuntu 24 LTS.
# Ejecutar desde Windows (Git Bash/WSL) o Linux/Mac.
# Requisitos locales: npm/pnpm, Java 17+, Maven 3.9+, Go 1.22+
set -e

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "================================================"
echo "  TASF.B2B — Build completo (target: Linux x86-64)"
echo "================================================"

# ── 1. Frontend (React + Vite) ────────────────────────────────────────────────
echo ""
echo "[1/5] Frontend (React + Vite)..."
cd "$BASE_DIR/Frontend"
# Usar pnpm si está disponible, sino npm
if command -v pnpm &>/dev/null; then
  pnpm install --frozen-lockfile
  pnpm build
else
  npm install
  npm run build
fi
echo "      OK → Frontend/dist/"

# ── 2. Planificador Java ──────────────────────────────────────────────────────
echo ""
echo "[2/5] Planificador (Java Spring Boot)..."
cd "$BASE_DIR/backend/planificador"
mvn package -q -DskipTests
echo "      OK → backend/planificador/target/planificador-gvns-1.0.0.jar"

# ── 3. BFF ────────────────────────────────────────────────────────────────────
echo ""
echo "[3/5] BFF (Go → linux/amd64)..."
cd "$BASE_DIR/backend/bff"
mkdir -p bin
GOOS=linux GOARCH=amd64 go build -o bin/bff ./cmd/bff
echo "      OK → backend/bff/bin/bff"

# ── 4. Carga Masiva ───────────────────────────────────────────────────────────
echo ""
echo "[4/5] Carga Masiva (Go → linux/amd64)..."
cd "$BASE_DIR/backend/carga-masiva"
mkdir -p bin
GOOS=linux GOARCH=amd64 go build -o bin/carga-masiva ./cmd/carga-masiva
echo "      OK → backend/carga-masiva/bin/carga-masiva"

# ── 5. Ejecutor ───────────────────────────────────────────────────────────────
echo ""
echo "[5/5] Ejecutor (Go → linux/amd64)..."
cd "$BASE_DIR/backend/ejecutor"
mkdir -p bin
GOOS=linux GOARCH=amd64 go build -o bin/ejecutor ./cmd/ejecutor
echo "      OK → backend/ejecutor/bin/ejecutor"

echo ""
echo "================================================"
echo "  Build completado."
echo "================================================"
echo ""
echo "  Siguiente paso: ./scripts/deploy-vm.sh"
echo ""
