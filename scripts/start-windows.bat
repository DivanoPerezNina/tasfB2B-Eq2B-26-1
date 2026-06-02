@echo off
:: ============================================================
::  TASF.B2B — Levanta todos los servicios en Windows
::
::  Uso:
::    scripts\start-windows.bat
::    scripts\start-windows.bat -no-carga-masiva
::    scripts\start-windows.bat -no-carga-masiva -no-frontend
::
::  Flags:
::    -no-planificador   omite el Planificador Java (:8084)
::    -no-bff            omite el BFF Go            (:8081)
::    -no-ejecutor       omite el Ejecutor Go        (:8083)
::    -no-carga-masiva   omite Carga Masiva Go       (:8082)
::    -no-frontend       omite el frontend React     (:5173)
:: ============================================================
setlocal

cd /d "%~dp0.."
set ROOT=%CD%

set RUN_PLANIFICADOR=1
set RUN_BFF=1
set RUN_EJECUTOR=1
set RUN_CARGA=1
set RUN_FRONTEND=1

for %%A in (%*) do (
    if /i "%%A"=="-no-planificador"  set RUN_PLANIFICADOR=0
    if /i "%%A"=="-no-bff"           set RUN_BFF=0
    if /i "%%A"=="-no-ejecutor"      set RUN_EJECUTOR=0
    if /i "%%A"=="-no-carga-masiva"  set RUN_CARGA=0
    if /i "%%A"=="-no-frontend"      set RUN_FRONTEND=0
)

echo.
echo ================================================
echo   TASF.B2B -- Iniciando servicios (Windows)
echo ================================================
echo.

if %RUN_PLANIFICADOR%==1 (
    echo [1] Planificador Java :8084...
    start /d "%ROOT%\backend\planificador" "TASF Planificador :8084" cmd /k call start.bat
) else echo [1] Planificador -- OMITIDO

if %RUN_BFF%==1 (
    echo [2] BFF Go :8081...
    start /d "%ROOT%\backend\bff" "TASF BFF :8081" cmd /k call start.bat
) else echo [2] BFF -- OMITIDO

if %RUN_EJECUTOR%==1 (
    echo [3] Ejecutor Go :8083...
    start /d "%ROOT%\backend\ejecutor" "TASF Ejecutor :8083" cmd /k call start.bat
) else echo [3] Ejecutor -- OMITIDO

if %RUN_CARGA%==1 (
    echo [4] Carga Masiva Go :8082...
    start /d "%ROOT%\backend\carga-masiva" "TASF Carga Masiva :8082" cmd /k call start.bat
) else echo [4] Carga Masiva -- OMITIDO

if %RUN_FRONTEND%==1 (
    echo [5] Frontend React :5173...
    start /d "%ROOT%\Frontend" "TASF Frontend :5173" cmd /k npm run dev
) else echo [5] Frontend -- OMITIDO

echo.
echo ================================================
echo   Servicios iniciados:
if %RUN_FRONTEND%==1     echo     http://localhost:5173
if %RUN_BFF%==1          echo     http://localhost:8081/api/health
if %RUN_PLANIFICADOR%==1 echo     http://localhost:8084/api/health
if %RUN_EJECUTOR%==1     echo     http://localhost:8083/api/health
if %RUN_CARGA%==1        echo     http://localhost:8082/health
echo ================================================
echo.

endlocal
