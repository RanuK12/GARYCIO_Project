import { config } from "dotenv";
import { z } from "zod";

config();

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),
  DB_HOST: z.string().default("localhost"),
  DB_PORT: z.coerce.number().default(5432),
  DB_NAME: z.string().default("garycio"),
  DB_USER: z.string(),
  DB_PASSWORD: z.string(),

  // WhatsApp Cloud API
  WHATSAPP_TOKEN: z.string().min(1),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().default(""),
  WHATSAPP_API_VERSION: z.string().default("v21.0"),

  // App
  CEO_PHONE: z.string().min(8),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.string().default("info"),

  // WhatsApp Business Phone (el número real)
  WHATSAPP_BUSINESS_PHONE: z.string().default("5491171560000"),

  // Rate limiting & queue
  SEND_RATE_PER_SECOND: z.coerce.number().default(30),
  MAX_RETRIES: z.coerce.number().default(3),

  // Geocoding (Nominatim gratuito por defecto)
  GEOCODING_BASE_URL: z.string().default("https://nominatim.openstreetmap.org"),
  GEOCODING_COUNTRY: z.string().default("ar"),
  GEOCODING_RATE_MS: z.coerce.number().default(1100),

  // Galpón / Punto de partida y llegada de los camiones
  GALPON_DIRECCION: z.string().default("Murature 3820, Villa Lynch, Provincia de Buenos Aires"),
  GALPON_LAT: z.coerce.number().default(-34.5944),
  GALPON_LON: z.coerce.number().default(-58.5339),

  // Ituran GPS tracking (SOAP Web Service)
  ITURAN_USER: z.string().default(""),
  ITURAN_PASSWORD: z.string().default(""),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Variables de entorno inválidas:", parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
