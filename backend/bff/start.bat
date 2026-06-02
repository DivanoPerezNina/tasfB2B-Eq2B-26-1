@echo off
set PORT=8081
set DB_HOST=tasfb2b.cpll0i02mkbl.us-east-1.rds.amazonaws.com
set DB_PORT=3306
set DB_NAME=tasfb2b
set DB_USER=Hamilton
set DB_PASS=i5aLJibP1fwf05OBkYKu
set CARGA_MASIVA_URL=http://localhost:8082
set PLANIFICADOR_URL=http://localhost:8084
set EJECUTOR_URL=http://localhost:8083
set CORS_ORIGIN=*
echo Iniciando BFF en :8081...
go run ./cmd/bff/main.go
