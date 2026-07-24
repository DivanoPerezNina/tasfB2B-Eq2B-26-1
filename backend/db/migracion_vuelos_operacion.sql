-- ============================================================
-- TASF.B2B — Migración: vuelos_operacion (rutas del día a día)
-- Ejecutar: mysql -h localhost -u root -p tasfb2b < migracion_vuelos_operacion.sql
-- ============================================================

USE tasfb2b;

-- ── Rutas de Día a Día ───────────────────────────────────────
-- Mismo shape que `vuelos`, pero SEPARADA a propósito: las rutas que cargan
-- los operarios durante la operación día a día (los "planes de vuelo
-- adicionales" de la prueba) NUNCA deben mezclarse con el catálogo que usan
-- Periodo y Colapso.
--
-- Arranca VACÍA: los operarios cargan sus rutas al empezar el ensayo. Se
-- limpia con TRUNCATE TABLE vuelos_operacion; sin tocar `vuelos`.
--
-- A diferencia de `vuelos`, el planificador SÍ consume esta tabla (vía el
-- servicio Consultas → body de /desde-datos), igual que envios_operacion.
CREATE TABLE IF NOT EXISTS vuelos_operacion (
  id               INT UNSIGNED      AUTO_INCREMENT,
  origen_iata      CHAR(4)           NOT NULL,
  destino_iata     CHAR(4)           NOT NULL,
  salida_minutos   SMALLINT UNSIGNED NOT NULL,   -- minutos desde 00:00 local del ORIGEN (0-1439)
  llegada_minutos  SMALLINT UNSIGNED NOT NULL,   -- ídem local del DESTINO; > salida si cruza medianoche
  capacidad_max    SMALLINT UNSIGNED NOT NULL,
  mismo_continente TINYINT(1)        NOT NULL DEFAULT 0,
  operario_id      INT UNSIGNED      NULL,       -- quién la registró (auditoría; NULL si vino de archivo)
  PRIMARY KEY (id),
  KEY idx_origen  (origen_iata),
  KEY idx_destino (destino_iata),
  FOREIGN KEY (operario_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
