import { logger } from "../config/logger";

/**
 * Mutex por usuario: garantiza que los mensajes de un mismo número
 * se procesan en orden, evitando race conditions en el estado de conversación.
 *
 * Mejoras de producción:
 * - Timeout de 60s (llamadas a OpenAI + DB pueden tardar)
 * - NO se libera el lock forzosamente; se loguea y se deja que el próximo mensaje espere
 * - Prevención de deadlock con cleanup periódico
 */

const userLocks = new Map<string, { promise: Promise<void>; startTime: number }>();

const LOCK_TIMEOUT_MS = 120_000; // 120s máximo de espera (debe ser mayor que el peor caso real: 25s handler + DB)
const LOCK_MAX_AGE_MS = 180_000; // 180s máximo de vida de un lock (protección contra zombie locks)

// Cleanup de locks zombies cada 5 minutos
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [phone, lock] of userLocks) {
    if (now - lock.startTime > LOCK_MAX_AGE_MS) {
      userLocks.delete(phone);
      cleaned++;
      logger.warn({ phone, ageSec: Math.round((now - lock.startTime) / 1000) }, "Lock zombie eliminado");
    }
  }
  if (cleaned > 0) {
    logger.info({ cleaned }, "Limpieza de locks zombies completada");
  }
}, 5 * 60 * 1000);

export async function withUserLock<T>(phone: string, fn: () => Promise<T>): Promise<T> {
  const startWait = Date.now();

  // Esperar lock activo con timeout
  while (userLocks.has(phone)) {
    const lock = userLocks.get(phone)!;
    const remaining = LOCK_TIMEOUT_MS - (Date.now() - startWait);

    if (remaining <= 0) {
      logger.warn({ phone }, "Lock timeout esperando — procesando de todos modos (posible duplicado)");
      break;
    }

    await Promise.race([
      lock.promise,
      new Promise<void>((r) => setTimeout(r, remaining)),
    ]);
  }

  let releaseLock!: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  userLocks.set(phone, { promise: lockPromise, startTime: Date.now() });

  try {
    return await fn();
  } finally {
    userLocks.delete(phone);
    releaseLock();
  }
}

// ── Envío masivo con control de progreso ──
export interface BulkSendResult {
  sent: number;
  failed: number;
  errors: Array<{ phone: string; error: string }>;
}

export interface BulkSendOptions {
  delayMs?: number;
  onProgress?: (sent: number, failed: number, total: number) => void;
  batchSize?: number;
  batchPauseMs?: number;
}

export async function sendBulkWithProgress(
  items: Array<{ phone: string; message: string }>,
  sendFn: (phone: string, message: string) => Promise<any>,
  options: BulkSendOptions = {},
): Promise<BulkSendResult> {
  const {
    delayMs = 50,
    onProgress,
    batchSize = 500,
    batchPauseMs = 5000,
  } = options;

  const results: BulkSendResult = { sent: 0, failed: 0, errors: [] };
  const total = items.length;

  logger.info({ total, batchSize, delayMs }, "Iniciando envío masivo");

  for (let i = 0; i < items.length; i++) {
    const { phone, message } = items[i];

    try {
      await sendFn(phone, message);
      results.sent++;
    } catch (err) {
      results.failed++;
      results.errors.push({ phone, error: (err as Error).message });
    }

    onProgress?.(results.sent, results.failed, total);

    if (i < items.length - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }

    if ((i + 1) % batchSize === 0 && i < items.length - 1) {
      logger.info({ progreso: `${i + 1}/${total}`, enviados: results.sent, fallidos: results.failed }, "Pausa entre lotes");
      await new Promise((r) => setTimeout(r, batchPauseMs));
    }
  }

  logger.info({ sent: results.sent, failed: results.failed, total }, "Envío masivo completado");
  return results;
}
