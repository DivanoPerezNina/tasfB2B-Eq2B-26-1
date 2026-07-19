-- ============================================================
-- TASF.B2B — Migración: usuarios y sesiones (roles admin/operario)
-- Ejecutar contra la BD existente: mysql -h <host> -u Hamilton -p tasfb2b < migracion_usuarios.sql
-- ============================================================

USE tasfb2b;

-- ── Usuarios ─────────────────────────────────────────────────
-- aeropuerto_iata es NULL para admin; para operario referencia el aeropuerto
-- al que está atado. No es UNIQUE: puede haber varios operarios por aeropuerto.
CREATE TABLE IF NOT EXISTS usuarios (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario         VARCHAR(40)  NOT NULL,
  clave_hash      VARCHAR(255) NOT NULL,   -- bcrypt
  rol             ENUM('admin','operario') NOT NULL,
  aeropuerto_iata CHAR(4) NULL,
  activo          TINYINT(1) NOT NULL DEFAULT 1,
  creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_usuario (usuario),
  KEY idx_aeropuerto (aeropuerto_iata)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Sesiones ─────────────────────────────────────────────────
-- Token opaco (32 bytes random en hex). expira_en se revisa en cada request;
-- filas vencidas se limpian de forma perezosa (no hace falta job aparte).
CREATE TABLE IF NOT EXISTS sesiones (
  token      CHAR(64) NOT NULL PRIMARY KEY,
  usuario_id INT UNSIGNED NOT NULL,
  creado_en  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_en  DATETIME NOT NULL,
  KEY idx_usuario (usuario_id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Cuentas semilla ──────────────────────────────────────────
-- Contraseñas en texto plano (rotar luego desde la pantalla de admin cuando
-- exista; por ahora cámbialas con un UPDATE si quieres otras):
--   admin        / Adm1n#Tasf2026
--   operario_spim / Op#Spim2026   (aeropuerto SPIM — Lima, cuenta de prueba)
INSERT INTO usuarios (usuario, clave_hash, rol, aeropuerto_iata) VALUES
  ('admin', '$2a$10$LxVZjqQkqTCTJmy/bLOHve1prHx0i9hWrwX645tN6TFLiU29XNGYq', 'admin', NULL),
  ('operario_spim', '$2a$10$hQgRzQvQXNXavlIOtNBbSuWJ/2qwp5EYHDNkPyoKPtwGFfERqgPvC', 'operario', 'SPIM')
ON DUPLICATE KEY UPDATE usuario = usuario; -- no-op si ya corriste esta migración
