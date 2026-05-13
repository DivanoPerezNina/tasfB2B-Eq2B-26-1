#!/usr/bin/env bash
# Arranca el servicio Carga Masiva apuntando a RDS
set -euo pipefail

export PORT=8082
export DB_HOST=tasfb2b-db.cpll0i02mkbl.us-east-1.rds.amazonaws.com
export DB_PORT=3306
export DB_NAME=tasfb2b
export DB_USER=admin
export DB_PASS=12345678
export TEMP_DIR=/tmp/tasf
export BATCH_SIZE=1000
export MAX_UPLOAD_MB=50

mkdir -p "$TEMP_DIR/_envios_preliminar_"
echo "▶  Iniciando Carga Masiva en :$PORT → $DB_HOST/$DB_NAME"
go run ./cmd/carga-masiva/main.go
