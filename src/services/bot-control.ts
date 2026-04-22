/**
 * Bot Control Service
 * 
 * Proporciona:
 * - Modo PAUSA: responde "en mantenimiento" a todos los no-admins
 * - Whitelist progresiva: controla cuántos donantes pueden usar el bot
 * - Kill switch: detecta errores críticos y notifica admins
 * - Estado del bot: running, paused, emergency_stop
 */

import { env } from "../config/env";
import { logger } from "../config/logger";
import { db } from "../database";
import { difusionEnvios } from "../database/schema";
import { eq, and } from "drizzle-orm";
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

// Estado en memoria (persiste mientras el proceso vive)
let botState: BotState = {
  status: "running",
  pausedAt: null,
  pausedBy: null,
  pauseReason: null,
  whitelistLimit: 0, // 0 = sin límite (full)
  whitelistActive: env.TEST_MODE,
  emergencyStopAt: null,
  emergencyStopReason: null,
  startedAt: new Date(),
  lastHealthCheck: new Date(),
};

// Cache de whitelist en memoria (teléfonos permitidos)
let whitelistCache: Set<string> | null = null;
let whitelistCacheTime = 0;
const WHITELIST_CACHE_TTL = 60_000; // 1 minuto

// Admin phones set (para chequeos rápidos)
const adminPhonesSet = new Set(
  env.ADMIN_PHONES.split(",").map((p) => normalizePhone(p.trim())).filter(Boolean)
);

export function getBotState(): BotState {
  return { ...botState };
}

export function isAdminPhone(phone: string): boolean {
  return adminPhonesSet.has(normalizePhone(phone));
}

/**
 * Pausar el bot. Los admins siguen funcionando, los demás reciben
 * mensaje de mantenimiento.
 */
export function pauseBot(by: string, reason: string): void {
  botState.status = "paused";
  botState.pausedAt = new Date();
  botState.pausedBy = by;
  botState.pauseReason = reason;
  logger.warn({ by, reason }, "Bot PAUSADO");
}

/**
 * Reanudar el bot.
 */
export function resumeBot(by: string): void {
  botState.status = "running";
  botState.pausedAt = null;
  botState.pausedBy = null;
  botState.pauseReason = null;
  logger.info({ by }, "Bot REANUDADO");
}

/**
 * Emergency stop: detener completamente, notificar admins.
 * Requiere reinicio manual.
 */
export function emergencyStop(reason: string): void {
  botState.status = "emergency_stop";
  botState.emergencyStopAt = new Date();
  botState.emergencyStopReason = reason;
  logger.fatal({ reason }, "EMERGENCY STOP ACTIVADO");
  notifyAdminsEmergency(reason);
}

/**
 * Verificar si el bot está pausado para un número específico.
 * Los admins nunca están pausados.
 */
export function isPausedFor(phone: string): boolean {
  if (botState.status === "emergency_stop") return true;
  if (botState.status !== "paused") return false;
  return !isAdminPhone(phone);
}

/**
 * Mensaje de pausa/mantenimiento.
 */
export function getPauseMessage(): string {
  return "ð§ Estamos realizando tareas de mantenimiento momentáneas.\n\n" +
    "Por favor, intentá comunicarte más tarde.\n\n" +
    "Disculpen las molestias. ð";
}

/**
 * Establecer límite de whitelist progresiva.
 * 0 = sin límite (todos permitidos)
 * N = solo los primeros N donantes de difusion_envios
 */
export async function setWhitelistLimit(limit: number): Promise<void> {
  botState.whitelistLimit = Math.max(0, limit);
  botState.whitelistActive = limit > 0 || env.TEST_MODE;
  whitelistCache = null; // Invalidar cache
  logger.info({ limit }, "Whitelist limit actualizado");
}

export function getWhitelistLimit(): number {
  return botState.whitelistLimit;
}

export function isWhitelistActive(): boolean {
  return botState.whitelistActive;
}

/**
 * Verificar si un número está en la whitelist.
 * Si whitelist no está activa, todos pasan.
 * Los admins siempre pasan.
 */
export async function isWhitelisted(phone: string): Promise<boolean> {
  const normalized = normalizePhone(phone);
  
  // Admins siempre pasan
  if (isAdminPhone(normalized)) return true;
  
  // Si no hay whitelist activa, todos pasan
  if (!botState.whitelistActive) return true;
  
  // Si test mode con whitelist manual
  if (env.TEST_MODE && env.TEST_PHONES) {
    const testPhones = new Set(env.TEST_PHONES.split(",").map((p) => normalizePhone(p.trim())));
    if (testPhones.has(normalized)) return true;
  }
  
  // Whitelist progresiva desde DB
  const limit = botState.whitelistLimit;
  if (limit <= 0) return true; // Sin límite = todos
  
  // Cargar cache si es necesario
  await loadWhitelistCache(limit);
  
  return whitelistCache?.has(normalized) ?? false;
}

/**
 * Cargar teléfonos permitidos desde difusion_envios, limitados a N.
 */
async function loadWhitelistCache(limit: number): Promise<void> {
  const now = Date.now();
  if (whitelistCache && now - whitelistCacheTime < WHITELIST_CACHE_TTL) {
    return;
  }
  
  try {
    const rows = await db
      .select({ telefono: difusionEnvios.telefono })
      .from(difusionEnvios)
      .limit(limit);
    
    whitelistCache = new Set(rows.map((r) => normalizePhone(r.telefono)));
    whitelistCacheTime = now;
    logger.debug({ count: whitelistCache.size, limit }, "Whitelist cache cargada");
  } catch (err) {
    logger.error({ err }, "Error cargando whitelist cache");
    // En caso de error, permitir todos (fail-open para no bloquear)
    whitelistCache = null;
  }
}

/**
 * Notificar a todos los admins vía WhatsApp de emergencia.
 */
async function notifyAdminsEmergency(reason: string): Promise<void> {
  const adminPhones = env.ADMIN_PHONES.split(",").map((p) => p.trim()).filter(Boolean);
  const msg = `ð¨ *GARYCIO EMERGENCY STOP* ð¨\n\n` +
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

/**
 * Notificar a admins de un error crítico (pero no detener el bot).
 */
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

/**
 * Plan de rollout progresivo predefinido.
 */
export const ROLLOUT_PLAN = [
  { day: 1, label: "Día 1 - Primeros 1,000", limit: 1000 },
  { day: 2, label: "Día 2 - 2,000", limit: 2000 },
  { day: 3, label: "Día 3 - 4,000", limit: 4000 },
  { day: 4, label: "Día 4 - 7,000", limit: 7000 },
  { day: 5, label: "Día 5 - Full rollout", limit: 0 },
];
