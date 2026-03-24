import cron from "node-cron";
import { db } from "../database";
import {
  reclamos,
  avisos,
  donantes,
  choferes,
  zonaChoferes,
} from "../database/schema";
import { eq, and, lte, isNull } from "drizzle-orm";
import { sendMessage } from "../bot/client";
import { logger } from "../config/logger";
import { retryDeadLetterQueue } from "./dead-letter-queue";

/**
 * Tareas programadas del sistema.
 * - Seguimiento de reclamos (4 días después)
 * - Recordatorio de vuelta de vacaciones al chofer
 * - Notificación de nuevas donantes cada 2 días al chofer
 */
export function initScheduler(): void {
  cron.schedule("0 9 * * *", async () => {
    logger.info("Ejecutando: seguimiento de reclamos");
    await seguimientoReclamos();
  });

  cron.schedule("30 8 * * *", async () => {
    logger.info("Ejecutando: recordatorios de vuelta");
    await recordatoriosVuelta();
  });

  cron.schedule("0 10 */2 * *", async () => {
    logger.info("Ejecutando: notificación nuevas donantes");
    await notificarNuevasDonantes();
  });

  // Reintentar mensajes fallidos de la DLQ cada 2 horas
  cron.schedule("0 */2 * * *", async () => {
    logger.info("Ejecutando: reintento de Dead Letter Queue");
    await retryDeadLetterQueue({ maxItems: 50, delayMs: 200 }).catch((err) => {
      logger.error({ err }, "Error al reintentar DLQ");
    });
  });

  logger.info("Scheduler inicializado con tareas programadas");
}

/**
 * Busca el chofer asignado a una zona determinada.
 */
async function obtenerChoferDeZona(
  zonaId: number | null,
): Promise<{ nombre: string; telefono: string } | null> {
  if (!zonaId) return null;

  const resultado = await db
    .select({
      nombre: choferes.nombre,
      telefono: choferes.telefono,
    })
    .from(zonaChoferes)
    .innerJoin(choferes, eq(zonaChoferes.choferId, choferes.id))
    .where(and(eq(zonaChoferes.zonaId, zonaId), eq(zonaChoferes.activo, true)))
    .limit(1);

  return resultado.length > 0 ? resultado[0] : null;
}

async function seguimientoReclamos(): Promise<void> {
  const hace4Dias = new Date();
  hace4Dias.setDate(hace4Dias.getDate() - 4);

  const reclamosPendientes = await db
    .select({
      id: reclamos.id,
      donanteId: reclamos.donanteId,
      tipo: reclamos.tipo,
    })
    .from(reclamos)
    .where(
      and(
        eq(reclamos.estado, "notificado_chofer"),
        lte(reclamos.fechaCreacion, hace4Dias),
        isNull(reclamos.fechaSeguimiento),
      ),
    );

  for (const reclamo of reclamosPendientes) {
    const donante = await db
      .select({ telefono: donantes.telefono, nombre: donantes.nombre })
      .from(donantes)
      .where(eq(donantes.id, reclamo.donanteId))
      .limit(1);

    if (donante.length === 0) continue;

    const nombre = donante[0].nombre.split(" ")[0];
    await sendMessage(
      donante[0].telefono,
      `Hola ${nombre}, hace unos días nos reportaste un reclamo. ` +
        `¿Se resolvió tu problema?\n\n` +
        `Respondé *1* para SÍ o *2* para NO.`,
    );

    await db
      .update(reclamos)
      .set({ estado: "seguimiento_enviado", fechaSeguimiento: new Date() })
      .where(eq(reclamos.id, reclamo.id));
  }

  logger.info({ count: reclamosPendientes.length }, "Seguimientos de reclamos enviados");
}

async function recordatoriosVuelta(): Promise<void> {
  const hoy = new Date().toISOString().split("T")[0];

  const avisosHoy = await db
    .select({
      id: avisos.id,
      donanteId: avisos.donanteId,
    })
    .from(avisos)
    .where(
      and(eq(avisos.fechaFin, hoy), eq(avisos.notificacionVueltaEnviada, false)),
    );

  for (const aviso of avisosHoy) {
    const donante = await db
      .select({
        nombre: donantes.nombre,
        zonaId: donantes.zonaId,
        direccion: donantes.direccion,
      })
      .from(donantes)
      .where(eq(donantes.id, aviso.donanteId))
      .limit(1);

    if (donante.length === 0) continue;

    const chofer = await obtenerChoferDeZona(donante[0].zonaId);

    if (chofer) {
      await sendMessage(
        chofer.telefono,
        `📢 *Recordatorio de vuelta*\n\n` +
          `La donante *${donante[0].nombre}* vuelve a donar hoy.\n` +
          `Dirección: ${donante[0].direccion}\n\n` +
          `Recordá pasar a recolectar.`,
      );
      logger.info(
        { donante: donante[0].nombre, chofer: chofer.nombre },
        "Recordatorio de vuelta enviado al chofer",
      );
    }

    await db
      .update(avisos)
      .set({ notificacionVueltaEnviada: true })
      .where(eq(avisos.id, aviso.id));
  }

  logger.info({ count: avisosHoy.length }, "Recordatorios de vuelta procesados");
}

async function notificarNuevasDonantes(): Promise<void> {
  const nuevas = await db
    .select({
      id: donantes.id,
      nombre: donantes.nombre,
      direccion: donantes.direccion,
      zonaId: donantes.zonaId,
      telefono: donantes.telefono,
    })
    .from(donantes)
    .where(eq(donantes.estado, "nueva"));

  const porZona = new Map<number, typeof nuevas>();
  for (const donante of nuevas) {
    if (!donante.zonaId) continue;
    const lista = porZona.get(donante.zonaId) || [];
    lista.push(donante);
    porZona.set(donante.zonaId, lista);
  }

  for (const [zonaId, listaDonantes] of porZona) {
    const chofer = await obtenerChoferDeZona(zonaId);

    if (!chofer) {
      logger.warn({ zonaId }, "No hay chofer asignado a esta zona");
      continue;
    }

    const listado = listaDonantes
      .map((d, i) => `${i + 1}. ${d.nombre} - ${d.direccion}`)
      .join("\n");

    await sendMessage(
      chofer.telefono,
      `🆕 *Nuevas donantes en tu zona*\n\n` +
        `Tenés ${listaDonantes.length} nueva(s) donante(s) para visitar:\n\n` +
        `${listado}\n\n` +
        `Por favor pasá por sus domicilios.`,
    );

    logger.info(
      { zonaId, chofer: chofer.nombre, count: listaDonantes.length },
      "Nuevas donantes notificadas al chofer",
    );
  }

  logger.info({ count: nuevas.length }, "Nuevas donantes procesadas");
}
