@echo off
:: Mata los procesos que ocupan los puertos de TASF.B2B
echo Deteniendo servicios TASF.B2B...

for %%P in (8081 8082 8083 8084 5173) do (
    for /f "tokens=5" %%I in ('netstat -aon 2^>nul ^| findstr ":%%P " ^| findstr "LISTENING"') do (
        if not "%%I"=="0" (
            taskkill /PID %%I /F >nul 2>&1
            echo   Puerto %%P -- PID %%I terminado
        )
    )
)

echo Listo.
