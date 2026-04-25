/**
 * Setup global de Jest.
 *
 * Ejecuta ANTES de importar cualquier módulo del proyecto — setea las
 * variables de entorno que exige `src/config/env.ts` para que el logger
 * de pino no explote con "default level undefined".
 *
 * Los tests que necesiten overrides específicos pueden seguir seteando
 * `process.env.X = ...` al principio de su archivo; eso tiene prioridad.
 */

process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
process.env.TEST_MODE = process.env.TEST_MODE ?? "false";
process.env.WHATSAPP_PROVIDER = process.env.WHATSAPP_PROVIDER ?? "360dialog";
process.env.WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN ?? "fake-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "fake-phone-id";
process.env.WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN ?? "fake-verify";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://fake:fake@localhost:5432/fake";
process.env.DB_USER = process.env.DB_USER ?? "fake";
process.env.DB_PASSWORD = process.env.DB_PASSWORD ?? "fake";
process.env.CEO_PHONE = process.env.CEO_PHONE ?? "393445721753";
process.env.ADMIN_API_KEY = process.env.ADMIN_API_KEY ?? "1234567890abcdef1234";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "fake-openai";
process.env.ADMIN_PHONES = process.env.ADMIN_PHONES ?? "393445721753";
