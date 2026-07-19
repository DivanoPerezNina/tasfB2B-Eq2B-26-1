#!/bin/bash
# backup-mysql.sh — dump completo de la BD tasfb2b (RDS) a un .sql.gz local.
# Uso: DB_HOST=... DB_USER=... DB_PASS=... ./scripts/backup-mysql.sh
set -e

BACKUP_DIR="/opt/tasfb2b/backups"
RETENCION_DIAS=14

mkdir -p "$BACKUP_DIR"
FILE="$BACKUP_DIR/tasfb2b_$(date +%Y%m%d_%H%M%S).sql.gz"

mysqldump -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" \
  --single-transaction --quick --routines --triggers \
  tasfb2b | gzip > "$FILE"

find "$BACKUP_DIR" -name "*.sql.gz" -mtime +"$RETENCION_DIAS" -delete

echo "Backup OK: $FILE ($(du -h "$FILE" | cut -f1))"
