@echo off
set PLANIFICADOR_RUTA_AEROPUERTOS=C:\tmp\tasf\aeropuertos.txt
set PLANIFICADOR_RUTA_VUELOS=C:\tmp\tasf\vuelos.txt
set PLANIFICADOR_RUTA_ENVIOS=C:\tmp\tasf
set PLANIFICADOR_FECHA_INICIO=20260102
set PLANIFICADOR_CRITERIO=EDF
echo Iniciando Planificador GVNS en :8084...
java -Xmx4g -jar target\planificador-gvns-1.0.0.jar
