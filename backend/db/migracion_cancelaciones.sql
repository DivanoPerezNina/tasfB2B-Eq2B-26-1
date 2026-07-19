-- ============================================================
-- Migración: soporte de cancelaciones de vuelo
-- Ejecutar una vez sobre una BD tasfb2b ya existente:
--   mysql -u tasf -p tasfb2b < backend/db/migracion_cancelaciones.sql
-- (Si recreas la BD desde schema.sql, esto ya está incluido allí.)
-- ============================================================
USE tasfb2b;

-- Tabla de cancelaciones (efímera: el ejecutor la vacía al terminar el escenario).
CREATE TABLE IF NOT EXISTS cancelaciones (
  id           INT UNSIGNED AUTO_INCREMENT,
  origen_iata  CHAR(4) NOT NULL,
  destino_iata CHAR(4) NOT NULL,
  salida_utc   BIGINT  NOT NULL,   -- minuto UTC absoluto de la salida de la ocurrencia
  PRIMARY KEY (id),
  KEY idx_cancel_salida (salida_utc)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- carga_sesiones: agregar 'cancelaciones' al ENUM (CREATE TABLE IF NOT EXISTS no
-- modifica una tabla ya existente, por eso el ALTER explícito).
ALTER TABLE carga_sesiones
  MODIFY tipo ENUM('aeropuertos','vuelos','envios','cancelaciones') NOT NULL;
