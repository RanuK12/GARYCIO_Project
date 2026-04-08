import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../config/env";
import { logger } from "../config/logger";
import * as schema from "./schema";

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  // SSL requerido en producción (Oracle Cloud, Railway, Supabase, etc.)
  // Si DATABASE_URL ya incluye ?sslmode=disable, esto no aplica
  ssl: env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

pool.on("error", (err) => {
  logger.error(err, "Error inesperado en la conexión a PostgreSQL");
  process.exit(1);
});

export const db = drizzle(pool, { schema });

export async function testConnection(): Promise<boolean> {
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    logger.info("Conexión a PostgreSQL establecida correctamente");
    return true;
  } catch (err) {
    logger.error(err, "No se pudo conectar a PostgreSQL");
    return false;
  }
}
