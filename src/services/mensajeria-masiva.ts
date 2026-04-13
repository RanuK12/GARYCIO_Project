import { sendMessage, sendTemplate, WhatsAppAPIError } from "../bot/client";
import { sendBulkWithProgress } from "../bot/queue";
import { db } from "../database";
import { donantes, subZonas, mensajesLog, conversationStates, difusionEnvios } from "../database/schema";
import { eq, and, isNotNull, inArray } from "drizzle-orm";
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
  limite?: number;
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

  // Excluir donantes que ya recibieron el mensaje (están en difusion_envios)
  const telefonosConWhatsApp = donantesFiltrados.map((d) => d.celularWhatsApp);
  const yaEnviados = telefonosConWhatsApp.length > 0
    ? await db
        .select({ telefono: difusionEnvios.telefono })
        .from(difusionEnvios)
        .where(inArray(difusionEnvios.telefono, telefonosConWhatsApp))
    : [];
  const yaEnviadosSet = new Set(yaEnviados.map((r) => r.telefono));
  const antesDeExcluir = donantesFiltrados.length;
  donantesFiltrados = donantesFiltrados.filter((d) => !yaEnviadosSet.has(d.celularWhatsApp));
  if (antesDeExcluir !== donantesFiltrados.length) {
    logger.info(
      { excluidos: antesDeExcluir - donantesFiltrados.length },
      "Donantes excluidos por ya haber recibido difusión",
    );
  }

  if (opciones?.limite && opciones.limite > 0) {
    donantesFiltrados = donantesFiltrados.slice(0, opciones.limite);
  }

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
  const templateManana = env.DIFUSION_TEMPLATE_NAME;
  const templateTarde = env.DIFUSION_TEMPLATE_NAME_TARDE;

  // Construir mapa rápido phone → donante para evitar find() en cada envío
  const donantesPorPhone = new Map(donantesFiltrados.map((d) => [d.celularWhatsApp, d]));

  const resultado = await sendBulkWithProgress(mensajes, async (phone, message) => {
    try {
      if (usarTemplate) {
        const donante = donantesPorPhone.get(phone);
        const horario = donante?.horarioEstimado;
        // Horario < 12:00 → template mañana (3 vars: nombre, días, horario)
        // Horario >= 12:00 o sin horario → template tarde (2 vars: nombre, días)
        const esMañana = horario && horario < "12:00";
        if (esMañana) {
          await sendTemplate(phone, templateManana, "es_AR", [
            {
              type: "body",
              parameters: [
                { type: "text", text: donante?.nombre ?? "" },
                { type: "text", text: donante?.diasRecoleccion ?? "" },
                { type: "text", text: `${horario}h` },
              ],
            },
          ]);
        } else {
          await sendTemplate(phone, templateTarde, "es_AR", [
            {
              type: "body",
              parameters: [
                { type: "text", text: donante?.nombre ?? "" },
                { type: "text", text: donante?.diasRecoleccion ?? "" },
              ],
            },
          ]);
        }
      } else {
        // Modo texto libre (funciona sin template pero Meta cobra como marketing)
        await sendMessage(phone, message);
      }
    } catch (err) {
      const donante = donantesPorPhone.get(phone);
      const horario = donante?.horarioEstimado;
      const templateUsado = usarTemplate
        ? (horario && horario < "12:00" ? templateManana : templateTarde)
        : undefined;
      await addToDeadLetterQueue({
        telefono: phone,
        tipo: usarTemplate ? "template" : "texto",
        contenido: message,
        templateName: templateUsado,
        errorMessage: (err as Error).message,
      });
      throw err;
    }
  }, {
    delayMs: 1000,      // 1 mensaje por segundo — seguro para 360dialog
    batchSize: 100,
    batchPauseMs: 3000,
    onProgress: (sent, failed, total) => {
      if ((sent + failed) % 10 === 0 || sent + failed === total) {
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

// ============================================================
// Difusión nueva: recoleccion_lj (sin params) y recoleccion_mvms (1 param: días)
// ============================================================

/**
 * Envía difusión masiva a TODAS las donantes:
 * - Donantes de LJ (Lunes y Jueves) → template "recoleccion_lj" (sin parámetros)
 * - Donantes de MV (Miércoles y Viernes) → template "recoleccion_mvms" con {{1}} = "Miércoles y Viernes"
 * - Donantes de MS (Martes y Sábado) → template "recoleccion_mvms" con {{1}} = "Martes y Sábado"
 *
 * No se bloquea por registros existentes en difusion_envios (hace upsert).
 */
export async function enviarDifusionNueva(opciones?: {
  soloGrupos?: string[];  // ej: ["MV", "MS"] para reenviar solo esos grupos
}): Promise<{
  total: number;
  enviados: number;
  fallidos: number;
  porGrupo: {
    lj: { total: number; enviados: number; fallidos: number };
    mv: { total: number; enviados: number; fallidos: number };
    ms: { total: number; enviados: number; fallidos: number };
  };
}> {
  const resumenRutas = importarRutas();
  const todosConTelefono = resumenRutas.donantes.filter((d) => d.celularWhatsApp);
  const filtro = opciones?.soloGrupos;

  // Separar en tres grupos (vaciar si no está en el filtro)
  const grupoLJ = (!filtro || filtro.includes("LJ"))
    ? todosConTelefono.filter((d) => d.archivoOrigen.startsWith("LJ")) : [];
  const grupoMV = (!filtro || filtro.includes("MV"))
    ? todosConTelefono.filter((d) => d.archivoOrigen.startsWith("MV")) : [];
  const grupoMS = (!filtro || filtro.includes("MS"))
    ? todosConTelefono.filter((d) => d.archivoOrigen.startsWith("MS")) : [];

  logger.info(
    {
      totalLJ: grupoLJ.length,
      totalMV: grupoMV.length,
      totalMS: grupoMS.length,
      totalGeneral: todosConTelefono.length,
    },
    "Iniciando difusión nueva",
  );

  const TEMPLATE_LJ = "recoleccion_lj";
  const TEMPLATE_MV = "recoleccion_martesyviernes";   // MV = Martes y Viernes, sin parámetros
  const TEMPLATE_MS = "recoleccion_miercolesysabado"; // MS = Miércoles y Sábado, sin parámetros

  // ── Función auxiliar genérica para enviar un grupo con un template sin parámetros ──
  async function enviarGrupoSinParams(
    donantesList: DonantesRuta[],
    templateName: string,
    grupo: string,
  ): Promise<{ total: number; enviados: number; fallidos: number }> {
    if (donantesList.length === 0) return { total: 0, enviados: 0, fallidos: 0 };

    const mensajes = donantesList.map((d) => ({
      phone: d.celularWhatsApp,
      message: grupo,
    }));

    const resultado = await sendBulkWithProgress(mensajes, async (phone) => {
      try {
        await sendTemplate(phone, templateName, "es_AR");
      } catch (err) {
        await addToDeadLetterQueue({
          telefono: phone,
          tipo: "template",
          contenido: `Template: ${templateName}`,
          templateName,
          errorMessage: (err as Error).message,
        });
        throw err;
      }
    }, {
      delayMs: 1000,
      batchSize: 100,
      batchPauseMs: 3000,
      onProgress: (sent, failed, total) => {
        if ((sent + failed) % 10 === 0 || sent + failed === total) {
          logger.info({ sent, failed, total, grupo }, "Progreso difusión nueva");
        }
      },
    });

    return { total: donantesList.length, enviados: resultado.sent, fallidos: resultado.failed };
  }

  // Aliases para claridad
  const enviarGrupoLJ = (d: DonantesRuta[]) => enviarGrupoSinParams(d, TEMPLATE_LJ, "LJ");
  const enviarGrupoMV = (d: DonantesRuta[]) => enviarGrupoSinParams(d, TEMPLATE_MV, "MV");
  const enviarGrupoMS = (d: DonantesRuta[]) => enviarGrupoSinParams(d, TEMPLATE_MS, "MS");

  // ── Registrar en DB (conversation_states + difusion_envios) ──
  async function registrarEnviados(donantesList: DonantesRuta[]): Promise<void> {
    for (const d of donantesList) {
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
            nombre: d.nombre,
            diasRecoleccion: d.diasRecoleccion,
            chofer: d.chofer,
            horarioEstimado: d.horarioEstimado ?? null,
            confirmado: false,
            fechaEnvio: new Date(),
            fechaConfirmacion: null,
          },
        });
    }
  }

  // ── Ejecutar en orden: LJ → MV → MS ──
  const resultadoLJ = await enviarGrupoLJ(grupoLJ);
  await registrarEnviados(grupoLJ);

  const resultadoMV = await enviarGrupoMV(grupoMV);
  await registrarEnviados(grupoMV);

  const resultadoMS = await enviarGrupoMS(grupoMS);
  await registrarEnviados(grupoMS);

  const totalEnviados = resultadoLJ.enviados + resultadoMV.enviados + resultadoMS.enviados;
  const totalFallidos = resultadoLJ.fallidos + resultadoMV.fallidos + resultadoMS.fallidos;

  logger.info(
    {
      total: todosConTelefono.length,
      enviados: totalEnviados,
      fallidos: totalFallidos,
      lj: resultadoLJ,
      mv: resultadoMV,
      ms: resultadoMS,
    },
    "Difusión nueva completada",
  );

  // Notificar al CEO
  try {
    await sendMessage(
      env.CEO_PHONE,
      `📨 *Difusión nueva completada*\n\n` +
        `✅ Lunes y Jueves: ${resultadoLJ.enviados}/${resultadoLJ.total}\n` +
        `✅ Miércoles y Viernes: ${resultadoMV.enviados}/${resultadoMV.total}\n` +
        `✅ Martes y Sábado: ${resultadoMS.enviados}/${resultadoMS.total}\n\n` +
        `Total: ${totalEnviados} enviados, ${totalFallidos} fallidos`,
    );
  } catch (err) {
    logger.error({ err }, "Error notificando al CEO sobre difusión nueva");
  }

  return {
    total: todosConTelefono.length,
    enviados: totalEnviados,
    fallidos: totalFallidos,
    porGrupo: { lj: resultadoLJ, mv: resultadoMV, ms: resultadoMS },
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
