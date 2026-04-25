/**
 * P0.10 — Detección de intervención humana y pausa del bot.
 *
 * Política: si un humano (agente en dashboard 360dialog, admin desde la
 * WhatsApp Business App, comando manual, etc.) envía un mensaje saliente
 * a una donante, el bot se silencia para ese teléfono por `PAUSE_TTL_MS`.
 * Cada nuevo mensaje humano refresca el TTL. Cuando expira sin más
 * intervención, el bot vuelve a responder al próximo inbound.
 *
 * Detección:
 * - Toda llamada a `sendMessage` exitosa registra el messageId en
 *   `botSentIds` (TTL 2h). Es lo que el bot "sabe que mandó él".
 * - El webhook recibe `statuses` eventos para TODO mensaje saliente —
 *   los del bot y los de humanos. Si llega un status con un messageId
 *   que NO está en `botSentIds` → lo mandó un humano → pausar bot.
 * - El webhook también puede pasarnos `messages` con `from` = nuestro
 *   número (dual-user 360dialog). Mismo criterio.
 *
 * Preserva `human_escalations`: si una donante ya está escalada
 * formalmente, seguimos respetándolo. Este módulo es ortogonal —
 * pausa automática por detección pasiva de actividad humana.
 */

import { logger } from "../config/logger";

const PAUSE_TTL_MS = 30 * 60 * 1000;   // 30 min sin mensaje humano → bot re-engage
const BOT_SENT_TTL_MS = 2 * 60 * 60 * 1000; // 2h es más que suficiente para status tracking
const MAX_BOT_SENT_IDS = 5000;

interface PauseEntry {
  pausedUntil: number;
  reason: string;
}

const pausedPhones = new Map<string, PauseEntry>();
const botSentIds = new Map<string, number>(); // messageId → expiresAt

function purgeExpired(now = Date.now()): void {
  for (const [phone, entry] of pausedPhones) {
    if (entry.pausedUntil < now) pausedPhones.delete(phone);
  }
  for (const [id, exp] of botSentIds) {
    if (exp < now) botSentIds.delete(id);
  }
}

setInterval(() => purgeExpired(), 5 * 60 * 1000).unref?.();

/** Llamar desde `sendMessage` cuando la API retorna OK con el messageId. */
export function registerBotSentMessage(messageId: string | undefined | null): void {
  if (!messageId) return;
  if (botSentIds.size >= MAX_BOT_SENT_IDS) {
    const oldestKey = botSentIds.keys().next().value;
    if (oldestKey !== undefined) botSentIds.delete(oldestKey);
  }
  botSentIds.set(messageId, Date.now() + BOT_SENT_TTL_MS);
}

/**
 * Llamar desde el webhook cada vez que se observa un evento saliente
 * (status o message.from = nuestro número). Si el messageId no está
 * registrado como enviado por el bot → es humano → pausar.
 */
export function notifyOutboundSeen(phone: string, messageId: string | undefined | null): void {
  if (!phone || !messageId) return;
  const expiresAt = botSentIds.get(messageId);
  if (expiresAt && expiresAt > Date.now()) {
    // Conocido: lo mandó el bot. No hacer nada.
    return;
  }
  // Desconocido: lo mandó un humano (dashboard, Business App, etc.)
  pauseBotForPhone(phone, "human-outbound-detected");
}

export function pauseBotForPhone(phone: string, reason: string, ttlMs = PAUSE_TTL_MS): void {
  const prev = pausedPhones.get(phone);
  const wasPaused = prev && prev.pausedUntil > Date.now();
  pausedPhones.set(phone, { pausedUntil: Date.now() + ttlMs, reason });
  if (!wasPaused) {
    logger.warn({ phone, reason, ttlMinutes: Math.round(ttlMs / 60_000) }, "Bot PAUSADO por intervención humana");
  }
}

export function isBotPaused(phone: string): boolean {
  const entry = pausedPhones.get(phone);
  if (!entry) return false;
  if (entry.pausedUntil < Date.now()) {
    pausedPhones.delete(phone);
    logger.info({ phone }, "Bot re-activado tras expirar pausa humana");
    return false;
  }
  return true;
}

export function resumeBotForPhone(phone: string): void {
  if (pausedPhones.delete(phone)) {
    logger.info({ phone }, "Bot re-activado manualmente");
  }
}

/** Test-only. */
export function _resetTakeover(): void {
  pausedPhones.clear();
  botSentIds.clear();
}

export function takeoverStats(): { paused: number; botSent: number } {
  purgeExpired();
  return { paused: pausedPhones.size, botSent: botSentIds.size };
}
