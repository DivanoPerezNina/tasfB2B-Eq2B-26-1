@echo off
set DB_HOST=tasfb2b.cpll0i02mkbl.us-east-1.rds.amazonaws.com
set DB_PORT=3306
set DB_NAME=tasfb2b
set DB_USER=Hamilton
set DB_PASS=i5aLJibP1fwf05OBkYKu
set TEMP_DIR=C:\tmp\tasf
set PORT=8082
echo Iniciando Carga Masiva en :8082...
go run ./cmd/carga-masiva/main.go
