#!/bin/bash
# setup-vm.sh — Configura la VM PUCP la primera vez (o re-deploya).
# Debe ejecutarse desde /opt/tasfb2b (raíz del repo subido a la VM).
# Requiere sudo.
#
# Uso:
#   cd /opt/tasfb2b
#   chmod +x scripts/*.sh
#   sudo ./scripts/setup-vm.sh
set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_USER="1inf54.984.2b"
NGINX_CONF="/etc/nginx/sites-available/tasfb2b"
NGINX_LINK="/etc/nginx/sites-enabled/tasfb2b"
FRONTEND_DIR="/var/www/tasfb2b"
SYSTEMD_DIR="/etc/systemd/system"

echo "================================================"
echo "  TASF.B2B — Setup VM (Ubuntu 24 LTS)"
echo "================================================"
echo "  Repo    : $REPO_DIR"
echo "  Usuario : $APP_USER"

# ── Verificar que corre como root ─────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  echo "ERROR: ejecutar con sudo."
  exit 1
fi

# ── 1. Crear directorios ───────────────────────────────────────────────────────
echo ""
echo "[1] Creando directorios..."
mkdir -p "$REPO_DIR/logs"
mkdir -p "$FRONTEND_DIR"
chown -R "$APP_USER":"$APP_USER" "$REPO_DIR/logs"
echo "    OK"

# ── 2. Copiar frontend ─────────────────────────────────────────────────────────
echo "[2] Copiando frontend a $FRONTEND_DIR..."
if [ -d "$REPO_DIR/Frontend/dist" ]; then
  cp -r "$REPO_DIR/Frontend/dist/." "$FRONTEND_DIR/"
  chown -R www-data:www-data "$FRONTEND_DIR"
  echo "    OK → $FRONTEND_DIR"
else
  echo "    AVISO: Frontend/dist no existe — ejecuta build-all.sh primero."
fi

# ── 3. Hacer ejecutables los binarios Go ──────────────────────────────────────
echo "[3] Permisos de binarios..."
for BIN in bff carga-masiva ejecutor; do
  FILE="$REPO_DIR/backend/$BIN/bin/$BIN"
  [ -f "$FILE" ] && chmod +x "$FILE" && echo "    chmod +x $BIN" || echo "    AVISO: $FILE no encontrado"
done

# ── 4. Configurar nginx ────────────────────────────────────────────────────────
echo "[4] Configurando nginx..."
cat > "$NGINX_CONF" <<'NGINX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;

    server_name 1inf54-984-2b.inf.pucp.edu.pe 200.16.7.166;

    # ── Frontend (React SPA) ──────────────────────────────────────────────
    root /var/www/tasfb2b;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # ── API → BFF (Go :8081) ──────────────────────────────────────────────
    location /api/ {
        proxy_pass         http://127.0.0.1:8081;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    # ── SSE: desactivar buffering para /api/simulacion/eventos ───────────
    location /api/simulacion/eventos {
        proxy_pass         http://127.0.0.1:8081;
        proxy_http_version 1.1;
        proxy_set_header   Connection '';
        proxy_set_header   Host $host;
        proxy_set_header   Cache-Control 'no-cache';
        proxy_buffering    off;
        proxy_cache        off;
        proxy_read_timeout 3600s;
        chunked_transfer_encoding on;
    }

    # ── Tomcat (acceso directo al servidor universitario) ────────────────
    location /tomcat/ {
        proxy_pass http://127.0.0.1:8080/;
    }
}
NGINX

# Desactivar el default si existe y no es el nuestro
if [ -L "/etc/nginx/sites-enabled/default" ]; then
  rm -f /etc/nginx/sites-enabled/default
  echo "    Eliminado sites-enabled/default"
fi
ln -sf "$NGINX_CONF" "$NGINX_LINK"
nginx -t && echo "    nginx config OK"

# ── 5. Crear servicios systemd ─────────────────────────────────────────────────
echo "[5] Instalando servicios systemd..."

# Planificador
cat > "$SYSTEMD_DIR/tasfb2b-planificador.service" <<EOF
[Unit]
Description=TASF.B2B Planificador (Java Spring Boot :8084)
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$REPO_DIR
EnvironmentFile=$REPO_DIR/.env
ExecStart=/usr/bin/java -Xmx2g -jar $REPO_DIR/backend/planificador/target/planificador-gvns-1.0.0.jar
Restart=on-failure
RestartSec=10
StandardOutput=append:$REPO_DIR/logs/planificador.log
StandardError=append:$REPO_DIR/logs/planificador.log

[Install]
WantedBy=multi-user.target
EOF

# BFF
cat > "$SYSTEMD_DIR/tasfb2b-bff.service" <<EOF
[Unit]
Description=TASF.B2B BFF (Go :8081)
After=network.target tasfb2b-planificador.service tasfb2b-ejecutor.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$REPO_DIR
EnvironmentFile=$REPO_DIR/.env
ExecStart=$REPO_DIR/backend/bff/bin/bff
Restart=on-failure
RestartSec=5
StandardOutput=append:$REPO_DIR/logs/bff.log
StandardError=append:$REPO_DIR/logs/bff.log

[Install]
WantedBy=multi-user.target
EOF

# Carga Masiva
cat > "$SYSTEMD_DIR/tasfb2b-carga-masiva.service" <<EOF
[Unit]
Description=TASF.B2B Carga Masiva (Go :8082)
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$REPO_DIR
EnvironmentFile=$REPO_DIR/.env
ExecStart=$REPO_DIR/backend/carga-masiva/bin/carga-masiva
Restart=on-failure
RestartSec=5
StandardOutput=append:$REPO_DIR/logs/carga-masiva.log
StandardError=append:$REPO_DIR/logs/carga-masiva.log

[Install]
WantedBy=multi-user.target
EOF

# Ejecutor
cat > "$SYSTEMD_DIR/tasfb2b-ejecutor.service" <<EOF
[Unit]
Description=TASF.B2B Ejecutor (Go :8083)
After=network.target tasfb2b-planificador.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$REPO_DIR
EnvironmentFile=$REPO_DIR/.env
ExecStart=$REPO_DIR/backend/ejecutor/bin/ejecutor
Restart=on-failure
RestartSec=5
StandardOutput=append:$REPO_DIR/logs/ejecutor.log
StandardError=append:$REPO_DIR/logs/ejecutor.log

[Install]
WantedBy=multi-user.target
EOF

# Consultas — fuente de datos incremental del esquema Sa/Sc (Periodo, Colapso
# y Día a Día). El Orquestador del Ejecutor lo llama vía CONSULTAS_URL.
cat > "$SYSTEMD_DIR/tasfb2b-consultas.service" <<EOF
[Unit]
Description=TASF.B2B Consultas (Go :8085)
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$REPO_DIR
EnvironmentFile=$REPO_DIR/.env
ExecStart=$REPO_DIR/backend/consultas/bin/consultas
Restart=on-failure
RestartSec=5
StandardOutput=append:$REPO_DIR/logs/consultas.log
StandardError=append:$REPO_DIR/logs/consultas.log

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
echo "    Servicios registrados: tasfb2b-{planificador,bff,carga-masiva,ejecutor,consultas}"

# ── 6. Habilitar y arrancar servicios ────────────────────────────────────────
echo "[6] Habilitando servicios (arranque automático)..."
for SVC in tasfb2b-planificador tasfb2b-bff tasfb2b-carga-masiva tasfb2b-ejecutor tasfb2b-consultas; do
  systemctl enable "$SVC"
  echo "    enabled: $SVC"
done

# ── 7. Recargar nginx ──────────────────────────────────────────────────────────
echo "[7] Recargando nginx..."
systemctl reload nginx
echo "    OK"

echo ""
echo "================================================"
echo "  Setup completado."
echo "================================================"
echo ""
echo "  IMPORTANTE: verifica que existe $REPO_DIR/.env"
echo "  con los valores correctos ANTES de iniciar los servicios."
echo "  Copia .env.example como base:"
echo "    cp $REPO_DIR/.env.example $REPO_DIR/.env"
echo "    nano $REPO_DIR/.env"
echo ""
echo "  Luego iniciar:"
echo "    sudo systemctl start tasfb2b-planificador tasfb2b-bff tasfb2b-carga-masiva tasfb2b-ejecutor"
echo ""
echo "  Ver estado:"
echo "    systemctl status tasfb2b-*"
echo "    journalctl -u tasfb2b-bff -f"
echo ""
echo "  Frontend visible en: http://200.16.7.166"
