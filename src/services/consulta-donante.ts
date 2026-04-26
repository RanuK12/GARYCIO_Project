/**
 * Servicio de consultas inteligentes para donantes.
 *
 * Objetivo: resolver consultas básicas con datos reales de la DB
 * (días de recolección, estado, dirección) y registrar las que no
 * pueden resolverse automáticamente para atención humana.
 */

import { db } from "../database";
import { donantes, consultas } from "../database/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { logger } from "../config/logger";

export type TipoConsulta =
  | "dias_recoleccion"
  | "estado_donante"
  | "direccion"
  | "horario"
  | "general";

interface DonanteInfo {
  id: number;
  nombre: string;
  direccion: string;
  estado: string | null;
  diasRecoleccion: string | null;
  donandoActualmente: boolean | null;
  fechaAlta: string | null;
}

async function buscarDonante(telefono: string): Promise<DonanteInfo | null> {
  const rows = await db
    .select({
      id: donantes.id,
      nombre: donantes.nombre,
      direccion: donantes.direccion,
      estado: donantes.estado,
      diasRecoleccion: donantes.diasRecoleccion,
      donandoActualmente: donantes.donandoActualmente,
      fechaAlta: donantes.fechaAlta,
    })
    .from(donantes)
    .where(eq(donantes.telefono, telefono))
    .limit(1);

  return rows.length > 0 ? rows[0] : null;
}

function detectarTipoConsulta(mensaje: string): TipoConsulta {
  const lower = mensaje.toLowerCase();

  if (
    /cu(á|a)ndo pasan|qu(é|e) d(í|i)as|d(í|i)as de recolecci(ó|o)n|cu(á|a)ndo vienen|cu(á|a)ndo retiran|horario de recolecci(ó|o)n|a qu(é|e) hora pasan/.test(
      lower,
    )
  ) {
    return "dias_recoleccion";
  }

  if (
    /soy donante|estoy registrad|estoy activa|estoy inactiva|estoy dada de alta|mi estado|estoy en el padr(ó|o)n|figuro como donante/.test(
      lower,
    )
  ) {
    return "estado_donante";
  }

  if (/mi direcci(ó|o)n|domicilio|cambio de direcci(ó|o)n|vivimos en|mi casa est(á|a) en/.test(lower)) {
    return "direccion";
  }

  if (/a qu(é|e) hora|horario|hora de recolecci(ó|o)n|en qu(é|e) momento|a qu(é|e) hora pasan/.test(lower)) {
    return "horario";
  }

  return "general";
}

function generarRespuestaDiasRecoleccion(
  donante: DonanteInfo,
): { reply: string; resuelta: boolean } {
  const nombre = donante.nombre.split(" ")[0];

  if (donante.diasRecoleccion) {
    return {
      reply:
        `Hola ${nombre}! 👋\n\n` +
        `Según nuestros registros, pasamos a retirar en tu domicilio los días: *${donante.diasRecoleccion}*.\n\n` +
        `Si tenés alguna duda sobre el horario o necesitás hacer un cambio, escribinos y te ayudamos.`,
      resuelta: true,
    };
  }

  return {
    reply:
      `Hola ${nombre}! 👋\n\n` +
      `Disculpá, en este momento no tenemos cargados los días de recolección para tu domicilio en el sistema.\n\n` +
      `Enseguida uno de nuestros encargados se va a contactar con vos para confirmarte los días exactos.`,
    resuelta: false,
  };
}

function generarRespuestaEstadoDonante(
  donante: DonanteInfo,
): { reply: string; resuelta: boolean } {
  const nombre = donante.nombre.split(" ")[0];

  if (donante.estado === "activa" && donante.donandoActualmente) {
    return {
      reply:
        `Hola ${nombre}! 👋\n\n` +
        `Sí, estás registrada como donante *activa* en nuestro sistema.\n\n` +
        `📍 Dirección: ${donante.direccion}\n` +
        `📅 Días de recolección: ${donante.diasRecoleccion || "a confirmar"}\n\n` +
        `¡Gracias por tu compromiso! 💙`,
      resuelta: true,
    };
  }

  if (donante.estado === "inactiva") {
    return {
      reply:
        `Hola ${nombre}! 👋\n\n` +
        `Sí, figuras en nuestro padrón de donantes, pero tu estado actual es *inactiva*.\n\n` +
        `Si querés retomar la donación, escribinos y te ayudamos a reactivarte.`,
      resuelta: true,
    };
  }

  if (donante.estado === "nueva") {
    return {
      reply:
        `Hola ${nombre}! 👋\n\n` +
        `Sí, estás registrada como donante, pero todavía estás en proceso de alta.\n\n` +
        `En los próximos días un encargado se va a contactar con vos para confirmar los detalles.`,
      resuelta: true,
    };
  }

  return {
    reply:
      `Hola ${nombre}! 👋\n\n` +
      `Sí, figuras en nuestro padrón de donantes.\n\n` +
      `📍 Dirección: ${donante.direccion}\n` +
      `📅 Días: ${donante.diasRecoleccion || "a confirmar"}\n` +
      `Estado: ${donante.estado}\n\n` +
      `Si necesitás algo más, escribinos.`,
    resuelta: true,
  };
}

function generarRespuestaDireccion(
  donante: DonanteInfo,
): { reply: string; resuelta: boolean } {
  const nombre = donante.nombre.split(" ")[0];
  return {
    reply:
      `Hola ${nombre}! 👋\n\n` +
      `Según nuestros registros, tu dirección de recolección es:\n\n` +
      `📍 *${donante.direccion}*\n\n` +
      `Si necesitás actualizarla o hay algún error, escribinos y lo corregimos.`,
    resuelta: true,
  };
}

function generarRespuestaHorario(
  donante: DonanteInfo,
): { reply: string; resuelta: boolean } {
  const nombre = donante.nombre.split(" ")[0];

  if (donante.diasRecoleccion) {
    return {
      reply:
        `Hola ${nombre}! 👋\n\n` +
        `Pasamos los días *${donante.diasRecoleccion}*.\n\n` +
        `En cuanto al horario exacto, depende del recorrido del día, pero generalmente es por la mañana.\n\n` +
        `Si necesitás un horario más preciso o una franja específica, te lo podemos confirmar con el encargado de tu zona.`,
      resuelta: true,
    };
  }

  return {
    reply:
      `Hola ${nombre}! 👋\n\n` +
      `Disculpá, todavía no tenemos cargado el horario exacto de recolección para tu domicilio.\n\n` +
      `Enseguida un encargado se va a contactar con vos para confirmarte los días y horarios.`,
    resuelta: false,
  };
}

/**
 * Procesa una consulta de donante:
 * 1. Busca al donante en la DB
 * 2. Detecta el tipo de consulta
 * 3. Genera respuesta personalizada con datos reales
 * 4. Si no puede resolver → guarda en tabla `consultas` para atención humana
 */
export async function procesarConsultaDonante(
  telefono: string,
  mensaje: string,
): Promise<{
  reply: string;
  resuelta: boolean;
  notify?: { target: "admin"; message: string };
  tipo: TipoConsulta;
}> {
  const donante = await buscarDonante(telefono);
  const tipo = detectarTipoConsulta(mensaje);

  // Si no está en la DB, tratar como desconocido
  if (!donante) {
    await guardarConsultaPendiente(telefono, null, mensaje, tipo, null);
    return {
      reply:
        "Disculpá, no te encontramos en nuestro padrón de donantes.\n\n" +
        "Si creés que esto es un error o si querés registrarte, escribinos y te ayudamos.",
      resuelta: false,
      notify: {
        target: "admin",
        message: `❓ *Consulta de número desconocido*\n\n📱 ${telefono}\n💬 "${mensaje.slice(0, 200)}"\n\nTipo detectado: ${tipo}\nNo figura en la base de donantes.`,
      },
      tipo,
    };
  }

  // Generar respuesta según tipo
  let resultado: { reply: string; resuelta: boolean };

  switch (tipo) {
    case "dias_recoleccion":
      resultado = generarRespuestaDiasRecoleccion(donante);
      break;
    case "estado_donante":
      resultado = generarRespuestaEstadoDonante(donante);
      break;
    case "direccion":
      resultado = generarRespuestaDireccion(donante);
      break;
    case "horario":
      resultado = generarRespuestaHorario(donante);
      break;
    default:
      resultado = {
        reply:
          `Hola ${donante.nombre.split(" ")[0]}! 👋\n\n` +
          `Recibimos tu consulta. Te respondemos a la brevedad. 📩\n\n` +
          `Una persona de nuestro equipo va a revisar tu mensaje y te va a contestar personalmente.`,
        resuelta: false,
      };
  }

  // Si no se resolvió automáticamente → guardar para atención humana
  if (!resultado.resuelta) {
    await guardarConsultaPendiente(telefono, donante.nombre, mensaje, tipo, resultado.reply);
    return {
      ...resultado,
      notify: {
        target: "admin",
        message:
          `❓ *Consulta pendiente de atención*\n\n` +
          `📱 ${telefono}\n` +
          `👤 ${donante.nombre}\n` +
          `💬 "${mensaje.slice(0, 200)}"\n` +
          `🏷️ Tipo: ${tipo}\n\n` +
          `El bot no pudo resolver automáticamente. Requiere contacto manual.`,
      },
      tipo,
    };
  }

  // Resuelta automáticamente → guardar como respondida
  await guardarConsultaPendiente(telefono, donante.nombre, mensaje, tipo, resultado.reply, "respondida");

  return { ...resultado, tipo };
}

async function guardarConsultaPendiente(
  telefono: string,
  nombreDonante: string | null,
  mensaje: string,
  tipo: TipoConsulta,
  respuestaBot: string | null,
  estado: "pendiente" | "respondida" | "escalada" = "pendiente",
): Promise<void> {
  try {
    await db.insert(consultas).values({
      telefono,
      nombreDonante: nombreDonante || null,
      mensaje: mensaje.slice(0, 500),
      tipo,
      respuestaBot: respuestaBot?.slice(0, 500) || null,
      estado,
    });
  } catch (err) {
    logger.error({ telefono, tipo, err }, "Error guardando consulta en tabla");
  }
}

/**
 * Lista consultas pendientes para el panel de admin.
 */
export async function listarConsultasPendientes(limit: number = 50) {
  return db
    .select()
    .from(consultas)
    .where(eq(consultas.estado, "pendiente"))
    .orderBy(desc(consultas.createdAt))
    .limit(limit);
}

/**
 * Marca una consulta como resuelta.
 */
export async function resolverConsulta(
  id: number,
  resolvedBy: string,
  notas?: string,
): Promise<void> {
  await db
    .update(consultas)
    .set({
      estado: "respondida",
      resolvedAt: new Date(),
      resolvedBy,
      notas: notas || null,
    })
    .where(eq(consultas.id, id));
}

/**
 * Estadísticas de consultas.
 */
export async function statsConsultas() {
  const [pendientes] = await db
    .select({ count: sql<number>`count(*)` })
    .from(consultas)
    .where(eq(consultas.estado, "pendiente"));

  const [respondidas] = await db
    .select({ count: sql<number>`count(*)` })
    .from(consultas)
    .where(eq(consultas.estado, "respondida"));

  const [escaladas] = await db
    .select({ count: sql<number>`count(*)` })
    .from(consultas)
    .where(eq(consultas.estado, "escalada"));

  return {
    pendientes: pendientes.count,
    respondidas: respondidas.count,
    escaladas: escaladas.count,
  };
}
