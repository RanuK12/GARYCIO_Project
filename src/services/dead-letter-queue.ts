import { db } from "../database";
import { deadLetterQueue } from "../database/schema";
import { eq, and, lte } from "drizzle-orm";
import { sendMessage, sendTemplate, WhatsAppAPIError } from "../bot/client";
import { logger } from "../config/logger";

/**
 * Registra un mensaje fallido en la Dead Letter Queue para auditoría y reintento.
 */
export async function addToDeadLetterQueue(params: {
  telefono: string;
  tipo: "texto" | "template" | "documento" | "alerta_ceo";
  contenido?: string;
  templateName?: string;
  templateParams?: any;
  errorMessage: string;
  errorCode?: number;
}): Promise<void> {
  try {
    await db.insert(deadLetterQueue).values({
      telefono: params.telefono,
      tipo: params.tipo,
      contenido: params.contenido,
      templateName: params.templateName,
      templateParams: params.templateParams,
      errorMessage: params.errorMessage,
      errorCode: params.errorCode,
      intentos: 1,
      estado: "pendiente",
    });
    logger.debug({ phone: params.telefono, tipo: params.tipo }, "Mensaje agregado a DLQ");
  } catch (err) {
    logger.error({ err, phone: params.telefono }, "Error al guardar en DLQ");
  }
}

/**
 * Reintenta todos los mensajes pendientes en la DLQ.
 * Solo reintenta mensajes con errores transitorios (no permanentes).
 * Devuelve estadísticas del proceso.
 */
export async function retryDeadLetterQueue(options?: {
  maxItems?: number;
  delayMs?: number;
}): Promise<{ retried: number; succeeded: number; failed: number; discarded: number }> {
  const { maxItems = 100, delayMs = 100 } = options || {};

  const pendientes = await db
    .select()
    .from(deadLetterQueue)
    .where(eq(deadLetterQueue.estado, "pendiente"))
    .limit(maxItems);

  const stats = { retried: 0, succeeded: 0, failed: 0, discarded: 0 };

  logger.info({ total: pendientes.length }, "Reintentando mensajes de DLQ");

  for (const item of pendientes) {
    stats.retried++;

    // Descartar después de 5 intentos
    if ((item.intentos ?? 0) >= 5) {
      await db
        .update(deadLetterQueue)
        .set({ estado: "descartado", updatedAt: new Date() })
        .where(eq(deadLetterQueue.id, item.id));
      stats.discarded++;
      continue;
    }

    try {
      if (item.tipo === "template" && item.templateName) {
        await sendTemplate(
          item.telefono,
          item.templateName,
          "es_AR",
          item.templateParams as any,
        );
      } else if (item.contenido) {
        await sendMessage(item.telefono, item.contenido);
      } else {
        // Sin contenido ni template, descartar
        await db
          .update(deadLetterQueue)
          .set({ estado: "descartado", updatedAt: new Date() })
          .where(eq(deadLetterQueue.id, item.id));
        stats.discarded++;
        continue;
      }

      await db
        .update(deadLetterQueue)
        .set({ estado: "exitoso", updatedAt: new Date() })
        .where(eq(deadLetterQueue.id, item.id));
      stats.succeeded++;
    } catch (err) {
      const isPermanent = err instanceof WhatsAppAPIError && err.isPermanent;

      await db
        .update(deadLetterQueue)
        .set({
          intentos: (item.intentos ?? 0) + 1,
          estado: isPermanent ? "descartado" : "pendiente",
          errorMessage: (err as Error).message,
          updatedAt: new Date(),
        })
        .where(eq(deadLetterQueue.id, item.id));

      if (isPermanent) {
        stats.discarded++;
      } else {
        stats.failed++;
      }
    }

    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  logger.info(stats, "Reintento de DLQ completado");
  return stats;
}

/**
 * Obtiene estadísticas de la DLQ para monitoreo.
 */
export async function getDLQStats(): Promise<{
  pendientes: number;
  reintentados: number;
  descartados: number;
  exitosos: number;
}> {
  const all = await db.select().from(deadLetterQueue);

  return {
    pendientes: all.filter((r) => r.estado === "pendiente").length,
    reintentados: all.filter((r) => r.estado === "reintentado").length,
    descartados: all.filter((r) => r.estado === "descartado").length,
    exitosos: all.filter((r) => r.estado === "exitoso").length,
  };
}
