/**
 * Middleware de deduplicación de mensajes WhatsApp.
 *
 * Meta/360dialog reenvían webhooks si hay timeouts o múltiples workers.
 * Esta capa evita que el mismo message.id se procese más de una vez.
 *
 * Estrategia: LRU en memoria (rápido) + DB persistente (fallback).
 * TTL: 24h en memoria, 7 días en DB.
 */

import { db } from "../database";
import { processedMessages } from "../database/schema";
import { eq } from "drizzle-orm";
import { logger } from "../config/logger";

const MEM_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const MEM_CACHE_MAX = 5000; // máximo entradas en memoria (≈ 7k donantes activos)

interface CacheEntry {
  phone: string;
  status: string;
  ts: number;
}

const memCache = new Map<string, CacheEntry>();

// Limpieza periódica de memoria cada 30 min
setInterval(() => {
  const cutoff = Date.now() - MEM_CACHE_TTL_MS;
  let cleaned = 0;
  for (const [msgId, entry] of memCache) {
    if (entry.ts < cutoff) {
      memCache.delete(msgId);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.debug({ cleaned }, "Dedup cache limpiada");
  }
  // Si sigue excediendo el máximo, eliminar los más viejos
  if (memCache.size > MEM_CACHE_MAX) {
    const sorted = [...memCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    const toRemove = sorted.slice(0, memCache.size - MEM_CACHE_MAX);
    for (const [msgId] of toRemove) {
      memCache.delete(msgId);
      cleaned++;
    }
    if (cleaned > 0) {
      logger.info({ cleaned, newSize: memCache.size }, "Dedup cache recortada por límite");
    }
  }
}, 30 * 60 * 1000);

/**
 * Verifica si un message.id ya fue procesado.
 * Primero busca en memoria, luego en DB.
 */
export async function isDuplicate(messageId: string): Promise<boolean> {
  if (!messageId) return false;

  // 1. Memoria (rápido)
  const cached = memCache.get(messageId);
  if (cached && Date.now() - cached.ts < MEM_CACHE_TTL_MS) {
    return true;
  }

  // 2. DB persistente
  try {
    const rows = await db
      .select({ id: processedMessages.id })
      .from(processedMessages)
      .where(eq(processedMessages.messageId, messageId))
      .limit(1);

    if (rows.length > 0) {
      // Re-hidratar en memoria para futuras comprobaciones
      memCache.set(messageId, { phone: "", status: "ok", ts: Date.now() });
      return true;
    }
  } catch (err) {
    logger.error({ err, messageId }, "Error consultando dedup en DB");
    // En caso de error de DB, asumimos NO duplicado para no bloquear donantes
  }

  return false;
}

/**
 * Marca un message.id como procesado.
 * Guarda en memoria inmediatamente y en DB en background.
 */
export async function markAsProcessed(
  messageId: string,
  phone: string,
  status: "ok" | "error" | "ignored" = "ok",
): Promise<void> {
  if (!messageId) return;

  // Hard limit: si excedemos el máximo, eliminar la entrada más antigua inmediatamente
  if (memCache.size >= MEM_CACHE_MAX) {
    let oldestKey: string | null = null;
    let oldestTs = Infinity;
    for (const [key, entry] of memCache) {
      if (entry.ts < oldestTs) {
        oldestTs = entry.ts;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      memCache.delete(oldestKey);
    }
  }

  memCache.set(messageId, { phone, status, ts: Date.now() });

  // Insert en background (no bloquear respuesta)
  db.insert(processedMessages)
    .values({ messageId, phone, status })
    .onConflictDoNothing()
    .catch((err) => {
      logger.error({ err, messageId }, "Error guardando dedup en DB");
    });
}
