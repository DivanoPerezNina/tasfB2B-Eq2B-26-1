# Módulo de experimentación — calibración de Ta, Sa, Sc y K

Encuentra, **por medición real** (no por suposición), los valores de los parámetros
de la planificación programada para que la **Simulación 5D dure entre 30 y 90
minutos** sin que la solución se caiga.

## Qué mide

| Símbolo | Significado | Cómo se obtiene |
|---|---|---|
| **Ta** | tiempo real que tarda una ejecución del GVNS | se **mide** llamando al Planificador |
| **Sc** | bloque de datos consumido por ejecución (min de pedidos) | parámetro que se **barre** |
| **Sa** | intervalo real entre ejecuciones | se **deriva** (debe cumplir `Sa > Ta`) |
| **K** | aceleración = `Sc / Sa` | se **deriva** |

Regla de oro: **`Ta < Sa` siempre** (si no, la siguiente planificación empieza
antes de terminar la anterior → caída). La duración total ≈ `nº bloques · Sa`.

## Requisitos

1. **Planificador corriendo** con el dataset cargado (lee de los archivos `.txt`).
2. El endpoint `POST /api/planificacion/benchmark` (incluido en esta rama).

### Levantar el Planificador apuntando al dataset

**Windows:**
```bat
cd backend\planificador
set PLANIFICADOR_RUTA_AEROPUERTOS=C:\tmp\tasf\aeropuertos.txt
set PLANIFICADOR_RUTA_VUELOS=C:\tmp\tasf\vuelos.txt
set PLANIFICADOR_RUTA_ENVIOS=C:\tmp\tasf
set PLANIFICADOR_FECHA_INICIO=20260102
mvn -q -o spring-boot:run
```

**Linux (VM):**
```bash
cd backend/planificador
export PLANIFICADOR_RUTA_AEROPUERTOS=/opt/tasfb2b/backend/planificador/datos/aeropuertos.txt
export PLANIFICADOR_RUTA_VUELOS=/opt/tasfb2b/backend/planificador/datos/vuelos.txt
export PLANIFICADOR_RUTA_ENVIOS=/opt/tasfb2b/backend/planificador/datos
export PLANIFICADOR_FECHA_INICIO=20260102
mvn -q -o spring-boot:run
```

## Ejecutar el experimento

```bash
cd backend/experimentos
go run . -fecha 2026-07-20T08:15 -dias 5 -sc 120,240,480,720 -muestras 8
```

### Flags

| Flag | Default | Descripción |
|---|---|---|
| `-planificador` | `http://localhost:8084` | URL del Planificador |
| `-fecha` | `2026-07-20T08:15` | `t=0` de la Sim5D (UTC). Solo se consumen datos de aquí en adelante |
| `-dias` | `5` | días a simular (Sim5D = 5) |
| `-criterio` | `EDF` | `EDF` \| `FIFO` \| `ALEATORIO` |
| `-sc` | `60,120,240,480,720` | tamaños de bloque a probar (min de datos, CSV) |
| `-obj-min` / `-obj-max` | `30` / `90` | rango de duración real deseado (min) |
| `-muestras` | `0` | si `>0`, mide solo N bloques espaciados (rápido); `0` = todos (preciso, pero lento) |

> **Tip:** empieza con `-muestras 8` para un tanteo rápido; luego corre con
> `-muestras 0` (todos los bloques) sobre el `Sc` candidato para el valor final.

## Cómo leer la salida

```
Sc(min) bloques  envíos    Ta_max(s) Ta_avg(s) rech  Sa_min*  K_max**  ¿factible 30-90?
──────────────────────────────────────────────────────────────────────────────────────
120     60       48000     2.310     1.840     0     2.31     3117     SÍ → Sa≈3.0s K≈2400 dur≈3min
480     15       48000     7.900     6.200     12    7.90     3645     SÍ → Sa≈... 
```

- **Ta_max**: el peor bloque. `Sa` debe ser mayor que esto.
- **¿factible?**: si existe un `Sa > Ta_max` que haga durar la Sim5D en 30–90 min,
  muestra el `Sa`, `K` y duración recomendados. Si dice *"Ta domina"*, ese `Sc`
  tiene bloques tan grandes que ni con `Sa = Ta_max` baja de 90 min.
- **rech**: rechazos acumulados — útil para el escenario de **colapso** (sube con `Sc`/`K` grande).

El equipo elige el `Sc` y `Sa` de la fila que mejor cuadre con la demo (más
bloques = animación más fluida; menos bloques = más “a saltos”).

## Nota

`Ta` aquí incluye la **carga de datos desde archivos** (lo que el orquestador
paga hoy). Cuando se migre a **MySQL local indexado** (ver ADR-004), `Ta` bajará
porque el query será `WHERE registro_utc ∈ [H_prev, H)` en vez de re-escanear
archivos — conviene re-medir entonces.
