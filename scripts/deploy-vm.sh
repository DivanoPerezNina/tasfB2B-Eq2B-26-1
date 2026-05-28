#!/bin/bash
# deploy-vm.sh — Sube los artefactos compilados a la VM y reinicia servicios.
# Ejecutar DESPUÉS de build-all.sh, desde la raíz del repo en tu máquina local.
#
# Uso:
#   ./scripts/deploy-vm.sh
#
# Primera vez: también ejecuta setup-vm.sh en la VM (configura nginx + systemd).
set -e

VM_USER="1inf54.984.2b"
VM_HOST="1inf54-984-2b.inf.pucp.edu.pe"
VM_DIR="/opt/tasfb2b"
BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "================================================"
echo "  TASF.B2B — Deploy a VM PUCP"
echo "  $VM_USER@$VM_HOST:$VM_DIR"
echo "================================================"

SSH="ssh -o StrictHostKeyChecking=accept-new $VM_USER@$VM_HOST"
SCP="scp -o StrictHostKeyChecking=accept-new"

# ── Crear directorio base en la VM si no existe ───────────────────────────────
echo "[0] Creando $VM_DIR en la VM..."
$SSH "sudo mkdir -p $VM_DIR && sudo chown $VM_USER:$VM_USER $VM_DIR"

# ── 1. Subir frontend (dist/) ─────────────────────────────────────────────────
echo "[1] Subiendo frontend..."
rsync -az --delete \
  -e "ssh -o StrictHostKeyChecking=accept-new" \
  "$BASE_DIR/Frontend/dist/" \
  "$VM_USER@$VM_HOST:$VM_DIR/Frontend/dist/"
echo "    OK"

# ── 2. Subir JAR del planificador ─────────────────────────────────────────────
echo "[2] Subiendo planificador JAR..."
$SSH "mkdir -p $VM_DIR/backend/planificador/target"
$SCP "$BASE_DIR/backend/planificador/target/planificador-gvns-1.0.0.jar" \
     "$VM_USER@$VM_HOST:$VM_DIR/backend/planificador/target/"
echo "    OK"

# ── 3. Subir datos del planificador (si no están en la VM) ────────────────────
echo "[3] Subiendo datos del planificador..."
$SSH "mkdir -p $VM_DIR/backend/planificador/datos"
# Archivos pequeños siempre
$SCP "$BASE_DIR/backend/planificador/datos/aeropuertos.txt" \
     "$VM_USER@$VM_HOST:$VM_DIR/backend/planificador/datos/"
$SCP "$BASE_DIR/backend/planificador/datos/vuelos.txt" \
     "$VM_USER@$VM_HOST:$VM_DIR/backend/planificador/datos/"
# Carpeta _envios_preliminar_ (391 MB) — solo si existe localmente
if [ -d "$BASE_DIR/backend/planificador/datos/_envios_preliminar_" ]; then
  echo "    Subiendo _envios_preliminar_ (puede tardar unos minutos)..."
  rsync -az --progress \
    -e "ssh -o StrictHostKeyChecking=accept-new" \
    "$BASE_DIR/backend/planificador/datos/_envios_preliminar_/" \
    "$VM_USER@$VM_HOST:$VM_DIR/backend/planificador/datos/_envios_preliminar_/"
else
  echo "    AVISO: _envios_preliminar_ no encontrada localmente — omitiendo."
  echo "           Si aún no está en la VM, súbela manualmente."
fi
echo "    OK"

# ── 4. Subir binarios Go ──────────────────────────────────────────────────────
echo "[4] Subiendo binarios Go..."
for SVC in bff carga-masiva ejecutor; do
  BIN="$BASE_DIR/backend/$SVC/bin/$SVC"
  if [ -f "$BIN" ]; then
    $SSH "mkdir -p $VM_DIR/backend/$SVC/bin"
    $SCP "$BIN" "$VM_USER@$VM_HOST:$VM_DIR/backend/$SVC/bin/"
    $SSH "chmod +x $VM_DIR/backend/$SVC/bin/$SVC"
    echo "    OK: $SVC"
  else
    echo "    AVISO: $BIN no encontrado — ejecuta build-all.sh"
  fi
done

# ── 5. Subir scripts ──────────────────────────────────────────────────────────
echo "[5] Subiendo scripts..."
$SSH "mkdir -p $VM_DIR/scripts"
$SCP "$BASE_DIR/scripts/start-all.sh" \
     "$BASE_DIR/scripts/stop-all.sh" \
     "$BASE_DIR/scripts/setup-vm.sh" \
     "$VM_USER@$VM_HOST:$VM_DIR/scripts/"
$SSH "chmod +x $VM_DIR/scripts/*.sh"

# ── 6. Subir .env.example si no existe .env en la VM ─────────────────────────
echo "[6] Verificando .env en VM..."
$SCP "$BASE_DIR/.env.example" "$VM_USER@$VM_HOST:$VM_DIR/.env.example"
ENV_EXISTS=$($SSH "[ -f $VM_DIR/.env ] && echo yes || echo no")
if [ "$ENV_EXISTS" = "no" ]; then
  echo ""
  echo "  ⚠  No existe $VM_DIR/.env en la VM."
  echo "     Conéctate y créalo antes de iniciar los servicios:"
  echo "     ssh $VM_USER@$VM_HOST"
  echo "     cp $VM_DIR/.env.example $VM_DIR/.env"
  echo "     nano $VM_DIR/.env   # rellenar DB_HOST, DB_PASS, etc."
  echo ""
fi

# ── 7. Primera vez: configurar nginx + systemd ────────────────────────────────
echo "[7] ¿Ejecutar setup-vm.sh en la VM? (nginx + systemd) [s/N]"
read -r RESP
if [[ "$RESP" =~ ^[sS]$ ]]; then
  $SSH "sudo $VM_DIR/scripts/setup-vm.sh"
fi

# ── 8. Reiniciar servicios si ya están configurados ──────────────────────────
echo "[8] ¿Reiniciar servicios systemd ahora? [s/N]"
read -r RESP2
if [[ "$RESP2" =~ ^[sS]$ ]]; then
  $SSH "sudo systemctl restart tasfb2b-planificador tasfb2b-bff tasfb2b-carga-masiva tasfb2b-ejecutor"
  sleep 3
  $SSH "systemctl status tasfb2b-* --no-pager | grep -E 'tasfb2b|Active'"
fi

echo ""
echo "================================================"
echo "  Deploy completado."
echo "  Frontend: http://$VM_HOST"
echo "  API:      http://$VM_HOST/api/health"
echo "================================================"
