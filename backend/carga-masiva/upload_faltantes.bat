@echo off
setlocal
set BASE=C:\tmp\tasf
set URL=http://localhost:8082/upload/envios

echo ============================================================
echo  Re-carga de 8 archivos envios faltantes en MySQL
echo ============================================================
echo.

call :subir _envios_SKBO_.txt
call :subir _envios_SLLP_.txt
call :subir _envios_SPIM_.txt
call :subir _envios_SUAA_.txt
call :subir _envios_SVMI_.txt
call :subir _envios_UBBB_.txt
call :subir _envios_UMMS_.txt
call :subir _envios_VIDP_.txt

echo.
echo ============================================================
echo  Todos los archivos enviados.
echo  Verificando conteo...
curl http://localhost:8082/estado
echo.
echo ============================================================
goto :eof

:subir
echo [%1] Subiendo...
curl -X POST %URL% -F archivo=@%BASE%\%1
echo.
echo [%1] Respuesta recibida. Esperando 3 segundos...
timeout /t 3 /nobreak >nul
goto :eof
