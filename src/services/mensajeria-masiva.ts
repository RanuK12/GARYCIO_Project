import { sendMessage, sendTemplate } from "../bot/client";
import { sendBulkWithProgress } from "../bot/queue";
import { db } from "../database";
import { donantes, subZonas, mensajesLog } from "../database/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { logger } from "../config/logger";
import { addToDeadLetterQueue } from "./dead-letter-queue";

interface DonanteMensaje {
  id: number;
  nombre: string;
  telefono: string;
  direccion: string;
  diasRecoleccion: string | null;
}

/**
 * Envía mensajes de contacto inicial a todas las donantes de una zona.
 * Usa el sistema de cola con rate limiting, retry y seguimiento de progreso.
 *
 * Para envío masivo a 9,500+ donantes, se recomienda usar templates
 * aprobados por Meta (sendTemplate) en vez de texto libre.
 */
export async function enviarMensajesContactoInicial(zonaId: number): Promise<{
  total: number;
  enviados: number;
  fallidos: number;
}> {
  const donantesList = await db
    .select({
      id: donantes.id,
      nombre: donantes.nombre,
      telefono: donantes.telefono,
      direccion: donantes.direccion,
      diasRecoleccion: donantes.diasRecoleccion,
    })
    .from(donantes)
    .where(and(eq(donantes.zonaId, zonaId), isNotNull(donantes.telefono)));

  logger.info(
    { zonaId, total: donantesList.length },
    "Iniciando envío masivo de contacto inicial",
  );

  const mensajes = donantesList.map((d) => ({
    phone: d.telefono,
    message: generarMensajeInicial(d),
  }));

  const resultado = await sendBulkWithProgress(mensajes, sendMessage, {
    delayMs: 50,
    batchSize: 500,
    batchPauseMs: 5000,
    onProgress: (sent, failed, total) => {
      if ((sent + failed) % 100 === 0) {
        logger.info({ sent, failed, total, zonaId }, "Progreso envío masivo");
      }
    },
  });

  // Loguear cada envío en DB
  const logPromises = donantesList.map((donante) =>
    db.insert(mensajesLog).values({
      telefono: donante.telefono,
      tipo: "contacto_inicial",
      contenido: "Mensaje de contacto inicial enviado",
      direccion: "saliente",
      exitoso: !resultado.errors.find((e) => e.phone === donante.telefono),
    }).catch((err) => {
      logger.error({ phone: donante.telefono, err }, "Error logueando mensaje");
    }),
  );
  await Promise.all(logPromises);

  logger.info(
    { zonaId, enviados: resultado.sent, fallidos: resultado.failed },
    "Envío masivo completado",
  );

  return {
    total: donantesList.length,
    enviados: resultado.sent,
    fallidos: resultado.failed,
  };
}

/**
 * Envía mensajes masivos usando templates aprobados por Meta.
 * Necesario para mensajes de marketing (primer contacto sin ventana de 24h).
 */
export async function enviarTemplateContactoInicial(
  zonaId: number,
  templateName: string,
): Promise<{
  total: number;
  enviados: number;
  fallidos: number;
}> {
  const donantesList = await db
    .select({
      id: donantes.id,
      nombre: donantes.nombre,
      telefono: donantes.telefono,
    })
    .from(donantes)
    .where(and(eq(donantes.zonaId, zonaId), isNotNull(donantes.telefono)));

  logger.info(
    { zonaId, total: donantesList.length, template: templateName },
    "Iniciando envío masivo con template",
  );

  const resultado = await sendBulkWithProgress(
    donantesList.map((d) => ({
      phone: d.telefono,
      message: d.nombre.split(" ")[0], // se usa como parámetro del template
    })),
    async (phone, nombre) => {
      await sendTemplate(phone, templateName, "es_AR", [
        {
          type: "body",
          parameters: [{ type: "text", text: nombre }],
        },
      ]);
    },
    {
      delayMs: 50,
      batchSize: 500,
      batchPauseMs: 5000,
      onProgress: (sent, failed, total) => {
        if ((sent + failed) % 100 === 0) {
          logger.info({ sent, failed, total, zonaId }, "Progreso template masivo");
        }
      },
    },
  );

  return {
    total: donantesList.length,
    enviados: resultado.sent,
    fallidos: resultado.failed,
  };
}

function generarMensajeInicial(donante: DonanteMensaje): string {
  const nombre = donante.nombre.split(" ")[0];

  return (
    `¡Hola ${nombre}! 👋\n\n` +
    `Te escribimos de *GARYCIO*. Estamos reorganizando las zonas de recolección ` +
    `y queremos confirmar algunos datos con vos.\n\n` +
    `¿Actualmente estás donando?\n\n` +
    `Respondé *1* para SÍ o *2* para NO.`
  );
}

/**
 * Envía mensaje de asignación de día de recolección a cada donante de una sub-zona.
 * Se usa después de optimizar las rutas para informar "te pasamos a buscar los días X".
 */
export async function enviarAsignacionDias(subZonaCodigo: string): Promise<{
  total: number;
  enviados: number;
  fallidos: number;
}> {
  // Obtener sub-zona y sus días
  const subZona = await db
    .select({
      id: subZonas.id,
      nombre: subZonas.nombre,
      diasRecoleccion: subZonas.diasRecoleccion,
    })
    .from(subZonas)
    .where(eq(subZonas.codigo, subZonaCodigo))
    .limit(1);

  if (subZona.length === 0) {
    logger.error({ subZonaCodigo }, "Sub-zona no encontrada");
    return { total: 0, enviados: 0, fallidos: 0 };
  }

  const donantesList = await db
    .select({
      id: donantes.id,
      nombre: donantes.nombre,
      telefono: donantes.telefono,
    })
    .from(donantes)
    .where(
      and(
        eq(donantes.subZona, subZonaCodigo),
        eq(donantes.donandoActualmente, true),
        isNotNull(donantes.telefono),
      ),
    );

  const dias = subZona[0].diasRecoleccion;

  const mensajes = donantesList.map((d) => ({
    phone: d.telefono,
    message:
      `¡Hola ${d.nombre.split(" ")[0]}! 👋\n\n` +
      `Te informamos que tu nuevo día de recolección es: *${dias}*.\n\n` +
      `Nuestro recolector pasará por tu domicilio en esos días. ` +
      `Por favor tené el bidón listo.\n\n` +
      `Si tenés alguna duda o necesitás hacer un cambio, escribinos por acá.\n\n` +
      `¡Gracias por tu colaboración! 🙌`,
  }));

  logger.info(
    { subZonaCodigo, dias, total: mensajes.length },
    "Enviando asignación de días",
  );

  const resultado = await sendBulkWithProgress(mensajes, async (phone, message) => {
    try {
      await sendMessage(phone, message);
    } catch (err) {
      // Guardar en DLQ si falla
      await addToDeadLetterQueue({
        telefono: phone,
        tipo: "texto",
        contenido: message,
        errorMessage: (err as Error).message,
      });
      throw err;
    }
  }, {
    delayMs: 50,
    batchSize: 500,
    batchPauseMs: 5000,
    onProgress: (sent, failed, total) => {
      if ((sent + failed) % 100 === 0) {
        logger.info({ sent, failed, total, subZonaCodigo }, "Progreso asignación días");
      }
    },
  });

  // Actualizar días de recolección en la DB para cada donante
  for (const d of donantesList) {
    await db
      .update(donantes)
      .set({ diasRecoleccion: dias, updatedAt: new Date() })
      .where(eq(donantes.id, d.id));
  }

  return {
    total: donantesList.length,
    enviados: resultado.sent,
    fallidos: resultado.failed,
  };
}
