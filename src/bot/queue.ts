import { logger } from "../config/logger";

/**
 * Mutex por usuario: garantiza que los mensajes de un mismo número
 * se procesan en orden, evitando race conditions en el estado de conversación.
 */
const userLocks = new Map<string, Promise<void>>();

export async function withUserLock<T>(phone: string, fn: () => Promise<T>): Promise<T> {
  // Esperar si hay un lock activo para este usuario
  while (userLocks.has(phone)) {
    await userLocks.get(phone);
  }

  let releaseLock!: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  userLocks.set(phone, lockPromise);

  try {
    return await fn();
  } finally {
    userLocks.delete(phone);
    releaseLock();
  }
}

/**
 * Envío masivo con control de progreso, rate limiting y tolerancia a fallos.
 */
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

    // Delay entre mensajes
    if (i < items.length - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }

    // Pausa cada N mensajes para no saturar
    if ((i + 1) % batchSize === 0 && i < items.length - 1) {
      logger.info(
        { progreso: `${i + 1}/${total}`, enviados: results.sent, fallidos: results.failed },
        "Pausa entre lotes",
      );
      await new Promise((r) => setTimeout(r, batchPauseMs));
    }
  }

  logger.info(
    { sent: results.sent, failed: results.failed, total },
    "Envío masivo completado",
  );

  return results;
}
