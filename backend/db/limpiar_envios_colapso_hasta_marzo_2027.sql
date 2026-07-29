-- Limpieza única para archivos cargados antes de aplicar el filtro.
-- Conserva todos los envíos desde el inicio del dataset hasta el 31/03/2027 inclusive.
DELETE FROM envios_colapso
WHERE fecha_registro > '2027-03-31';

SELECT COUNT(*) AS total_envios,
       MIN(fecha_registro) AS fecha_min,
       MAX(fecha_registro) AS fecha_max
FROM envios_colapso;
