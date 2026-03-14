import { Pool } from "pg";
import { config } from "dotenv";

config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const migrations = [
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_donante') THEN
      CREATE TYPE estado_donante AS ENUM ('activa', 'inactiva', 'vacaciones', 'baja_medica', 'nueva');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tipo_reclamo') THEN
      CREATE TYPE tipo_reclamo AS ENUM ('regalo', 'falta_bidon', 'nueva_pelela', 'otro');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tipo_aviso') THEN
      CREATE TYPE tipo_aviso AS ENUM ('vacaciones', 'enfermedad', 'medicacion');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_reclamo') THEN
      CREATE TYPE estado_reclamo AS ENUM ('pendiente', 'notificado_chofer', 'seguimiento_enviado', 'escalado_visitadora', 'resuelto');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_camion') THEN
      CREATE TYPE estado_camion AS ENUM ('disponible', 'en_ruta', 'mantenimiento');
    END IF;
  END $$`,

  `CREATE TABLE IF NOT EXISTS zonas (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    descripcion TEXT,
    activa BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS donantes (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    telefono VARCHAR(20) NOT NULL UNIQUE,
    direccion TEXT NOT NULL,
    zona_id INTEGER REFERENCES zonas(id),
    estado estado_donante DEFAULT 'activa',
    dias_recoleccion VARCHAR(100),
    donando_actualmente BOOLEAN DEFAULT true,
    fecha_alta DATE DEFAULT CURRENT_DATE,
    fecha_vuelta_donacion DATE,
    notas TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS choferes (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    telefono VARCHAR(20) NOT NULL UNIQUE,
    licencia VARCHAR(50),
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS peones (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    telefono VARCHAR(20) NOT NULL UNIQUE,
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS camiones (
    id SERIAL PRIMARY KEY,
    patente VARCHAR(20) NOT NULL UNIQUE,
    modelo VARCHAR(100),
    capacidad_litros INTEGER,
    estado estado_camion DEFAULT 'disponible',
    created_at TIMESTAMP DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS visitadoras (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    telefono VARCHAR(20) NOT NULL UNIQUE,
    activa BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS recorridos (
    id SERIAL PRIMARY KEY,
    zona_id INTEGER REFERENCES zonas(id),
    chofer_id INTEGER REFERENCES choferes(id),
    camion_id INTEGER REFERENCES camiones(id),
    fecha DATE NOT NULL,
    orden TEXT,
    completado BOOLEAN DEFAULT false,
    porcentaje_completado DECIMAL(5,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS recorrido_peones (
    id SERIAL PRIMARY KEY,
    recorrido_id INTEGER REFERENCES recorridos(id),
    peon_id INTEGER REFERENCES peones(id)
  )`,

  `CREATE TABLE IF NOT EXISTS recorrido_donantes (
    id SERIAL PRIMARY KEY,
    recorrido_id INTEGER REFERENCES recorridos(id),
    donante_id INTEGER REFERENCES donantes(id),
    orden INTEGER,
    recolectado BOOLEAN DEFAULT false,
    litros DECIMAL(8,2),
    bidones INTEGER,
    hora_recoleccion TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS reclamos (
    id SERIAL PRIMARY KEY,
    donante_id INTEGER NOT NULL REFERENCES donantes(id),
    tipo tipo_reclamo NOT NULL,
    descripcion TEXT,
    estado estado_reclamo DEFAULT 'pendiente',
    chofer_id INTEGER REFERENCES choferes(id),
    visitadora_id INTEGER REFERENCES visitadoras(id),
    fecha_creacion TIMESTAMP DEFAULT NOW(),
    fecha_seguimiento TIMESTAMP,
    fecha_resolucion TIMESTAMP,
    resuelto BOOLEAN DEFAULT false,
    devolucion_visitadora TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS avisos (
    id SERIAL PRIMARY KEY,
    donante_id INTEGER NOT NULL REFERENCES donantes(id),
    tipo tipo_aviso NOT NULL,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE,
    notificacion_vuelta_enviada BOOLEAN DEFAULT false,
    notas TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS registros_recoleccion (
    id SERIAL PRIMARY KEY,
    recorrido_id INTEGER REFERENCES recorridos(id),
    fecha DATE NOT NULL,
    litros_totales DECIMAL(10,2),
    bidones_totales INTEGER,
    foto_comprobante TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS registros_combustible (
    id SERIAL PRIMARY KEY,
    camion_id INTEGER NOT NULL REFERENCES camiones(id),
    chofer_id INTEGER REFERENCES choferes(id),
    fecha DATE NOT NULL,
    litros DECIMAL(8,2),
    monto DECIMAL(10,2),
    foto_comprobante TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS registros_lavado (
    id SERIAL PRIMARY KEY,
    camion_id INTEGER NOT NULL REFERENCES camiones(id),
    fecha DATE NOT NULL,
    foto_comprobante TEXT,
    notas TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS progreso_mensual (
    id SERIAL PRIMARY KEY,
    mes INTEGER NOT NULL,
    anio INTEGER NOT NULL,
    litros_recolectados DECIMAL(12,2) DEFAULT 0,
    objetivo_litros DECIMAL(12,2) DEFAULT 260000,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS mensajes_log (
    id SERIAL PRIMARY KEY,
    telefono VARCHAR(20) NOT NULL,
    tipo VARCHAR(50) NOT NULL,
    contenido TEXT,
    direccion_msg VARCHAR(10) NOT NULL,
    exitoso BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS zona_choferes (
    id SERIAL PRIMARY KEY,
    zona_id INTEGER NOT NULL REFERENCES zonas(id),
    chofer_id INTEGER NOT NULL REFERENCES choferes(id),
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(zona_id, chofer_id)
  )`,

  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tipo_incidente') THEN
      CREATE TYPE tipo_incidente AS ENUM ('accidente', 'retraso', 'averia', 'robo', 'clima', 'otro');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gravedad_incidente') THEN
      CREATE TYPE gravedad_incidente AS ENUM ('baja', 'media', 'alta', 'critica');
    END IF;
  END $$`,

  `CREATE TABLE IF NOT EXISTS incidentes (
    id SERIAL PRIMARY KEY,
    chofer_id INTEGER REFERENCES choferes(id),
    tipo tipo_incidente NOT NULL,
    gravedad gravedad_incidente DEFAULT 'media',
    descripcion TEXT NOT NULL,
    zona_id INTEGER REFERENCES zonas(id),
    notificado_ceo BOOLEAN DEFAULT false,
    resuelto BOOLEAN DEFAULT false,
    fecha TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
  )`,
];

async function migrate(): Promise<void> {
  const client = await pool.connect();
  console.log("Ejecutando migraciones...\n");

  try {
    await client.query("BEGIN");

    for (const sql of migrations) {
      const preview = sql.slice(0, 60).replace(/\n/g, " ");
      console.log(`  -> ${preview}...`);
      await client.query(sql);
    }

    await client.query("COMMIT");
    console.log("\nMigraciones ejecutadas correctamente.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error en migraciones:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
