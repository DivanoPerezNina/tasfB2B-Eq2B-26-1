-- ============================================================
-- Migración: columnas UTC precalculadas + índice en `envios`
-- Para BD YA existente (schema.sql fresco ya las incluye).
-- Ejecutar una vez:  mysql -u USER -p tasfb2b < migration_registro_utc.sql
--
-- IMPORTANTE: tras esta migración, las filas existentes quedan con
-- registro_utc=0 / deadline_utc=0. Para poblarlas, RE-INGESTAR los envíos
-- (re-subir los archivos): la carga masiva ahora calcula ambos valores.
-- (No se pueblan en SQL puro porque la conversión depende del GMT del
--  aeropuerto origen y de la regla de continentes para el deadline.)
-- ============================================================
USE tasfb2b;

ALTER TABLE envios
  ADD COLUMN registro_utc BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN deadline_utc BIGINT NOT NULL DEFAULT 0;

ALTER TABLE envios
  ADD INDEX idx_registro_utc (registro_utc);
