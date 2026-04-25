-- P0.6 — Alinear ownership de tablas a rol `garycio`.
-- Contexto: durante el incidente 2026-04-22, inserts fallaron con
-- `permission denied for table ia_training_examples` porque la tabla
-- había sido creada por `postgres` en lugar del rol de la aplicación.
--
-- Ejecutar como superusuario en el servidor:
--   sudo -u postgres psql -d garycio -f fix-table-ownership.sql

ALTER TABLE IF EXISTS public.ia_training_examples OWNER TO garycio;
ALTER TABLE IF EXISTS public.audio_mensajes       OWNER TO garycio;

-- Cinturón y tiradores: reasigna CUALQUIER tabla/secuencia/índice de
-- postgres a garycio en el schema public. Idempotente.
REASSIGN OWNED BY postgres TO garycio;

-- Permisos por defecto para futuras tablas creadas por superusuario.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO garycio;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO garycio;

-- Verificación
SELECT schemaname, tablename, tableowner
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tableowner, tablename;
