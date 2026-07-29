-- Dataset independiente para Periodo 3D/5D/7D y Colapso.
-- Conserva la tabla envios original sin modificarla.
CREATE TABLE IF NOT EXISTS envios_colapso LIKE envios;

-- Asegurar el índice usado por Consultas para leer ventanas de tiempo.
-- CREATE TABLE ... LIKE copia índices; esta validación ayuda a comprobarlo.
SHOW INDEX FROM envios_colapso;
