#!/usr/bin/env bash
# Arranca el Planificador GVNS apuntando a los archivos dejados por Carga Masiva
set -euo pipefail

export PLANIFICADOR_RUTA_AEROPUERTOS=/tmp/tasf/aeropuertos.txt
export PLANIFICADOR_RUTA_VUELOS=/tmp/tasf/vuelos.txt
export PLANIFICADOR_RUTA_ENVIOS=/tmp/tasf/_envios_preliminar_
export PLANIFICADOR_FECHA_INICIO=20260101   # primer día del dataset
export PLANIFICADOR_CRITERIO=EDF

echo "▶  Iniciando Planificador GVNS en :8084"
java -Xmx4g -jar target/planificador-gvns-1.0.0.jar
