/**
 * Bot Control Service
 */
import { env } from "../config/env";
import { logger } from "../config/logger";
import { db } from "../database";
import { configuracionSistema, donantesBotActivos } from "../database/schema";
import { eq, count, sql } from "drizzle-orm";
import { sendMessage } from "../bot/client";
import { normalizePhone } from "../utils/phone";

export type BotStatus = "running" | "paused" | "emergency_stop";

interface BotState {
  status: BotStatus;
  pausedAt: Date | null;
  pausedBy: string | null;
  pauseReason: string | null;
  whitelistLimit: number;
  whitelistActive: boolean;
  emergencyStopAt: Date | null;
  emergencyStopReason: string | null;
  startedAt: Date;
  lastHealthCheck: Date;
}

let botState: BotState = {
  status: "running",
  pausedAt: null,
  pausedBy: null,
  pauseReason: null,
  whitelistLimit: 0,
  whitelistActive: env.TEST_MODE,
  emergencyStopAt: null,
  emergencyStopReason: null,
  startedAt: new Date(),
  lastHealthCheck: new Date(),
};

let whitelistCache: Set<string> | null = null;
let whitelistCacheTime = 0;
const WHITELIST_CACHE_TTL = 60_000;

const adminPhonesSet = new Set(
  env.ADMIN_PHONES.split(",").map((p) => normalizePhone(p.trim())).filter(Boolean)
);

export function getBotState(): BotState { return { ...botState }; }
export function isAdminPhone(phone: string): boolean { return adminPhonesSet.has(normalizePhone(phone)); }

export function pauseBot(by: string, reason: string): void {
  botState.status = "paused";
  botState.pausedAt = new Date();
  botState.pausedBy = by;
  botState.pauseReason = reason;
  logger.warn({ by, reason }, "Bot PAUSADO");
}

export function resumeBot(by: string): void {
  botState.status = "running";
  botState.pausedAt = null;
  botState.pausedBy = null;
  botState.pauseReason = null;
  logger.info({ by }, "Bot REANUDADO");
}

export function emergencyStop(reason: string): void {
  botState.status = "emergency_stop";
  botState.emergencyStopAt = new Date();
  botState.emergencyStopReason = reason;
  logger.fatal({ reason }, "EMERGENCY STOP ACTIVADO");
  notifyAdminsEmergency(reason);
}

export function isPausedFor(phone: string): boolean {
  if (botState.status === "emergency_stop") return true;
  if (botState.status !== "paused") return false;
  return !isAdminPhone(phone);
}

export function getPauseMessage(): string {
  return "🔧 Estamos realizando tareas de mantenimiento momentáneas.\n\n" +
    "Por favor, intentá comunicarte más tarde.\n\n" +
    "Disculpen las molestias. 🙏";
}

export function getCapacidadMessage(): string {
  return "Disculpe, en este momento estamos atendiendo la máxima cantidad de consultas.\n\n" +
    "Un colega se pondrá en contacto con usted a la brevedad. 🙏";
}

export async function getCapacidad(): Promise<{ activos: number; limite: number; disponibles: number }> {
  try {
    const limiteRow = await db.select().from(configuracionSistema).where(eq(configuracionSistema.clave, "LIMITE_DONANTES_BOT")).limit(1);
    const limite = parseInt(limiteRow[0]?.valor || "1000", 10);
    const countResult = await db.select({ value: count() }).from(donantesBotActivos).where(eq(donantesBotActivos.estado, "activo"));
    const activos = countResult[0]?.value ?? 0;
    return { activos, limite, disponibles: Math.max(0, limite - activos) };
  } catch (err) {
    logger.error({ err }, "Error leyendo capacidad");
    return { activos: 0, limite: 1000, disponibles: 1000 };
  }
}

export async function ajustarLimiteDonantes(nuevoLimite: number): Promise<void> {
  const limit = Math.max(0, nuevoLimite);
  await db.insert(configuracionSistema)
    .values({ clave: "LIMITE_DONANTES_BOT", valor: String(limit), actualizadoEn: new Date() })
    .onConflictDoUpdate({
      target: configuracionSistema.clave,
      set: { valor: String(limit), actualizadoEn: new Date() },
    });
  logger.info({ limit }, "Límite de donantes actualizado");
}

/**
 * Activa una donante en el bot, atómicamente:
 *  - Si ya está, retorna true.
 *  - Si no, lockea la tabla, recuenta activas, y solo inserta si hay
 *    cupo. Sin esto, dos inbounds simultáneos podían pasar el check
 *    y terminar en cap+1 (caso real: 11 vs 10).
 */
export async function activarDonanteBot(phone: string, nombre?: string): Promise<boolean> {
  const normalized = normalizePhone(phone);
  if (!normalized) return false;
  try {
    return await db.transaction(async (tx) => {
      // Lock pesado en la tabla. Inserts/updates a `donantes_bot_activos`
      // se serializan mientras dure la tx. Es lo que evita el race del
      // cap+1 que vimos en producción.
      await tx.execute(sql`LOCK TABLE donantes_bot_activos IN SHARE ROW EXCLUSIVE MODE`);

      const existente = await tx
        .select()
        .from(donantesBotActivos)
        .where(eq(donantesBotActivos.telefono, normalized))
        .limit(1);

      if (existente.length > 0 && existente[0].estado === "activo") return true;
      if (existente.length > 0) {
        await tx
          .update(donantesBotActivos)
          .set({ estado: "activo", activadoEn: new Date() })
          .where(eq(donantesBotActivos.telefono, normalized));
        return true;
      }

      // Recuento + límite leídos DENTRO de la tx con el lock activo.
      const limiteRow = await tx
        .select()
        .from(configuracionSistema)
        .where(eq(configuracionSistema.clave, "LIMITE_DONANTES_BOT"))
        .limit(1);
      const limite = parseInt(limiteRow[0]?.valor || "1000", 10);

      const countResult = await tx
        .select({ value: count() })
        .from(donantesBotActivos)
        .where(eq(donantesBotActivos.estado, "activo"));
      const activos = countResult[0]?.value ?? 0;

      if (activos >= limite) {
        logger.info({ phone: normalized, activos, limite }, "Cap lleno — silencio total");
        return false;
      }

      await tx.insert(donantesBotActivos).values({
        telefono: normalized,
        nombre: nombre || null,
        activadoEn: new Date(),
        estado: "activo",
      });
      logger.info({ phone: normalized, activos: activos + 1, limite }, "Nuevo donante activado en el bot");
      return true;
    });
  } catch (err) {
    logger.error({ phone: normalized, err }, "Error activando donante");
    return false;
  }
}

export async function liberarDonanteBot(phone: string): Promise<void> {
  const normalized = normalizePhone(phone);
  if (!normalized) return;
  await db.update(donantesBotActivos)
    .set({ estado: "liberado" })
    .where(eq(donantesBotActivos.telefono, normalized));
  logger.info({ phone: normalized }, "Donante liberado");
}

export async function isWhitelisted(phone: string): Promise<boolean> {
  const normalized = normalizePhone(phone);
  if (isAdminPhone(normalized)) return true;

  // P0.1 — TEST_MODE: solo TEST_PHONES (todos los demás → false). Defensa fuerte.
  if (env.TEST_MODE) {
    if (env.TEST_PHONES) {
      const testPhones = new Set(
        env.TEST_PHONES.split(",").map((p) => normalizePhone(p.trim())),
      );
      if (testPhones.has(normalized)) return true;
    }
    return false;
  }

  // FUERA de TEST_MODE: la única política válida es chequear capacidad
  // contra `LIMITE_DONANTES_BOT` (DB) atómicamente. Eliminada la rama
  // legacy `whitelistActive && whitelistLimit<=0 → return true` que
  // dejaba pasar a TODOS sin chequear capacidad.
  return await activarDonanteBot(normalized);
}

export async function setWhitelistLimit(limit: number): Promise<void> {
  botState.whitelistLimit = Math.max(0, limit);
  botState.whitelistActive = limit > 0 || env.TEST_MODE;
  whitelistCache = null;
  logger.info({ limit }, "Whitelist limit actualizado (legacy)");
}

export function getWhitelistLimit(): number { return botState.whitelistLimit; }
export function isWhitelistActive(): boolean { return botState.whitelistActive; }

async function notifyAdminsEmergency(reason: string): Promise<void> {
  const adminPhones = env.ADMIN_PHONES.split(",").map((p) => p.trim()).filter(Boolean);
  const msg = `🚨 *GARYCIO EMERGENCY STOP* 🚨\n\n` +
    `El bot fue detenido automáticamente.\n` +
    `Razón: ${reason}\n` +
    `Hora: ${new Date().toISOString()}\n\n` +
    `⚠️ Reinicio manual requerido.\n` +
    `NO se reiniciará automáticamente.`;
  for (const phone of adminPhones) {
    await sendMessage(phone, msg).catch((err) => {
      logger.error({ phone, err }, "Fallo notificación de emergencia");
    });
  }
}

export async function notifyAdminsCritical(error: string, context?: Record<string, unknown>): Promise<void> {
  const adminPhones = env.ADMIN_PHONES.split(",").map((p) => p.trim()).filter(Boolean);
  const ctx = context ? `\nContexto: ${JSON.stringify(context).slice(0, 200)}` : "";
  const msg = `⚠️ *GARYCIO Error Crítico*\n\n` +
    `Error: ${error.slice(0, 300)}${ctx}\n\n` +
    `Hora: ${new Date().toISOString()}\n\n` +
    `El bot sigue corriendo pero requiere atención.`;
  for (const phone of adminPhones) {
    await sendMessage(phone, msg).catch(() => {});
  }
}

export const ROLLOUT_PLAN = [
  { day: 1, label: "Día 1 - Primeros 1,000", limit: 1000 },
  { day: 2, label: "Día 2 - 2,000", limit: 2000 },
  { day: 3, label: "Día 3 - 4,000", limit: 4000 },
  { day: 4, label: "Día 4 - 7,000", limit: 7000 },
  { day: 5, label: "Día 5 - Full rollout", limit: 0 },
];
