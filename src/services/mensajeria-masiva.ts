import { sendBulkMessages } from "../bot/client";
import { db } from "../database";
import { donantes, mensajesLog, zonas } from "../database/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { logger } from "../config/logger";

interface DonanteMensaje {
  id: number;
  nombre: string;
  telefono: string;
  direccion: string;
  diasRecoleccion: string | null;
}

/**
 * Genera y envía mensajes iniciales a todas las donantes de una zona nueva.
 * Objetivo: confirmar si siguen donando y recopilar datos de recolección.
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

  const resultado = await sendBulkMessages(mensajes, 4000);

  for (const donante of donantesList) {
    await db.insert(mensajesLog).values({
      telefono: donante.telefono,
      tipo: "contacto_inicial",
      contenido: "Mensaje de contacto inicial enviado",
      direccion: "saliente",
      exitoso: !resultado.errors.find((e) => e.phone === donante.telefono),
    });
  }

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
