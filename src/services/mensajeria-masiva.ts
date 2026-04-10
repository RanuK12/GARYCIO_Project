import { sendMessage, sendTemplate, WhatsAppAPIError } from "../bot/client";
import { sendBulkWithProgress } from "../bot/queue";
import { db } from "../database";
import { donantes, subZonas, mensajesLog, conversationStates, difusionEnvios } from "../database/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { logger } from "../config/logger";
import { env } from "../config/env";
import { addToDeadLetterQueue } from "./dead-letter-queue";
import { importarRutas, type DonantesRuta } from "../scripts/importar-rutas-optimoroute";

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
      `Buen día señora donante. Le hablamos de parte del laboratorio para informarle ` +
      `que a partir del Lunes 13 de abril sus días de recolección van a ser: *${dias}* ` +
      `entre las 8 y 9 de la mañana.\n\n` +
      `Confirme recepción apretando el número *1*.\n` +
      `De lo contrario, si tiene alguna otra consulta oprima *2*.`,
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

  // Actualizar días de recolección en la DB y preparar flow de difusión
  for (const d of donantesList) {
    await db
      .update(donantes)
      .set({ diasRecoleccion: dias, updatedAt: new Date() })
      .where(eq(donantes.id, d.id));

    // Crear estado de conversación "difusion" para que al responder 1/2 se maneje correctamente
    await db
      .insert(conversationStates)
      .values({
        phone: d.telefono,
        currentFlow: "difusion",
        step: 0,
        data: { diasAsignados: dias },
        lastInteraction: new Date(),
      })
      .onConflictDoUpdate({
        target: conversationStates.phone,
        set: {
          currentFlow: "difusion",
          step: 0,
          data: { diasAsignados: dias },
          lastInteraction: new Date(),
        },
      });
  }

  return {
    total: donantesList.length,
    enviados: resultado.sent,
    fallidos: resultado.failed,
  };
}

// ============================================================
// Envío masivo basado en rutas de OptimoRoute
// ============================================================

/**
 * Envía mensajes de difusión personalizados a los donantes según sus rutas
 * asignadas por OptimoRoute. Cada donante recibe un mensaje indicando
 * qué días le pasan a buscar y qué chofer/camión le corresponde.
 *
 * Opciones:
 *   ruta - Filtrar por ruta específica (ej: "LJ_1", "MS_2", "MV_3")
 *          Si no se especifica, envía a TODAS las rutas.
 *   dias - Filtrar por días (ej: "LJ" para Lunes/Jueves)
 *   chofer - Filtrar por número de chofer (1, 2 o 3)
 */
export async function enviarDifusionPorRutas(opciones?: {
  ruta?: string;
  dias?: string;
  chofer?: number;
  telefonos?: Set<string>;
}): Promise<{
  total: number;
  enviados: number;
  fallidos: number;
  porRuta: Record<string, { enviados: number; fallidos: number }>;
}> {
  const resumenRutas = importarRutas();

  let donantesFiltrados = resumenRutas.donantes;

  if (opciones?.ruta) {
    donantesFiltrados = donantesFiltrados.filter(
      (d) => d.archivoOrigen === opciones.ruta,
    );
  }

  if (opciones?.dias) {
    donantesFiltrados = donantesFiltrados.filter(
      (d) => d.archivoOrigen.startsWith(opciones.dias!),
    );
  }

  if (opciones?.chofer) {
    donantesFiltrados = donantesFiltrados.filter(
      (d) => d.chofer === opciones.chofer,
    );
  }

  if (opciones?.telefonos) {
    donantesFiltrados = donantesFiltrados.filter(
      (d) => opciones.telefonos!.has(d.celularWhatsApp),
    );
  }

  donantesFiltrados = donantesFiltrados.filter((d) => d.celularWhatsApp);

  logger.info(
    { total: donantesFiltrados.length, filtros: opciones },
    "Iniciando envío masivo por rutas OptimoRoute",
  );

  if (donantesFiltrados.length === 0) {
    return { total: 0, enviados: 0, fallidos: 0, porRuta: {} };
  }

  const mensajes = donantesFiltrados.map((d) => ({
    phone: d.celularWhatsApp,
    message: generarMensajeDifusionRuta(d),
  }));

  const usarTemplate = env.DIFUSION_USE_TEMPLATE;
  const templateName = env.DIFUSION_TEMPLATE_NAME;

  const resultado = await sendBulkWithProgress(mensajes, async (phone, message) => {
    try {
      if (usarTemplate) {
        // Modo utility: usa template aprobado por Meta (más barato, sin categoría marketing)
        // El template debe tener parámetros: {{1}}=nombre, {{2}}=días, {{3}}=camión, {{4}}=horario
        const donante = donantesFiltrados.find((d) => d.celularWhatsApp === phone);
        const horario = donante?.horarioEstimado ?? "a determinar";
        await sendTemplate(phone, templateName, "es_AR", [
          {
            type: "body",
            parameters: [
              { type: "text", text: donante?.nombre ?? "" },
              { type: "text", text: donante?.diasRecoleccion ?? "" },
              { type: "text", text: String(donante?.chofer ?? "") },
              { type: "text", text: horario },
            ],
          },
        ]);
      } else {
        // Modo texto libre (funciona sin template pero Meta cobra como marketing)
        await sendMessage(phone, message);
      }
    } catch (err) {
      await addToDeadLetterQueue({
        telefono: phone,
        tipo: usarTemplate ? "template" : "texto",
        contenido: message,
        templateName: usarTemplate ? templateName : undefined,
        errorMessage: (err as Error).message,
      });
      throw err;
    }
  }, {
    delayMs: 50,
    batchSize: 500,
    batchPauseMs: 5000,
    onProgress: (sent, failed, total) => {
      if ((sent + failed) % 200 === 0) {
        logger.info({ sent, failed, total }, "Progreso envío rutas OptimoRoute");
      }
    },
  });

  // Crear estado de conversación "difusion" para cada donante
  // y registrar el envío en difusion_envios para tracking de confirmaciones
  for (const d of donantesFiltrados) {
    await db
      .insert(conversationStates)
      .values({
        phone: d.celularWhatsApp,
        currentFlow: "difusion",
        step: 0,
        data: { diasAsignados: d.diasRecoleccion, chofer: d.chofer },
        lastInteraction: new Date(),
      })
      .onConflictDoUpdate({
        target: conversationStates.phone,
        set: {
          currentFlow: "difusion",
          step: 0,
          data: { diasAsignados: d.diasRecoleccion, chofer: d.chofer },
          lastInteraction: new Date(),
        },
      });

    await db
      .insert(difusionEnvios)
      .values({
        telefono: d.celularWhatsApp,
        nombre: d.nombre,
        diasRecoleccion: d.diasRecoleccion,
        chofer: d.chofer,
        horarioEstimado: d.horarioEstimado ?? null,
        confirmado: false,
        fechaEnvio: new Date(),
        fechaConfirmacion: null,
      })
      .onConflictDoUpdate({
        target: difusionEnvios.telefono,
        set: {
          confirmado: false,
          fechaEnvio: new Date(),
          fechaConfirmacion: null,
        },
      });
  }

  // Resumen por ruta
  const porRuta: Record<string, { enviados: number; fallidos: number }> = {};
  const erroresSet = new Set(resultado.errors.map((e) => e.phone));

  for (const d of donantesFiltrados) {
    if (!porRuta[d.archivoOrigen]) {
      porRuta[d.archivoOrigen] = { enviados: 0, fallidos: 0 };
    }
    if (erroresSet.has(d.celularWhatsApp)) {
      porRuta[d.archivoOrigen].fallidos++;
    } else {
      porRuta[d.archivoOrigen].enviados++;
    }
  }

  logger.info(
    { total: donantesFiltrados.length, enviados: resultado.sent, fallidos: resultado.failed, porRuta },
    "Envío masivo por rutas completado",
  );

  return {
    total: donantesFiltrados.length,
    enviados: resultado.sent,
    fallidos: resultado.failed,
    porRuta,
  };
}

function generarMensajeDifusionRuta(donante: DonantesRuta): string {
  const nombre = donante.nombre;
  const horario = donante.horarioEstimado
    ? `El horario estimado de paso es alrededor de las *${donante.horarioEstimado}hs*.`
    : `El horario de paso es entre las *8 y 9 de la mañana*.`;

  return (
    `Buen dia ${nombre}. Le hablamos de parte del laboratorio ` +
    `para informarle que a partir de ahora sus días de recolección van a ser: *${donante.diasRecoleccion}*.\n` +
    `${horario}\n` +
    `Confirme recepción apretando el número *1*. De lo contrario, si tiene alguna otra consulta oprima *2*.`
  );
}
