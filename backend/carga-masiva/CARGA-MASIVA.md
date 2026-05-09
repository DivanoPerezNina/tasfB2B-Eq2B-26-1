# Carga Masiva — Especificación del Módulo

**Lenguaje:** Go  
**Puerto:** 8082  
**Responsable:** [asignar integrante]

---

## 1. Responsabilidad

Recibe los archivos `.txt` del dataset TASF.B2B desde el frontend, los valida, los procesa línea a línea (streaming) y los persiste en MySQL. Es el único componente que escribe en la base de datos. Opera **una sola vez por sesión de carga**, pero el sistema debe soportar recargas parciales o totales con control de duplicados.

---

## 2. Estrategia de Procesamiento

El dataset completo puede llegar a ~391 MB y 9.5 M registros. Para no saturar los 4 GB de RAM de la VM:

```
Frontend
  │  multipart/form-data (archivo por archivo)
  ▼
Carga Masiva recibe el stream del archivo
  │  escribe temporalmente en disco (/tmp/tasf/{token}/)
  ▼
Lee el archivo temporal línea a línea (bufio.Scanner)
  │  acumula lotes de 1,000 registros en memoria
  ▼
INSERT batch a MySQL  (repeat hasta EOF)
  │
  ▼
Borra archivo temporal
  │
  ▼
Reporta resultado (ok / error + rollback)
```

**Nunca** se carga el archivo completo en memoria. El tamaño máximo acumulado en RAM por lote es proporcional a 1,000 registros × ~100 bytes = ~100 KB por goroutine.

---

## 3. Esquema de Base de Datos

### Tablas de dominio

```sql
CREATE TABLE aeropuertos (
  id               TINYINT UNSIGNED NOT NULL,
  iata             CHAR(4)          NOT NULL,
  ciudad           VARCHAR(50)      NOT NULL,
  pais             VARCHAR(50)      NOT NULL,
  alias            CHAR(4)          NOT NULL,
  gmt_offset       TINYINT          NOT NULL,        -- ej: -5, +3
  capacidad_almacen SMALLINT UNSIGNED NOT NULL,      -- 500–800
  latitud          DECIMAL(9,6)     NOT NULL,
  longitud         DECIMAL(9,6)     NOT NULL,
  continente       TINYINT UNSIGNED NOT NULL,        -- 1=América, 2=Europa, 3=Asia
  PRIMARY KEY (id),
  UNIQUE KEY uq_iata (iata)
);

CREATE TABLE vuelos (
  id               INT UNSIGNED AUTO_INCREMENT,
  origen_iata      CHAR(4)          NOT NULL,
  destino_iata     CHAR(4)          NOT NULL,
  salida_minutos   SMALLINT UNSIGNED NOT NULL,       -- minutos desde 00:00 del día (0–1439)
  llegada_minutos  SMALLINT UNSIGNED NOT NULL,       -- ídem; si llegada < salida = día siguiente
  capacidad_max    SMALLINT UNSIGNED NOT NULL,       -- 150–400
  mismo_continente BOOLEAN          NOT NULL,        -- derivado al cargar
  PRIMARY KEY (id),
  KEY idx_origen (origen_iata),
  KEY idx_destino (destino_iata)
);

CREATE TABLE envios (
  id_envio         CHAR(8)          NOT NULL,        -- 8 dígitos, ej: 00000001
  origen_iata      CHAR(4)          NOT NULL,        -- extraído del nombre del archivo
  fecha_registro   DATE             NOT NULL,        -- aaaammdd parseado
  hora             TINYINT UNSIGNED NOT NULL,        -- 0–23
  minuto           TINYINT UNSIGNED NOT NULL,        -- 0–59
  destino_iata     CHAR(4)          NOT NULL,
  cantidad_maletas SMALLINT UNSIGNED NOT NULL,       -- 1–999
  id_cliente       INT UNSIGNED     NOT NULL,        -- 7 dígitos
  PRIMARY KEY (id_envio, origen_iata),
  KEY idx_origen_envio (origen_iata),
  KEY idx_destino_envio (destino_iata)
);
```

### Tabla de control de sesiones de carga

```sql
CREATE TABLE carga_sesiones (
  token            CHAR(36)         NOT NULL,        -- UUID v4 generado al iniciar
  tipo             ENUM('aeropuertos','vuelos','envios') NOT NULL,
  archivo          VARCHAR(100)     NOT NULL,        -- nombre del archivo recibido
  estado           ENUM('recibido','procesando','ok','error','revertido') NOT NULL DEFAULT 'recibido',
  registros_total  INT UNSIGNED     NOT NULL DEFAULT 0,
  registros_ok     INT UNSIGNED     NOT NULL DEFAULT 0,
  detalle_error    TEXT             NULL,
  creado_en        DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en   DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (token)
);
```

---

## 4. API REST

### Base URL
```
http://localhost:8082
```

---

### 4.1 Subir archivo de aeropuertos

```
POST /upload/aeropuertos
Content-Type: multipart/form-data
```

**Form field:**

| Campo | Tipo | Descripción |
|---|---|---|
| `archivo` | file | Archivo `aeropuertos.txt` |

**Respuesta exitosa `202 Accepted`:**
```json
{
  "token": "a3f1c2d4-...",
  "tipo": "aeropuertos",
  "archivo": "aeropuertos.txt",
  "estado": "procesando"
}
```

**Respuesta si ya existe carga previa `409 Conflict`:**
```json
{
  "error": "DATOS_EXISTENTES",
  "mensaje": "Ya existen 30 aeropuertos cargados. ¿Desea reemplazarlos?",
  "accion_requerida": "Enviar ?forzar=true para sobreescribir"
}
```
> Con `?forzar=true` en la URL se elimina la carga anterior y se reprocesa.

---

### 4.2 Subir archivo de vuelos

```
POST /upload/vuelos
Content-Type: multipart/form-data
```

**Form field:**

| Campo | Tipo | Descripción |
|---|---|---|
| `archivo` | file | Archivo `vuelos.txt` |

Misma lógica de respuesta que aeropuertos. Requiere que aeropuertos ya estén cargados (valida las claves IATA).

**Respuesta si no hay aeropuertos `412 Precondition Failed`:**
```json
{
  "error": "DEPENDENCIA_FALTANTE",
  "mensaje": "Cargue aeropuertos.txt antes de cargar vuelos.txt"
}
```

---

### 4.3 Subir archivo de envíos (por aeropuerto)

```
POST /upload/envios
Content-Type: multipart/form-data
```

**Form fields:**

| Campo | Tipo | Descripción |
|---|---|---|
| `archivo` | file | Archivo `_envios_XXXX_.txt` — el nombre del archivo debe seguir el patrón `_envios_{IATA}_.txt` |

El código IATA del aeropuerto origen se extrae del nombre del archivo. Si el nombre no sigue el patrón, el archivo es rechazado.

Puede llamarse 30 veces (una por aeropuerto). Cada llamada es independiente.

**Respuesta exitosa `202 Accepted`:**
```json
{
  "token": "b7e2a1f3-...",
  "tipo": "envios",
  "archivo": "_envios_SKBO_.txt",
  "origen_iata": "SKBO",
  "estado": "procesando"
}
```

---

### 4.4 Consultar estado de una sesión de carga

```
GET /upload/sesion/{token}
```

**Respuesta `200 OK`:**
```json
{
  "token": "a3f1c2d4-...",
  "tipo": "aeropuertos",
  "archivo": "aeropuertos.txt",
  "estado": "ok",
  "registros_total": 30,
  "registros_ok": 30,
  "detalle_error": null
}
```

**Estados posibles:**

| Estado | Significado |
|---|---|
| `recibido` | Archivo guardado en temp, en cola |
| `procesando` | Leyendo y batcheando a MySQL |
| `ok` | Carga completa, archivo temp eliminado |
| `error` | Falló, rollback ejecutado, ver `detalle_error` |
| `revertido` | Rollback exitoso |

---

### 4.5 Consultar totales cargados en BD

```
GET /estado
```

Respuesta que el frontend usa para el indicador de datos disponibles.

**Respuesta `200 OK`:**
```json
{
  "aeropuertos": 30,
  "vuelos": 4800,
  "envios": {
    "total": 9519995,
    "por_aeropuerto": {
      "SKBO": 341200,
      "SEQM": 298400,
      "...": "..."
    }
  },
  "listo_para_simular": true
}
```

`listo_para_simular` es `true` cuando los 3 tipos de datos están cargados.

---

### 4.6 Descargar plantilla de archivo

```
GET /plantillas/{tipo}
```

| `{tipo}` | Archivo devuelto |
|---|---|
| `aeropuertos` | `aeropuertos_plantilla.txt` |
| `vuelos` | `vuelos_plantilla.txt` |
| `envios` | `_envios_XXXX__plantilla.txt` |

Devuelve el archivo con cabeceras de ejemplo y comentarios para que el usuario sepa el formato exacto. El header de respuesta incluye `Content-Disposition: attachment`.

---

### 4.7 Limpiar todos los datos

```
DELETE /datos
```

Elimina todos los registros de `aeropuertos`, `vuelos` y `envios`. Para uso de re-carga total. Requiere header de confirmación:

```
X-Confirmar-Borrado: ELIMINAR-TODO
```

**Respuesta `200 OK`:**
```json
{
  "mensaje": "Todos los datos eliminados. El sistema requiere nueva carga.",
  "eliminados": {
    "aeropuertos": 30,
    "vuelos": 4800,
    "envios": 9519995
  }
}
```

---

## 5. Validaciones por Tipo de Archivo

### `aeropuertos.txt`
- Exactamente 30 registros (ni más ni menos)
- IATA de 4 letras mayúsculas, único
- GMT entre -12 y +14
- Capacidad almacén entre 500 y 800
- Coordenadas en rango válido

### `vuelos.txt`
- IATA origen y destino deben existir en `aeropuertos`
- Hora en formato `HH:MM`, valores 00:00–23:59
- Capacidad según continentes: mismo → 150–250, distinto → 150–400
- No se permiten vuelos con mismo origen y destino

### `_envios_{IATA}_.txt`
- Nombre del archivo debe seguir patrón `_envios_[A-Z]{4}_.txt`
- IATA del nombre debe existir en `aeropuertos`
- `id_envio` de 8 dígitos numéricos
- Fecha válida (aaaammdd)
- Horas 00–23, minutos 00–59
- IATA destino debe existir en `aeropuertos`
- Cantidad 001–999
- `id_cliente` de 7 dígitos

---

## 6. Flujo Completo — Happy Path

```
1. Frontend llama GET /estado → ve que no hay datos
2. Frontend descarga plantillas con GET /plantillas/{tipo}
3. Usuario prepara archivos según plantillas
4. Frontend llama POST /upload/aeropuertos → recibe token A
5. Frontend llama GET /upload/sesion/{tokenA} hasta estado = "ok"
6. Frontend llama POST /upload/vuelos       → recibe token V
7. Frontend llama GET /upload/sesion/{tokenV} hasta estado = "ok"
8. Frontend llama POST /upload/envios × 30  → recibe 30 tokens
9. Frontend llama GET /upload/sesion/{token} × 30 hasta todos "ok"
10. Frontend llama GET /estado → ve listo_para_simular = true
11. Usuario puede iniciar simulación
```

## 7. Flujo de Error — Rollback

```
Si cualquier INSERT falla durante el procesamiento:
  1. Se marca la sesión como estado = "error"
  2. Se ejecuta DELETE de todos los registros insertados en esa sesión
     (identificados por el token en una tabla de trazabilidad temporal)
  3. Se elimina el archivo temporal
  4. Se guarda el detalle del error en carga_sesiones.detalle_error
  5. Frontend consulta GET /upload/sesion/{token} y muestra el error al usuario
```

---

## 8. Estructura de Carpetas

```
carga-masiva/
├── cmd/
│   └── carga-masiva/
│       └── main.go              # Entry point, configura rutas y servidor
├── internal/
│   ├── handler/
│   │   ├── upload.go            # Handlers POST /upload/*
│   │   ├── estado.go            # Handler GET /estado
│   │   └── plantillas.go        # Handler GET /plantillas/*
│   ├── parser/
│   │   ├── aeropuertos.go       # Parsea aeropuertos.txt línea a línea
│   │   ├── vuelos.go            # Parsea vuelos.txt línea a línea
│   │   └── envios.go            # Parsea _envios_XXXX_.txt + extrae IATA del nombre
│   ├── db/
│   │   ├── conexion.go          # Pool de conexiones MySQL
│   │   ├── aeropuertos.go       # Batch INSERT aeropuertos
│   │   ├── vuelos.go            # Batch INSERT vuelos
│   │   ├── envios.go            # Batch INSERT envios
│   │   └── sesiones.go          # CRUD carga_sesiones
│   └── session/
│       └── token.go             # Genera UUID, controla idempotencia
├── plantillas/
│   ├── aeropuertos_plantilla.txt
│   ├── vuelos_plantilla.txt
│   └── envios_XXXX_plantilla.txt
├── go.mod
└── CARGA-MASIVA.md              # este archivo
```

---

## 9. Variables de Configuración

El servicio lee variables de entorno al arrancar:

| Variable | Valor por defecto | Descripción |
|---|---|---|
| `PORT` | `8082` | Puerto del servicio |
| `DB_HOST` | `localhost` | Host de MySQL |
| `DB_PORT` | `3306` | Puerto de MySQL |
| `DB_NAME` | `tasfb2b` | Nombre de la base de datos |
| `DB_USER` | `tasf` | Usuario MySQL |
| `DB_PASS` | — | Contraseña (obligatoria) |
| `TEMP_DIR` | `/tmp/tasf` | Directorio de archivos temporales |
| `BATCH_SIZE` | `1000` | Registros por lote de INSERT |
| `MAX_UPLOAD_MB` | `50` | Límite de tamaño por archivo subido (MB) |

---

## 10. TODOs

- [ ] Implementar `GET /upload/sesion/{token}` con SSE para progreso en tiempo real (alternativa al polling)
- [ ] Agregar índice compuesto en `envios (origen_iata, fecha_registro)` si el Planificador lo requiere
- [ ] Validar que `vuelos` no tenga ciclos directos (A→B y B→A con tiempos inconsistentes)
- [ ] Revisar si el Planificador necesita la columna `mismo_continente` pre-calculada o la deriva solo
