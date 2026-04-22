import { config } from "dotenv";
import { z } from "zod";

config();

// z.coerce.boolean() convierte cualquier string no-vacío a true (incluso "false").
// Este helper parsea correctamente: "false"/"0"/"" → false, resto → true.
const booleanFromEnv = z
  .string()
  .transform((v) => !["false", "0", ""].includes(v.toLowerCase()))
  .or(z.boolean())
  .default(false);

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
  WHATSAPP_API_VERSION: z.string().default("v22.0"),
  // Proveedor de WhatsApp API: "meta" (directo) o "360dialog"
  // Con 360dialog: WHATSAPP_TOKEN = tu D360-API-KEY
  WHATSAPP_PROVIDER: z.enum(["meta", "360dialog"]).default("meta"),

  // App
  CEO_PHONE: z.string().min(8),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.string().default("info"),

  // WhatsApp Business Phone (el número real)
  WHATSAPP_BUSINESS_PHONE: z.string().default(""),

  // API Key para proteger endpoints /admin/*
  ADMIN_API_KEY: z.string().min(16),

  // Difusión: usar template aprobado por Meta (categoría utility = más barato)
  // false = texto libre (marketing, más caro), true = template "recoleccion_aviso" (utility)
  DIFUSION_USE_TEMPLATE: booleanFromEnv,
  // Template mañana (3 vars: {{1}}=nombre, {{2}}=días, {{3}}=horario) — para horario < 12:00
  DIFUSION_TEMPLATE_NAME: z.string().default("recoleccion_aviso1"),
  // Template tarde (2 vars: {{1}}=nombre, {{2}}=días) — para horario >= 12:00 o sin horario
  DIFUSION_TEMPLATE_NAME_TARDE: z.string().default("recoleccion_aviso_tarde"),

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

  // Ituran GPS tracking (SOAP Web Service - posiciones real-time)
  ITURAN_USER: z.string().default(""),
  ITURAN_PASSWORD: z.string().default(""),

  // Ituran REST API (viajes/trips)
  ITURAN_API_USER: z.string().default(""),
  ITURAN_API_PASSWORD: z.string().default(""),
  ITURAN_API_URL: z.string().default("https://web2.ituran.com.ar/ibi2_services/tripsData.svc/GetTripsByDateDriverNVehicleNTripID"),

  // Admin phones para alertas CEO (comma-separated)
  ADMIN_PHONES: z.string().default(""),

  // Límite de velocidad para alertas (km/h)
  SPEED_LIMIT_KMH: z.coerce.number().default(80),

  // Test mode: solo permite envíos a números en la whitelist
  TEST_MODE: booleanFromEnv,
  TEST_PHONES: z.string().default(""),  // comma-separated, ej: "393445721753,5491126330388"

  // IA Classifier (OpenAI GPT-4o-mini para clasificación de intenciones)
  OPENAI_API_KEY: z.string().default(""),
  AI_CLASSIFIER_ENABLED: booleanFromEnv,
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Variables de entorno inválidas:", parsed.error.flatten().fieldErrors);
    // En modo test no matar el proceso para permitir tests unitarios sin .env completo
    if (process.env.NODE_ENV === "test") {
      console.warn("Modo test detectado — continuando con valores parciales/defaults");
      return (parsed.data ?? {}) as unknown as Env;
    }
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
