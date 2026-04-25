/**
 * P1.3 — Cache LRU en memoria para resultados del clasificador IA.
 *
 * Racional:
 * - Muchos mensajes son repetitivos ("1", "ok", "hola", "gracias", "recibido").
 * - Cachear por mensaje normalizado evita llamadas a OpenAI redundantes.
 * - TTL corto (1h) porque el contexto conversacional cambia.
 *
 * NO se cachean resultados con needsHuman=true ni confidence=low: esos casos
 * pueden depender de contexto (enojo, sentimiento) y conviene re-evaluar.
 */

import type { ClassifierResult } from "./clasificador-ia";

interface CacheEntry {
  result: ClassifierResult;
  expiresAt: number;
}

const MAX_ENTRIES = 500;
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h

const cache = new Map<string, CacheEntry>();

export function normalizeMessage(message: string): string {
  return message
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

export function cacheGet(message: string): ClassifierResult | null {
  const key = normalizeMessage(message);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  // LRU: re-insertar mueve al final
  cache.delete(key);
  cache.set(key, entry);
  return entry.result;
}

export function cacheSet(message: string, result: ClassifierResult, ttlMs = DEFAULT_TTL_MS): void {
  // No cachear casos ambiguos o que escalan a humano — cambian con contexto
  if (result.needsHuman || result.confidence === "low") return;

  const key = normalizeMessage(message);
  if (cache.size >= MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, { result, expiresAt: Date.now() + ttlMs });
}

/** Test-only. */
export function _cacheReset(): void {
  cache.clear();
}

export function cacheStats(): { size: number; max: number } {
  return { size: cache.size, max: MAX_ENTRIES };
}
