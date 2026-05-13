@echo off
set DB_HOST=tasfb2b-db.cpll0i02mkbl.us-east-1.rds.amazonaws.com
set DB_PORT=3306
set DB_NAME=tasfb2b
set DB_USER=admin
set DB_PASS=12345678
set TEMP_DIR=C:\tmp\tasf
set PORT=8082
echo Iniciando Carga Masiva en :8082...
go run ./cmd/carga-masiva/main.go
