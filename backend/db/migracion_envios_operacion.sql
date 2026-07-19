-- ============================================================
-- TASF.B2B — Migración: envios_operacion (día a día)
-- Ejecutar: mysql -h localhost -u root -p tasfb2b < migracion_envios_operacion.sql
-- ============================================================

USE tasfb2b;

-- ── Envíos de Día a Día ──────────────────────────────────────
-- Mismo shape que `envios`, pero SEPARADA a propósito: los registros que
-- entran los operarios durante la operación día a día NUNCA deben mezclarse
-- con el dataset histórico/proyectado que usan Periodo y Colapso.
-- Se limpia entre ensayos con TRUNCATE TABLE envios_operacion; (instantáneo,
-- no toca `envios` para nada).
CREATE TABLE IF NOT EXISTS envios_operacion (
  id_envio         VARCHAR(20)       NOT NULL,
  origen_iata      CHAR(4)           NOT NULL,
  fecha_registro   DATE              NOT NULL,
  hora             TINYINT UNSIGNED  NOT NULL,
  minuto           TINYINT UNSIGNED  NOT NULL,
  destino_iata     CHAR(4)           NOT NULL,
  cantidad_maletas SMALLINT UNSIGNED NOT NULL,
  id_cliente       INT UNSIGNED      NOT NULL,
  registro_utc     BIGINT            NOT NULL,
  deadline_utc     BIGINT            NOT NULL,
  operario_id      INT UNSIGNED      NULL,   -- quién lo registró (auditoría; NULL si vino de archivo)
  PRIMARY KEY (id_envio, origen_iata),
  KEY idx_registro_utc (registro_utc),
  FOREIGN KEY (operario_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
