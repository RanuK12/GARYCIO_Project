/**
 * P1.1 — Cola persistente con pg-boss.
 *
 * Objetivo: si el proceso cae a mitad de procesar un mensaje entrante,
 * pg-boss lo preserva en la tabla `pgboss.job` de Postgres y lo re-entrega
 * al re-arrancar. Elimina el problema de "Meta reintenta webhook → el mismo
 * mensaje se procesa 2 veces o se pierde" que amplificó el incidente del 22/4.
 *
 * Diseño:
 *   webhook → boss.send('process-inbound', payload) → 200 OK a Meta
 *   worker  → boss.work('process-inbound', handler) → processIncomingMessage
 *
 * Claves:
 * - `singletonKey = messageId`: pg-boss deduplica por sí mismo, no depende
 *   de nuestra tabla `dedup`.
 * - Errores permanentes NO se reintentan. Errores transitorios: exponential
 *   backoff, máximo 3 reintentos.
 * - El webhook responde 200 ANTES de encolar (idempotente igual por singletonKey).
 */

import PgBoss from "pg-boss";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { WhatsAppAPIError } from "../bot/client";

export const INBOUND_QUEUE = "process-inbound";

export interface InboundJob {
  phone: string;
  text: string;
  messageId: string;
  mediaInfo?: {
    mediaId: string;
    mimeType: string;
    caption: string | null;
    type: "image" | "document";
  };
}

let bossInstance: PgBoss | null = null;

// P0.9 — Timestamp del arranque del worker. Los jobs creados ANTES de este
// instante (mensajes que entraron mientras el bot estaba apagado o siendo
// manejados por humanos) se descartan: el bot arranca en blanco.
let workerStartedAt: number | null = null;

/** Test-only. Permite simular múltiples arranques. */
export function _resetWorkerStartedAt(): void {
  workerStartedAt = null;
}

export async function getBoss(): Promise<PgBoss> {
  if (bossInstance) return bossInstance;

  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    // Aislamiento del schema para no ensuciar `public`
    schema: "pgboss",
    // No reintentar por más de 5 min sin intervención — evita loops infinitos
    retentionHours: 24,
  });

  boss.on("error", (err) => {
    logger.error({ err }, "pg-boss: error interno");
  });

  await boss.start();
  await boss.createQueue(INBOUND_QUEUE);

  bossInstance = boss;
  logger.info("pg-boss iniciado correctamente");
  return boss;
}

export async function enqueueInbound(job: InboundJob): Promise<string | null> {
  const boss = await getBoss();
  const jobId = await boss.send(INBOUND_QUEUE, job, {
    singletonKey: job.messageId,
    retryLimit: 3,
    retryDelay: 5,
    retryBackoff: true,
    expireInMinutes: 10,
  });
  return jobId ?? null;
}

/**
 * Registra el worker que procesa mensajes entrantes.
 * El handler recibe el job y debe retornar (sin throw) si el procesamiento
 * fue OK. Si throw con un error permanente → pg-boss lo descarta.
 */
export async function startInboundWorker(
  handler: (job: InboundJob) => Promise<void>,
): Promise<void> {
  const boss = await getBoss();
  workerStartedAt = Date.now();
  await boss.work<InboundJob>(
    INBOUND_QUEUE,
    { batchSize: 1, pollingIntervalSeconds: 1 },
    async ([job]) => {
      // P0.9 — Descartar mensajes creados antes del arranque del bot.
      // pg-boss entrega `createdOn` como Date en la raíz del job.
      const createdOn = (job as { createdOn?: Date }).createdOn;
      if (
        workerStartedAt !== null &&
        createdOn instanceof Date &&
        createdOn.getTime() < workerStartedAt
      ) {
        logger.warn(
          {
            phone: job.data.phone,
            messageId: job.data.messageId,
            createdOn: createdOn.toISOString(),
          },
          "P0.9 — Descartando job previo al arranque del bot (política: olvidar conversaciones viejas)",
        );
        return;
      }

      try {
        await handler(job.data);
      } catch (err) {
        if (err instanceof WhatsAppAPIError && err.isPermanent) {
          logger.warn(
            { phone: job.data.phone, code: err.code, messageId: job.data.messageId },
            "Worker: error permanente, descartando job (no retry)",
          );
          return; // retornar OK = no reintenta
        }
        throw err; // deja que pg-boss reintente según retryLimit
      }
    },
  );
  logger.info({ queue: INBOUND_QUEUE }, "Worker iniciado");
}

export async function stopBoss(): Promise<void> {
  if (bossInstance) {
    await bossInstance.stop({ graceful: true });
    bossInstance = null;
    logger.info("pg-boss detenido");
  }
}
