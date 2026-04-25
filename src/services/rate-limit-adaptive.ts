/**
 * P1.6 — Rate limiter adaptativo al error 131056 de Meta.
 *
 * Contexto: 131056 = "Rate limit hit (Business/Consumer pair)". Meta limita
 * cuántos mensajes podés enviar a un destinatario en un período corto.
 * Al recibirlo, Meta ya cortó — la respuesta correcta NO es reintentar
 * sino esperar N minutos antes de volver a intentar con ese teléfono.
 *
 * Además, varios 131056 seguidos indican que el tier/rate global está
 * saturado → reducimos temporalmente el rate agregado (señal de salud).
 */

import { logger } from "../config/logger";

const PER_PHONE_BACKOFF_MS = 15 * 60 * 1000;  // 15 min sin intentar a ese phone
const GLOBAL_WINDOW_MS = 60 * 1000;           // ventana para contar hits recientes
const GLOBAL_THROTTLE_THRESHOLD = 5;          // si >=5 hits en la ventana → throttle global

const phoneBackoffUntil = new Map<string, number>();
const recentHits: number[] = [];
let globalThrottleUntil = 0;

export function recordRateLimitHit(phone: string): void {
  const now = Date.now();
  phoneBackoffUntil.set(phone, now + PER_PHONE_BACKOFF_MS);

  recentHits.push(now);
  while (recentHits.length > 0 && recentHits[0] < now - GLOBAL_WINDOW_MS) {
    recentHits.shift();
  }

  if (recentHits.length >= GLOBAL_THROTTLE_THRESHOLD) {
    globalThrottleUntil = now + 5 * 60 * 1000;
    logger.warn(
      { hits: recentHits.length, windowMs: GLOBAL_WINDOW_MS },
      "Rate limit Meta: activando throttle global 5min",
    );
  }

  logger.warn(
    { phone, backoffMinutes: PER_PHONE_BACKOFF_MS / 60_000 },
    "Rate limit 131056: phone en backoff",
  );
}

export function isPhoneRateLimited(phone: string): boolean {
  const until = phoneBackoffUntil.get(phone);
  if (!until) return false;
  if (until < Date.now()) {
    phoneBackoffUntil.delete(phone);
    return false;
  }
  return true;
}

export function isGlobalThrottled(): boolean {
  if (globalThrottleUntil < Date.now()) {
    globalThrottleUntil = 0;
    return false;
  }
  return true;
}

/** Test-only. */
export function _resetRateLimit(): void {
  phoneBackoffUntil.clear();
  recentHits.length = 0;
  globalThrottleUntil = 0;
}

export function rateLimitStats(): {
  phonesBackoff: number;
  hitsInWindow: number;
  globalThrottled: boolean;
} {
  return {
    phonesBackoff: phoneBackoffUntil.size,
    hitsInWindow: recentHits.length,
    globalThrottled: isGlobalThrottled(),
  };
}
