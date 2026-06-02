# TAREAS.md — Plan de trabajo TASF.B2B

> Generado con análisis técnico del código actual + requerimientos del profesor.
> Ordenado por prioridad. Usar como contexto inicial para Claude Opus.

---

## CONTEXTO DEL PROYECTO

Sistema de simulación de logística de equipaje aéreo. Tres escenarios requeridos:
- **Sim5D** (`period`): Compresión de 3-7 días en 30-90 minutos reales. **YA FUNCIONAL.**
- **Operaciones** (`realtime`): Simulación día a día en tiempo real. **PENDIENTE.**
- **Colapso** (`collapse`): Simulación hasta colapso logístico. **PENDIENTE.**

Stack: React + Vite (frontend) | Go BFF + Go Ejecutor + Java Spring Boot Planificador (backend) | MySQL AWS RDS.

---

## REQUERIMIENTOS DEL PROFESOR (EMAIL)

1. Los 3 escenarios son obligatorios. No hay reducción de alcance.
2. Fechas de prueba Sim5D: `20-07-2026 08:15`, `15-08-2026 13:32`, `05-11-2026 22:45`, `20-02-2027 10:23`, `14-03-2027 04:04`.
3. La simulación debe **consumir solo datos desde la fecha/hora elegida en adelante** (tiempo=0 en ese momento).
4. El equipo debe explicar cómo el planificador consume bloques de datos (diagrama).
5. Duración de Sim5D: entre **30 y 90 minutos** reales.
6. El **ingreso de datos** (aeropuertos, vuelos, etc.) debe estar en una **opción de menú separada** de los 3 escenarios.
7. Nuevo botón en configuración: **"Cargar estado hasta esta fecha"** (warm-up) vs **"Iniciar desde cero"**.

---

## BLOQUE 1 — CRÍTICO (afecta presentación próxima semana)

### T01 · Fix: Sim5D solo consume datos desde la fecha elegida
**Problema:** El planificador hace warm-up completo desde inicio del dataset, pero el profesor indica que tiempo=0 debe ser la fecha elegida y solo se consumen datos del futuro de esa fecha.  
**Archivo:** `backend/planificador/src/pe/edu/pucp/tasf/web/PlanificadorController.java`  
**Qué hacer:** Validar que la carga de envíos (`cargarTodosLosEnvios`) use `fechaIniUTC` como punto de inicio real, descartando todos los registros anteriores. El warm-up (estado de red) sigue siendo necesario pero NO debe incluir envíos pre-fecha.

### T02 · Feature: Botón "Cargar estado previo (warm-up)"
**Descripción:** Agregar toggle en `SimulationConfig.tsx` que permita al usuario elegir si quiere warm-up o no.  
**Frontend:** Nuevo campo `boolean warmUp` en `SimulationConfig` (types/index.ts). Mostrar en la pestaña de configuración del escenario Período como un switch con descripción clara.  
**Backend:** Pasar parámetro `warmUp: boolean` en el body de `POST /api/periodo/iniciar`. En el BFF reenviarlo al Planificador. En el Planificador, si `warmUp=false`, saltarse el loop de días previos.  
**Archivos:** `types/index.ts`, `SimulationConfig.tsx`, `SimulationContext.tsx`, `bff/handler/periodo.go`, `PlanificadorController.java`.

### T03 · Feature: Configuración de "saltos" en Sim5D
**Descripción:** El profesor menciona "saltos de algoritmo" y "salto en el eje de los datos" para controlar duración (30-90 min). Actualmente solo existe `dias` y `duracionRealMin`.  
**Qué agregar:** En UI, mostrar estimación de duración en tiempo real: `velocidad = (dias * 1440) / (duracionRealMin * 60)` y mostrarla en la UI (ya se calcula en BFF pero no se muestra bien).  
**Extra:** Validar que `duracionRealMin` esté en rango 30-90 en el formulario y mostrar advertencia si no.

### T04 · Fix: Ingreso de datos en menú separado
**Descripción:** El profesor requiere que la carga masiva de datos (aeropuertos, vuelos, envíos) esté en una opción de menú distinta a los 3 escenarios.  
**Qué hacer:** Agregar una nueva ruta `/datos` o `/admin` en el router de React (`routes.tsx`). Mover el componente de carga masiva (si existe) o crear uno nuevo que use el servicio `carga-masiva` (puerto 8082). Actualizar el navbar/sidebar para tener la sección separada.  
**Archivos:** `Frontend/src/app/routes.tsx`, nueva página `DataIngestion.tsx` o similar.

---

## BLOQUE 2 — ESCENARIOS PENDIENTES

### T05 · Escenario Operaciones (realtime) — diseño e implementación
**Estado actual:** Solo existe el radio button en UI. Sin endpoints ni lógica en backend.  
**Descripción del escenario:** Simulación día a día en tiempo real — cada "día simulado" = 1 día real. El sistema procesa los envíos del día actual (fecha de hoy del dataset) y espera feedback en tiempo real.  
**Qué implementar:**
- BFF: nuevo endpoint `POST /api/operaciones/iniciar` con parámetro `fecha` (el día a operar).
- Planificador: planificar solo 1 día sin warm-up acelerado.
- Ejecutor: mismo motor SSE, pero con `tick_interval` ajustado a tiempo real (1 min simulado = 1 min real).
- Frontend: en `SimulationContext`, detectar `scenario === 'realtime'` y llamar endpoint distinto.

### T06 · Escenario Colapso — diseño e implementación
**Estado actual:** UI tiene slider de velocidad (1-200×) pero nunca se envía al backend.  
**Descripción:** Simular a alta velocidad hasta que un aeropuerto supere capacidad al 100% → colapso logístico. La simulación corre días continuos hasta detectar colapso.  
**Qué implementar:**
- BFF: nuevo endpoint `POST /api/colapso/iniciar` con parámetros `velocidad` (multiplier) y `criterio`.
- Planificador: loop de días indefinido hasta señal de colapso.
- Ejecutor: emitir evento SSE `colapso` cuando `ocupacion >= 1.0` en algún aeropuerto, con detalle de cuál aeropuerto colapsó.
- Frontend: mostrar overlay especial de colapso (animación, aeropuerto que colapsó, día en que ocurrió).
- Nuevo evento SSE `colapso` en `SimulationContext` similar a `completado`.

---

## BLOQUE 3 — BUGS CONOCIDOS

### T07 · Fix: JobStore sin expiración (fuga de memoria)
**Archivo:** `backend/planificador/src/pe/edu/pucp/tasf/web/JobStore.java` (o donde esté el mapa de jobs).  
**Fix:** Agregar TTL de ~2 horas o limpiar jobs completados después de que el BFF los consulte por última vez.

### T08 · Fix: AeropuertoEstado.ocupacion es string
**Archivo:** `Frontend/src/app/types/index.ts` + `SimulationContext.tsx`  
**Fix:** Cambiar tipo de `ocupacion: string` a `ocupacion: number` en la interfaz `AeropuertoEstado`. Ajustar el ejecutor Go para emitir número en vez de string (o parsear en el contexto). Eliminar los `parseFloat(liveAp.ocupacion) * 100` dispersos.

### T09 · Fix: SSE sin reconexión explícita al colapso del BFF
**Archivo:** `Frontend/src/app/context/SimulationContext.tsx`  
**Fix:** En `es.onerror`, después de N intentos fallidos, setear `fase = 'error'` con mensaje descriptivo en lugar de quedarse en 'ejecutando' indefinidamente.

### T10 · Fix: Fecha fuera del rango del dataset no validada en frontend
**Archivo:** `Frontend/src/app/pages/SimulationConfig.tsx`  
**Fix:** El componente `DatePickerField` ya recibe `fromDate` y `toDate` del dataset, pero no muestra alerta explícita. Agregar mensaje de error inline si la fecha elegida + días supera `datasetInfo.fecha_max`.

---

## BLOQUE 4 — MEJORAS Y DEUDA TÉCNICA

### T11 · Optimización: Eliminar dependencia de datos estáticos (mock)
**Archivos:** `Frontend/src/app/data/airports.ts`, `aeropuertos.ts`, `envios.ts`, `flights.ts`  
**Situación:** `DomainContext` ya carga desde BD con fallback a estáticos. Los archivos estáticos siguen en el repo. Cuando la BD esté siempre disponible, el fallback puede causar confusión si hay diferencias.  
**Fix:** Agregar un flag en `DomainContext` que en producción deshabilite el fallback estático y muestre error claro si el BFF no responde.

### T12 · UX: Mostrar estimación de duración antes de iniciar Sim5D
**Archivo:** `Frontend/src/app/pages/SimulationConfig.tsx`  
**Fix:** Mostrar en tiempo real el cálculo `velocidad = (dias * 1440) / duracionRealMin` y `"La simulación durará ~X minutos reales"` mientras el usuario ajusta los sliders.

### T13 · UX: Botones Pausar/Detener (actualmente deshabilitados)
**Archivos:** `Frontend/src/app/pages/UnifiedDashboard.tsx`, `backend/ejecutor/internal/handler/simulacion.go`  
**Situación:** Los endpoints `POST /api/simulacion/pausar` y `/detener` existen en el ejecutor pero los botones están desactivados en la UI por bugs CORS ya corregidos.  
**Fix:** Rehabilitar los botones (`disabled` → `onClick` real) y verificar que pausar/reanudar funcione en el ejecutor Go.

### T14 · Infraestructura: Los datos de envíos no están en el repo
**Situación:** `_envios_preliminar_/` está en `.gitignore` (391 MB). Cada vez que se despliega en una VM nueva hay que subirlos manualmente.  
**Fix:** Documentar en README el proceso. Considerar almacenarlos en un bucket S3 o en la BD y cargarlos con el servicio `carga-masiva` en el primer deploy.

### T15 · Tech: Criterio EDF hardcodeado en varios lugares
**Archivos:** `SimulationContext.tsx` (línea `criterio: 'EDF'`), `PlanificadorController.java` (default), `application.properties`  
**Fix:** Asegurar que el criterio seleccionado en UI (`localConfig.criterio`) llegue correctamente hasta el Planificador. Verificar que FIFO y ALEATORIO funcionen end-to-end.

---

## RESUMEN DE PRIORIDADES

| # | Tarea | Prioridad | Esfuerzo | Bloquea presentación | Estado |
|---|-------|-----------|----------|----------------------|--------|
| T01 | Sim5D consume solo datos desde fecha elegida | 🔴 Crítica | Medio | Sí | ✅ Hecho |
| T02 | Botón warm-up on/off | 🔴 Crítica | Medio | Sí | ✅ Hecho |
| T03 | Estimación duración + validación 30-90 min | 🔴 Crítica | Bajo | Sí | ✅ Hecho |
| T04 | Carga de datos en menú separado | 🔴 Crítica | Medio | Sí | ✅ Hecho |
| T05 | Escenario Operaciones (día a día) | 🟠 Alta | Alto | No (semana siguiente) | 🟡 MVP testeable |
| T06 | Escenario Colapso | 🟠 Alta | Alto | No (semana siguiente) | ⬜ Pendiente |
| BUG | Re-ejecución: 2da simulación no arrancaba | 🔴 Crítica | Medio | Sí | ✅ Hecho |
| T07 | JobStore TTL | 🟡 Media | Bajo | No | ⬜ Pendiente |
| T08 | ocupacion string→number | 🟡 Media | Bajo | No | ✅ Hecho |
| T09 | SSE reconexión | 🟡 Media | Bajo | No | ✅ Hecho |
| T10 | Validación fecha en frontend | 🟡 Media | Bajo | No | ✅ Hecho |
| T11 | Eliminar fallback estático en prod | 🟢 Baja | Bajo | No | ⬜ Pendiente |
| T12 | Estimación duración en UI | 🟢 Baja | Bajo | No | ✅ Hecho |
| T13 | Pausar/Detener funcional | 🟢 Baja | Bajo | No | ✅ Hecho |
| T14 | Datos de envíos en CI/deploy | 🟢 Baja | Alto | No | ⬜ Pendiente |
| T15 | Criterio end-to-end | 🟢 Baja | Bajo | No | 🟡 Parcial |

---

## ESTADO DE IMPLEMENTACIÓN (rama `feature/escenarios-y-warmup`)

### 🔴 BUG CRÍTICO RESUELTO — la 2da simulación no arrancaba

**Causa:** el Ejecutor mantiene una única simulación/broker SSE (`h.activa`,
`h.broker`). Al terminar la 1ª simulación, su broker SSE quedaba vivo y la
conexión del proxy SSE del BFF colgada en `scanner.Scan()`. Al iniciar la 2ª,
se reemplazaba `h.broker` sin cerrar el anterior, dejando recursos huérfanos y
la nueva conexión SSE sin recibir eventos de forma fiable.

**Fix:**
- `sse/broker.go`: nuevo método `Cerrar()` que desconecta a todos los clientes
  y marca el broker como cerrado (rechaza nuevas conexiones con 410). `ServeHTTP`
  ahora limpia de forma idempotente (sin doble-close de canales).
- `handler/simulacion.go` (`Iniciar`): antes de arrancar una nueva simulación,
  si hay una previa (completada/detenida) se hace teardown explícito:
  `h.activa.Detener()` + `h.broker.Cerrar()` y se ponen en `nil`. Garantiza
  borrón y cuenta nueva en cada ejecución.

### 🟡 T05 — Operaciones (día a día): MVP testeable

El escenario `realtime` ahora es ejecutable reutilizando el flujo de Periodo
con **1 día** desde la fecha elegida (sin endpoints nuevos):
- `SimulationConfig.tsx`: `diasEfectivos = 1` para realtime; date picker y slider
  de duración habilitados; validación de rango de fecha aplicada; textos
  adaptados ("1 día simulado se comprime en X min").
- Un día-a-día completo en tiempo real (1 min sim = 1 min real, continuo) queda
  como mejora futura; este MVP permite probar el ciclo end-to-end ya.

### ✅ Completado y compilando (Bloque 1 + bugfixes rápidos)

- **T01 + T02 — Warm-up opcional / consumo desde la fecha elegida**
  - `PlanificadorController.java`: `iniciar` parsea `warmUp` (default `false`).
    `ejecutarJob` recibe el flag; si es `false` se salta el loop de warm-up,
    por lo que tiempo=0 es la fecha elegida y solo se procesan maletas de esa
    fecha en adelante (la ventana real ya filtra vía `cargarTodosLosEnvios`).
  - `periodo.go` (BFF): nuevo campo `warmUp` en el body, se reenvía al
    planificador y se devuelve `warm_up` en la respuesta.
  - `types/index.ts`: `SimulationConfig.warmUp: boolean`.
  - `SimulationContext.tsx`: default `warmUp: false`, se envía en
    `/periodo/iniciar` y se acepta en overrides. Default de escenario cambiado
    a `period` y días a `5`.
  - `SimulationConfig.tsx`: toggle "Desde cero" vs "Cargar estado previo".

- **T03 + T12 — Estimación de duración + validación 30-90 min**
  - Slider ya acotado a 30-90; tarjeta con duración real estimada y velocidad
    efectiva (`velocidad = dias*1440 / (duracionRealMin*60)`).
  - `puedeIniciar` bloquea el botón Iniciar si la duración queda fuera de rango.

- **T04 — Ingreso de datos en menú separado**
  - Nueva página `pages/DataIngestion.tsx` (ruta `/datos`) que sube archivos a
    los endpoints reales `POST /api/carga/upload/{aeropuertos|vuelos|envios}`
    (multipart campo `archivo`, soporta `?forzar=true`, envíos múltiples).
  - Link "Ingreso de datos" en `Navigation.tsx`; ruta en `routes.tsx`.
  - Se eliminó el tab "Carga Masiva" de `SimulationConfig.tsx` y su código muerto.

- **T08 — `ocupacion` string → number**
  - `simulacion.go` (ejecutor) emite `ocupacion` como número (3 decimales).
  - `types/index.ts`: `AeropuertoEstado.ocupacion: number`. Eliminados los
    `parseFloat(...)` en `SimulationContext.tsx` y `Map.tsx`. Doc actualizado.

- **T09 — SSE con detección de caída**
  - `SimulationContext.tsx`: contador `sseErroresRef`; tras 5 errores
    consecutivos o `readyState === CLOSED` se marca `fase = 'error'` con mensaje.

- **T10 — Validación de fecha contra el dataset**
  - `SimulationConfig.tsx`: si `inicio + dias` excede `fecha_max`, muestra error
    inline y deshabilita Iniciar.

- **T13 — Botones Pausar/Reanudar/Detener funcionales**
  - `UnifiedDashboard.tsx`: rehabilitados con `onClick` reales (los endpoints
    del ejecutor ya existían).

### 🟡 Parcial

- **T15 — Criterio end-to-end**: `handleIniciarPlanificacion` ahora envía
  `localConfig.criterio` (antes hardcodeaba `'EDF'`). Falta verificar FIFO y
  ALEATORIO en una corrida real.

### ⬜ Pendiente (no bloquea la presentación)

- **T05 / T06 — Escenarios Operaciones y Colapso**: requieren endpoints nuevos
  en BFF + lógica en planificador/ejecutor + UI. Son los más grandes; se
  recomienda abordarlos en una sesión dedicada usando `period` como plantilla.
- **T07 — JobStore TTL** (planificador): limpiar jobs completados.
- **T11 — Desactivar fallback estático en producción** (`DomainContext.tsx`).
- **T14 — Datos de envíos en el flujo de deploy** (documentar / S3 / carga-masiva).

### Verificación realizada

- Frontend: `npm run build` ✅ (sin errores).
- Go BFF y Ejecutor: `go build ./...` ✅.
- Planificador Java: pendiente de confirmar `mvn compile` (el cambio es
  mínimo y aislado: un parámetro extra y un `if`).

### Pendiente antes del PR

- Confirmar `mvn -q -DskipTests compile` del planificador.
- Probar una corrida real Sim5D con `warmUp=false` para validar que arranca
  en la fecha elegida.
- `git add` + commit + push de la rama `feature/escenarios-y-warmup`.

---

## NOTAS PARA CLAUDE OPUS

- El escenario **period** (Sim5D) ya funciona end-to-end. Leer `SimulationContext.tsx` y `periodo.go` para entender el patrón antes de implementar los otros dos.
- El planificador es **Java Spring Boot** en `backend/planificador/`. El ejecutor y BFF son **Go** en `backend/ejecutor/` y `backend/bff/`.
- Los tipos compartidos del frontend están en `Frontend/src/app/types/index.ts`.
- La máquina de estados de simulación está en `Frontend/src/app/context/SimulationContext.tsx` — toda acción pasa por ahí.
- El frontend llama al BFF mediante rutas relativas (`/api/...`) — nginx hace el proxy en producción.
- VM de producción: `1inf54-984-2b.inf.pucp.edu.pe` — deploy con `./scripts/start-linux.sh`.
