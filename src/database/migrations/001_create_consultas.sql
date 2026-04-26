-- Migración: tabla de consultas de donantes
-- Fecha: 2026-04-26
-- Descripción: Registra consultas que el bot no pudo resolver automáticamente
--              para que el equipo operativo las atienda.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_consulta') THEN
    CREATE TYPE estado_consulta AS ENUM ('pendiente', 'respondida', 'escalada');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS consultas (
  id SERIAL PRIMARY KEY,
  telefono VARCHAR(20) NOT NULL,
  nombre_donante VARCHAR(150),
  mensaje TEXT NOT NULL,
  tipo VARCHAR(50) NOT NULL DEFAULT 'general',
  respuesta_bot TEXT,
  estado estado_consulta NOT NULL DEFAULT 'pendiente',
  notas TEXT,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
  resolved_at TIMESTAMP WITHOUT TIME ZONE,
  resolved_by VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_consultas_estado ON consultas(estado);
CREATE INDEX IF NOT EXISTS idx_consultas_telefono ON consultas(telefono);
CREATE INDEX IF NOT EXISTS idx_consultas_created_at ON consultas(created_at DESC);
