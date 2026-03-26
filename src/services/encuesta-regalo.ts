/**
 * Encuesta mensual de regalos.
 * Selecciona 1000 donantes aleatorias y les pregunta si recibieron el regalo.
 */

import { db } from "../database";
import { donantes, encuestasRegalo } from "../database/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import { sendMessage } from "../bot/client";
import { logger } from "../config/logger";

const PREGUNTA_ENCUESTA = "Hola {nombre}, desde GARYCIO queremos saber: ¿recibiste tu regalo este mes? Respondé *SI* o *NO*. ¡Gracias por tu colaboración!";

/**
 * Envía encuesta a 1000 donantes aleatorias con teléfono.
 */
export async function enviarEncuestaMensual(cantidad: number = 1000): Promise<{
  enviadas: number;
  errores: number;
}> {
  // Seleccionar donantes aleatorias activas con teléfono
  const seleccionadas = await db
    .select({
      id: donantes.id,
      nombre: donantes.nombre,
      telefono: donantes.telefono,
    })
    .from(donantes)
    .where(
      and(
        eq(donantes.donandoActualmente, true),
        sql`${donantes.telefono} IS NOT NULL AND ${donantes.telefono} != ''`,
      ),
    )
    .orderBy(sql`RANDOM()`)
    .limit(cantidad);

  let enviadas = 0;
  let errores = 0;

  for (const donante of seleccionadas) {
    const pregunta = PREGUNTA_ENCUESTA.replace("{nombre}", donante.nombre || "vecina");

    try {
      // Guardar encuesta en DB
      await db.insert(encuestasRegalo).values({
        donanteId: donante.id,
        telefono: donante.telefono,
        pregunta,
      });

      // Enviar por WhatsApp
      await sendMessage(donante.telefono, pregunta);
      enviadas++;

      // Rate limiting básico
      if (enviadas % 30 === 0) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (err) {
      logger.error({ err, donanteId: donante.id }, "Error enviando encuesta");
      errores++;
    }
  }

  logger.info({ enviadas, errores }, "Encuesta mensual enviada");
  return { enviadas, errores };
}

/**
 * Procesa la respuesta de una donante a la encuesta.
 */
export async function procesarRespuestaEncuesta(
  telefono: string,
  respuesta: string,
): Promise<boolean> {
  const lower = respuesta.toLowerCase().trim();

  // Solo procesar SI/NO
  if (!lower.startsWith("si") && !lower.startsWith("sí") && !lower.startsWith("no")) {
    return false;
  }

  // Buscar encuesta pendiente para este teléfono
  const pendientes = await db
    .select()
    .from(encuestasRegalo)
    .where(
      and(
        eq(encuestasRegalo.telefono, telefono),
        eq(encuestasRegalo.respondida, false),
      ),
    )
    .orderBy(sql`${encuestasRegalo.fecha} DESC`)
    .limit(1);

  if (pendientes.length === 0) return false;

  await db
    .update(encuestasRegalo)
    .set({
      respuesta: lower.startsWith("no") ? "NO" : "SI",
      respondida: true,
    })
    .where(eq(encuestasRegalo.id, pendientes[0].id));

  logger.info({ telefono, respuesta: lower }, "Respuesta de encuesta procesada");
  return true;
}
