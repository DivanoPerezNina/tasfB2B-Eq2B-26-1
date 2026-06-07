-- ============================================================
-- TASF.B2B — Schema MySQL
-- Ejecutar una sola vez: mysql -u tasf -p tasfb2b < schema.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS tasfb2b
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE tasfb2b;

-- ── Aeropuertos ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS aeropuertos (
  id                SMALLINT UNSIGNED NOT NULL,
  iata              CHAR(4)           NOT NULL,
  ciudad            VARCHAR(60)       NOT NULL,
  pais              VARCHAR(60)       NOT NULL,
  alias             CHAR(4)           NOT NULL DEFAULT '',
  gmt_offset        TINYINT           NOT NULL,
  capacidad_almacen SMALLINT UNSIGNED NOT NULL,
  latitud           DECIMAL(10,7)     NOT NULL,  -- rango -90..90 con 7 decimales
  longitud          DECIMAL(11,7)     NOT NULL,  -- rango -180..180 con 7 decimales
  continente        TINYINT UNSIGNED  NOT NULL,  -- 1=América 2=Europa 3=Asia
  PRIMARY KEY (id),
  UNIQUE KEY uq_iata (iata)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Vuelos ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vuelos (
  id               INT UNSIGNED      AUTO_INCREMENT,
  origen_iata      CHAR(4)           NOT NULL,
  destino_iata     CHAR(4)           NOT NULL,
  salida_minutos   SMALLINT UNSIGNED NOT NULL,   -- minutos desde 00:00 UTC (0-1439)
  llegada_minutos  SMALLINT UNSIGNED NOT NULL,   -- ídem; > salida si cruza medianoche
  capacidad_max    SMALLINT UNSIGNED NOT NULL,
  mismo_continente TINYINT(1)        NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_origen  (origen_iata),
  KEY idx_destino (destino_iata)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Envíos ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS envios (
  id_envio         VARCHAR(20)       NOT NULL,
  origen_iata      CHAR(4)           NOT NULL,
  fecha_registro   DATE              NOT NULL,
  hora             TINYINT UNSIGNED  NOT NULL,
  minuto           TINYINT UNSIGNED  NOT NULL,
  destino_iata     CHAR(4)           NOT NULL,
  cantidad_maletas SMALLINT UNSIGNED NOT NULL,
  id_cliente       INT UNSIGNED      NOT NULL,
  -- Tiempos UTC PRECALCULADOS en la carga masiva (minutos absolutos desde Epoch).
  -- registro_utc = fecha/hora local del origen convertida a UTC restando su GMT.
  -- deadline_utc = registro_utc + 1440 (mismo continente) o + 2880 (distinto).
  -- Así el Planificador NO recalcula la conversión horaria por cada envío, y la
  -- ingesta incremental por bloques de tiempo se hace con un query indexado.
  registro_utc     BIGINT            NOT NULL DEFAULT 0,
  deadline_utc     BIGINT            NOT NULL DEFAULT 0,
  PRIMARY KEY (id_envio, origen_iata),
  KEY idx_origen_envio  (origen_iata),
  KEY idx_destino_envio (destino_iata),
  KEY idx_fecha         (fecha_registro),
  KEY idx_registro_utc  (registro_utc)   -- consumo incremental: WHERE registro_utc >= H_prev AND < H
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Metadatos del dataset ────────────────────────────────────
-- Almacena valores calculados (rango de fechas, totales) para
-- no recalcular en cada petición.
CREATE TABLE IF NOT EXISTS dataset_meta (
  clave        VARCHAR(50)   NOT NULL,
  valor        VARCHAR(50)   NOT NULL,
  calculado_en DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (clave)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Sesiones de carga ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS carga_sesiones (
  token            CHAR(36)          NOT NULL,
  tipo             ENUM('aeropuertos','vuelos','envios') NOT NULL,
  archivo          VARCHAR(120)      NOT NULL,
  estado           ENUM('recibido','procesando','ok','error') NOT NULL DEFAULT 'recibido',
  registros_total  INT UNSIGNED      NOT NULL DEFAULT 0,
  registros_ok     INT UNSIGNED      NOT NULL DEFAULT 0,
  detalle_error    TEXT              NULL,
  creado_en        DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en   DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
