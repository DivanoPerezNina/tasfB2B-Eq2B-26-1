# Planificador — Especificación del Módulo

**Lenguaje:** Java 17  
**Puerto:** 8080  
**Responsable:** [asignar integrante]

---

## 1. Responsabilidad

Recibe los parámetros de una simulación y devuelve un plan completo de rutas para todos los envíos del periodo solicitado. Internamente ejecuta el algoritmo metaheurístico **GVNS** (General Variable Neighborhood Search) como algoritmo principal y **ALNS** (Adaptive Large Neighborhood Search) como algoritmo alternativo para experimentación numérica. El plan resultante se persiste en MySQL para que el Ejecutor lo consuma tick a tick.

Este módulo es, funcionalmente, **una gran función**: recibe parámetros → corre el algoritmo → devuelve resultado. No mantiene estado entre llamadas.

---

## 2. Estado del Código Existente

El algoritmo ya está completamente implementado. Los archivos relevantes son:

| Clase | Paquete | Descripción |
|---|---|---|
| `PlanificadorGVNSConcurrente.java` | `gvns` | Núcleo del algoritmo GVNS (Fase 2: solución inicial; Fase 3: mejora VNS) |
| `PlanificadorALNS.java` | `alns` | Algoritmo alternativo ALNS (destroy/repair adaptativo) |
| `GestorDatos.java` | `gvns` | Carga datos desde archivos `.txt` en arrays primitivos |
| `ResultadoPlanificacion.java` | `gvns` | DTO inmutable con métricas del plan generado |
| `AuditorRutas.java` | `gvns` | Valida la solución (5 invariantes: causalidad, continuidad, SLA, no-overbooking) |
| `ExportadorVisual.java` | `gvns` | Serializa rutas de muestra a JSON |
| `ResultadoCancelacion.java` | `gvns` | DTO para re-planificación por cancelación ⚠️ ver TODO-3 |
| `Escenario.java` | `gvns` | Enum: `TIEMPO_REAL`, `PERIODO_3D`, `PERIODO_5D`, `SEMANA`, `COLAPSO` |
| `CriterioOrden.java` | `gvns` | Enum: `EDF`, `FIFO`, `ALEATORIO` |
| `Main.java` | `gvns` | Entry point standalone (modo consola, no usar en producción) |
| `PlanificadorService.java` | `gvns` | Fachada para integración web — **base para el wrapper Spring Boot** |

**Lo que falta implementar:** el wrapper Spring Boot que expone `PlanificadorService` como endpoints REST y conecta `GestorDatos` a MySQL en lugar de archivos `.txt`.

---

## 3. Parámetros de Planificación

### Criterio por escenario (regla de negocio fija, no configurable por usuario)

| Escenario | Criterio usado | Justificación |
|---|---|---|
| `TIEMPO_REAL` | `EDF` (Earliest Deadline First) | Minimiza incumplimientos de plazo |
| `PERIODO_3D` | `EDF` | Ídem |
| `PERIODO_5D` | `EDF` | Ídem |
| `COLAPSO` | `ALEATORIO` | Mejor cobertura de búsqueda bajo saturación |

El criterio **puede recibirse como parámetro opcional** en la API para propósitos de experimentación numérica (RNF-a/b), pero si se omite se aplica la regla anterior.

### Límites de tiempo del algoritmo

| Fase | Tiempo máximo |
|---|---|
| Fase 2 — Solución inicial greedy | Sin límite (determinista) |
| Fase 3 — Mejora GVNS | 120 segundos por defecto |
| Total esperado para 9.5M envíos | 5–30 minutos (dentro de la ventana de 30–90 min) |

---

## 4. API REST

### Base URL
```
http://localhost:8080
```

---

### 4.1 Iniciar planificación

```
POST /api/planificacion/iniciar
Content-Type: application/json
```

**Request body:**
```json
{
  "escenario": "PERIODO_3D",
  "fecha_inicio": "2026-08-18",
  "criterio": "EDF",
  "tiempo_limite_seg": 120
}
```

| Campo | Tipo | Obligatorio | Valores posibles |
|---|---|---|---|
| `escenario` | string | ✅ | `TIEMPO_REAL`, `PERIODO_3D`, `PERIODO_5D`, `COLAPSO` |
| `fecha_inicio` | string ISO date | ✅ | Fecha de inicio de la simulación |
| `criterio` | string | ❌ | `EDF` (default), `FIFO`, `ALEATORIO` |
| `tiempo_limite_seg` | int | ❌ | Default: 120 |

**Respuesta `202 Accepted`:**
```json
{
  "simulacion_id": 1,
  "estado": "planificando",
  "mensaje": "Algoritmo GVNS iniciado. Consultar estado con GET /api/planificacion/1"
}
```

> La planificación corre en un hilo separado. El llamador (BFF/Ejecutor) debe hacer polling con el siguiente endpoint.

---

### 4.2 Consultar estado de la planificación

```
GET /api/planificacion/{simulacion_id}
```

**Respuesta mientras planifica `200 OK`:**
```json
{
  "simulacion_id": 1,
  "estado": "planificando",
  "progreso": {
    "fase": 3,
    "iteraciones_mejora": 142,
    "tiempo_transcurrido_seg": 47
  }
}
```

**Respuesta cuando termina `200 OK`:**
```json
{
  "simulacion_id": 1,
  "estado": "listo",
  "resumen": {
    "escenario": "PERIODO_3D",
    "criterio": "EDF",
    "ventana_ini_utc": 1755475200,
    "ventana_fin_utc": 1755734400,
    "total_envios": 9519995,
    "exitosos": 9187440,
    "rechazados": 180210,
    "salvados_por_gvns": 152345,
    "tasa_exito": 0.9651,
    "transito_promedio_min": 847,
    "rutas_directas": 6840120,
    "rutas_1_escala": 1902400,
    "rutas_2_escalas": 444920,
    "tiempo_fase2_seg": 18,
    "tiempo_fase3_seg": 102,
    "iteraciones_mejora": 318,
    "solucion_valida": true
  }
}
```

**Respuesta si falló `200 OK`:**
```json
{
  "simulacion_id": 1,
  "estado": "error",
  "detalle_error": "Invariante 3 violado: overbooking en vuelo #2847"
}
```

---

### 4.3 Solicitar re-planificación por cancelación

```
POST /api/planificacion/{simulacion_id}/replanificar
Content-Type: application/json
```

**Request body:**
```json
{
  "tipo_cancelacion": "VUELO",
  "id_afectado": 2847,
  "tiempo_utc_cancelacion": 1755520000
}
```

| `tipo_cancelacion` | `id_afectado` |
|---|---|
| `VUELO` | ID del vuelo cancelado |
| `AEROPUERTO` | ID del aeropuerto bloqueado |

**Respuesta `202 Accepted`:**
```json
{
  "simulacion_id": 1,
  "replanificacion_id": 2,
  "estado": "planificando",
  "envios_afectados": 340
}
```

> ⚠️ Ver **TODO-3** — la implementación de cancelaciones en `ResultadoCancelacion.java` debe revisarse antes de activar este endpoint.

---

### 4.4 Health check

```
GET /api/health
```

```json
{ "estado": "ok", "version": "1.0.0" }
```

---

## 5. Esquema MySQL — Tablas del Planificador

```sql
CREATE TABLE simulaciones (
  id                   INT UNSIGNED AUTO_INCREMENT,
  escenario            ENUM('TIEMPO_REAL','PERIODO_3D','PERIODO_5D','SEMANA','COLAPSO') NOT NULL,
  criterio             ENUM('EDF','FIFO','ALEATORIO')  NOT NULL,
  fecha_inicio         DATE                            NOT NULL,
  estado               ENUM('planificando','listo','error','cancelado') NOT NULL DEFAULT 'planificando',
  total_envios         INT UNSIGNED    NULL,
  exitosos             INT UNSIGNED    NULL,
  rechazados           INT UNSIGNED    NULL,
  salvados_por_gvns    INT UNSIGNED    NULL,
  tasa_exito           DECIMAL(6,4)    NULL,
  transito_prom_min    INT UNSIGNED    NULL,
  rutas_directas       INT UNSIGNED    NULL,
  rutas_1_escala       INT UNSIGNED    NULL,
  rutas_2_escalas      INT UNSIGNED    NULL,
  tiempo_fase2_seg     SMALLINT        NULL,
  tiempo_fase3_seg     SMALLINT        NULL,
  iteraciones_mejora   INT UNSIGNED    NULL,
  solucion_valida      BOOLEAN         NULL,
  detalle_error        TEXT            NULL,
  creado_en            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);

-- Una fila por segmento de ruta de cada envío (máx 3 segmentos por envío)
-- Para 9.5M envíos: entre 9.5M (todos directos) y 28.5M filas (todos con 2 escalas)
CREATE TABLE rutas_envio (
  simulacion_id        INT UNSIGNED    NOT NULL,
  id_envio             CHAR(8)         NOT NULL,
  origen_iata          CHAR(4)         NOT NULL,    -- aeropuerto origen del envío
  segmento             TINYINT UNSIGNED NOT NULL,   -- 0 = primer vuelo, 1 = escala 1, 2 = escala 2
  vuelo_id             INT UNSIGNED    NOT NULL,
  salida_utc_min       INT UNSIGNED    NOT NULL,    -- minutos epoch desde fecha base
  llegada_utc_min      INT UNSIGNED    NOT NULL,
  estado               ENUM('pendiente','en_vuelo','en_escala','entregado','rechazado','salvado_gvns')
                       NOT NULL DEFAULT 'pendiente',
  PRIMARY KEY (simulacion_id, id_envio, origen_iata, segmento),
  KEY idx_salida (simulacion_id, salida_utc_min),   -- para queries del Ejecutor por tick
  KEY idx_llegada (simulacion_id, llegada_utc_min)
);
```

> **Nota de rendimiento:** escribir hasta 28.5M filas en `rutas_envio` tarda entre 10 y 25 minutos según hardware. Esto es aceptable dentro de la ventana de 30–90 min del escenario de periodo.

---

## 6. Flujo Interno del Algoritmo

```
PlanificadorService.planificarDia() / planificarVentana()
  │
  ├── GestorDatos.cargar()           ← TODO: reemplazar lectura de .txt por MySQL
  │     lee aeropuertos, vuelos, envíos del periodo
  │
  ├── PlanificadorGVNSConcurrente.ejecutar()
  │     Fase 2: permutación según criterio + asignación greedy (máx 3 segmentos)
  │     Fase 3: loop GVNS — Shaking → VND N1 → VND N2 → aceptar si mejora
  │     hasta tiempo_limite_seg
  │
  ├── AuditorRutas.validar()         ← verifica 5 invariantes
  │
  ├── ResultadoPlanificacion         ← DTO inmutable con métricas
  │
  └── [NUEVO] ExportadorMySQL.guardar()  ← graba simulaciones + rutas_envio en BD
```

---

## 7. TODO — Pendientes de Implementación

### TODO-1 — Agregar Spring Boot al proyecto *(prioritario)*

El `pom.xml` actual es un JAR standalone sin dependencias externas. Para convertirlo en un servicio REST:

1. Agregar al `pom.xml`:
```xml
<parent>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-parent</artifactId>
  <version>4.0.1</version>
</parent>
<dependencies>
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
  </dependency>
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-jpa</artifactId>
  </dependency>
  <dependency>
    <groupId>com.mysql</groupId>
    <artifactId>mysql-connector-j</artifactId>
  </dependency>
</dependencies>
```

2. Crear `TasfPlanificadorApplication.java` con `@SpringBootApplication`
3. Crear `PlanificacionController.java` que envuelva `PlanificadorService`
4. Configurar `application.yml` con datasource MySQL y puerto 8080
5. Cambiar packaging de `jar` a `jar` con Spring Boot Maven plugin (fat JAR)

### TODO-2 — Reemplazar GestorDatos para leer de MySQL

`GestorDatos.java` actualmente lee archivos `.txt` con paths hardcodeados. Debe reemplazarse por una implementación que:
- Consulte `aeropuertos`, `vuelos` y `envios` de MySQL
- Conserve la misma estructura de arrays primitivos (`int[]`, `long[]`) para no degradar el rendimiento del algoritmo
- Filtre envíos por ventana temporal (fecha_inicio → fecha_inicio + dias_escenario)

Sugerencia: crear interfaz `FuenteDatos` con dos implementaciones:
- `FuenteArchivos` (actual, para pruebas locales sin BD)
- `FuenteMySQL` (nueva, para producción)

### TODO-3 — Revisar implementación de cancelaciones ⚠️

`ResultadoCancelacion.java` existe pero su integración con `PlanificadorGVNSConcurrente` no está clara. Antes de activar el endpoint `POST /replanificar` se debe:
- Verificar si la re-planificación corre sobre todos los envíos o solo los afectados
- Definir si se genera una nueva `simulacion_id` o se actualiza la existente
- Revisar si `AuditorRutas` valida correctamente rutas parcialmente re-asignadas
- Coordinar con el Ejecutor el protocolo de pausa/reanudación durante la re-planificación

### TODO-4 — Experimentación numérica (RNF-a/b)

El sistema debe poder ejecutar GVNS y ALNS sobre el mismo dataset y comparar resultados. Implementar:
- Endpoint `POST /api/experimentacion` que corre ambos algoritmos secuencialmente
- Devuelve un JSON comparativo con métricas de ambos
- Permite variar semillas, criterios y tiempo límite para los experimentos

---

## 8. Variables de Configuración

| Variable | Valor por defecto | Descripción |
|---|---|---|
| `SERVER_PORT` | `8080` | Puerto del servicio |
| `SPRING_DATASOURCE_URL` | `jdbc:mysql://localhost:3306/tasfb2b` | URL de MySQL |
| `SPRING_DATASOURCE_USERNAME` | `tasf` | Usuario |
| `SPRING_DATASOURCE_PASSWORD` | — | Contraseña (obligatoria) |
| `TASF_GVNS_TIEMPO_LIMITE_SEG` | `120` | Tiempo máximo Fase 3 |
| `TASF_GVNS_BATCH_ESCRITURA` | `5000` | Filas por batch al escribir rutas_envio |

---

## 9. Estructura de Carpetas

```
planificador/
├── src/main/java/pe/edu/pucp/tasf/
│   ├── TasfPlanificadorApplication.java   ← TODO-1: nuevo
│   ├── api/
│   │   └── PlanificacionController.java   ← TODO-1: nuevo
│   ├── gvns/                              ← código existente
│   │   ├── PlanificadorGVNSConcurrente.java
│   │   ├── GestorDatos.java               ← TODO-2: refactorizar
│   │   ├── PlanificadorService.java
│   │   ├── ResultadoPlanificacion.java
│   │   ├── ResultadoCancelacion.java      ← TODO-3: revisar
│   │   ├── AuditorRutas.java
│   │   ├── ExportadorVisual.java
│   │   ├── AnalizadorRed.java
│   │   ├── Escenario.java
│   │   └── CriterioOrden.java
│   ├── alns/                              ← código existente
│   │   └── [clases ALNS existentes]
│   └── db/
│       └── ExportadorMySQL.java           ← TODO-1: nuevo (guarda plan en BD)
├── src/main/resources/
│   └── application.yml                    ← TODO-1: nuevo
├── datos/
│   ├── aeropuertos.txt
│   └── vuelos.txt
├── pom.xml
└── PLANIFICADOR.md                        ← este archivo
```
