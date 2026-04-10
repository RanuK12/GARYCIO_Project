import { FlowHandler, ConversationState, FlowResponse, MediaInfo } from "./types";
import { procesarComprobante, TipoComprobante } from "../../services/image-processor";
import { logger } from "../../config/logger";

/**
 * Flow para peones (acompañantes del chofer).
 * El peón puede:
 * - Reportar reclamos de donantes en la zona
 * - Marcar entrega de regalo a donante
 * - Reportar "donante complicada" (dirección + motivo)
 * - Reportar "no tengo lugar para el regalo" (dirección donante)
 * - Entrega donante nueva
 * - Reportar donante de baja (NO auto-desactiva, notifica admin)
 * - Enviar foto/comprobante (se pide después de cada acción como prueba)
 *
 * Steps:
 * 0  - Identificación
 * 1  - Menú principal
 * 10 - Reclamo: dirección donante
 * 11 - Reclamo: tipo
 * 12 - Reclamo: descripción + confirmar
 * 20 - Regalo: dirección donante
 * 21 - Regalo: confirmar entrega
 * 22 - Regalo: enviar foto comprobante
 * 25 - Donante complicada: dirección donante
 * 26 - Donante complicada: explicación (por qué)
 * 27 - Donante complicada: foto
 * 30 - No tengo lugar: dirección donante
 * 31 - No tengo lugar: confirmar + foto
 * 35 - Entrega donante nueva: nombre/dirección
 * 36 - Entrega donante nueva: confirmar + foto
 * 40 - Baja: nombre/dirección donante
 * 41 - Baja: motivo
 * 42 - Baja: confirmar
 * 50 - Foto: esperando foto
 * 51 - Foto: confirmar datos
 * 99 - Volver al menú o finalizar
 */
export const peonFlow: FlowHandler = {
  name: "peon",
  keyword: ["peon", "peón", "acompañante"],

  async handle(state: ConversationState, message: string, mediaInfo?: MediaInfo): Promise<FlowResponse> {
    const respuesta = message.trim();

    switch (state.step) {
      case 0: return handleIdentificacion(respuesta);
      case 1: return handleMenu(respuesta);
      case 10: return handleReclamoDireccion(respuesta);
      case 11: return handleReclamoTipo(respuesta);
      case 12: return handleReclamoDescripcion(respuesta, state);
      case 20: return handleRegaloDireccion(respuesta);
      case 21: return handleRegaloConfirmar(respuesta, state);
      case 22: return handleRegaloFoto(respuesta, state, mediaInfo);
      case 25: return handleComplicadaDireccion(respuesta);
      case 26: return handleComplicadaExplicacion(respuesta, state);
      case 27: return handleComplicadaFoto(respuesta, state, mediaInfo);
      case 30: return handleSinLugarDireccion(respuesta);
      case 31: return handleSinLugarFoto(respuesta, state, mediaInfo);
      case 35: return handleDonanteNueva(respuesta);
      case 36: return handleDonanteNuevaFoto(respuesta, state, mediaInfo);
      case 40: return handleBajaDonante(respuesta);
      case 41: return handleBajaMotivo(respuesta, state);
      case 42: return handleBajaConfirmar(respuesta, state);
      case 50: return handleRecibirFoto(respuesta, state, mediaInfo);
      case 51: return handleConfirmarFoto(respuesta, state);
      case 99: return handleVolverOFinalizar(respuesta);
      default:
        return { reply: "Sesión finalizada. Escribí *peón* para volver al menú.", endFlow: true };
    }
  },
};

// ── Identificación ──────────────────────────────────
function handleIdentificacion(respuesta: string): FlowResponse {
  const match = respuesta.match(/(\d+)/);

  if (!match) {
    return {
      reply:
        "👷 *Registro de Peón*\n\n" +
        "Ingresá tu *número de peón* para identificarte.\n" +
        "(ej: *1*, *2*, *P01*, etc.)",
      nextStep: 0,
    };
  }

  const codigoPeon = match[1].padStart(2, "0");

  return {
    reply:
      `✅ Identificado como *Peón #${codigoPeon}*\n\n` +
      "¿Qué querés hacer?\n\n" +
      MENU_PEON + "\n\n" +
      "Elegí una opción:",
    nextStep: 1,
    data: { codigoPeon, rol: "peon" },
  };
}

// ── Menú ──────────────────────────────────

const MENU_PEON =
  "*1* - Reportar reclamo de donante\n" +
  "*2* - Entrega de regalo 🎁\n" +
  "*3* - Donante complicada\n" +
  "*4* - No tengo lugar para el regalo\n" +
  "*5* - Entrega donante nueva\n" +
  "*6* - Reportar donante de baja\n" +
  "*0* - Salir";

function handleMenu(respuesta: string): FlowResponse {
  switch (respuesta) {
    case "0":
      return {
        reply: "Sesión de peón finalizada. Escribí cualquier cosa para volver al menú principal.",
        endFlow: true,
      };
    case "1":
      return {
        reply: "📋 *Reclamo de donante*\n\nIngresá la *dirección o nombre* de la donante:\n\n*0* - Volver",
        nextStep: 10,
      };
    case "2":
      return {
        reply: "🎁 *Entrega de regalo*\n\nIngresá la *dirección o nombre* de la donante a quien le entregaste el regalo:\n\n*0* - Volver",
        nextStep: 20,
      };
    case "3":
      return {
        reply: "⚠️ *Donante complicada*\n\nIngresá la *dirección* de la donante:\n\n*0* - Volver",
        nextStep: 25,
      };
    case "4":
      return {
        reply: "📦 *No tengo lugar para el regalo*\n\nIngresá la *dirección* de la donante:\n\n*0* - Volver",
        nextStep: 30,
      };
    case "5":
      return {
        reply: "🆕 *Entrega donante nueva*\n\nIngresá el *nombre y dirección* de la donante nueva:\n\n*0* - Volver",
        nextStep: 35,
      };
    case "6":
      return {
        reply: "⚠️ *Reportar donante de baja*\n\nIngresá el *nombre y dirección* de la donante:\n\n*0* - Volver",
        nextStep: 40,
      };
    default:
      return {
        reply: "Opción no válida. Elegí del *0* al *6*:\n\n" + MENU_PEON,
        nextStep: 1,
      };
  }
}

// ── Reclamo (steps 10-12) ──────────────────────────────────
function handleReclamoDireccion(respuesta: string): FlowResponse {
  if (respuesta === "0") {
    return { reply: "¿Qué querés hacer?\n\n" + MENU_PEON + "\n\nElegí una opción:", nextStep: 1 };
  }
  if (respuesta.length < 3) {
    return { reply: "Ingresá la dirección o nombre de la donante:\n\n*0* - Volver", nextStep: 10 };
  }
  return {
    reply:
      `📍 Donante: *${respuesta}*\n\n` +
      "¿Qué tipo de reclamo?\n\n" +
      "*1* - No le dejaron regalo\n" +
      "*2* - Falta bidón\n" +
      "*3* - Nueva pelela\n" +
      "*4* - Otro\n" +
      "*0* - Volver\n\n" +
      "Elegí una opción:",
    nextStep: 11,
    data: { reclamoDonante: respuesta },
  };
}

function handleReclamoTipo(respuesta: string): FlowResponse {
  if (respuesta === "0") {
    return { reply: "📋 *Reclamo de donante*\n\nIngresá la *dirección o nombre* de la donante:\n\n*0* - Volver", nextStep: 10 };
  }
  const tipos: Record<string, string> = { "1": "regalo", "2": "falta_bidon", "3": "nueva_pelela", "4": "otro" };
  const tipo = tipos[respuesta];
  if (!tipo) {
    return { reply: "Opción no válida. Elegí *1*, *2*, *3* o *4*:\n\n*0* - Volver", nextStep: 11 };
  }
  return {
    reply: "Describí brevemente el reclamo (o escribí *-* si no hay más detalle):\n\n*0* - Volver",
    nextStep: 12,
    data: { reclamoTipo: tipo },
  };
}

function handleReclamoDescripcion(respuesta: string, state: ConversationState): FlowResponse {
  if (respuesta === "0") {
    return {
      reply:
        `📍 Donante: *${state.data.reclamoDonante}*\n\n¿Qué tipo de reclamo?\n\n` +
        "*1* - No le dejaron regalo\n*2* - Falta bidón\n*3* - Nueva pelela\n*4* - Otro\n*0* - Volver\n\nElegí una opción:",
      nextStep: 11,
    };
  }
  const descripcion = respuesta === "-" ? null : respuesta;
  const donante = state.data.reclamoDonante || "Desconocida";
  const tipo = state.data.reclamoTipo || "otro";

  return {
    reply:
      "✅ *Reclamo registrado*\n\n" +
      `📍 Donante: ${donante}\n` +
      `📋 Tipo: ${tipo}\n` +
      `📝 Detalle: ${descripcion || "Sin detalle"}\n\n` +
      "Se notificará a los administradores.\n\n" +
      "¿Querés hacer algo más?\n" +
      "*1* - Sí, volver al menú\n" +
      "*0* - Volver al menú de peón",
    nextStep: 99,
    data: {
      reclamoDescripcion: descripcion,
      reclamoRegistrado: true,
    },
    notify: {
      target: "admin",
      message:
        `⚠️ *Reclamo reportado por peón #${state.data.codigoPeon}*\n\n` +
        `📍 Donante: ${donante}\n` +
        `📋 Tipo: ${tipo}\n` +
        `📝 Detalle: ${descripcion || "Sin detalle"}`,
    },
  };
}

// ── Entrega de regalo (steps 20-22) ──────────────────────────────────
function handleRegaloDireccion(respuesta: string): FlowResponse {
  if (respuesta === "0") {
    return { reply: "¿Qué querés hacer?\n\n" + MENU_PEON + "\n\nElegí una opción:", nextStep: 1 };
  }
  if (respuesta.length < 3) {
    return { reply: "Ingresá la dirección o nombre de la donante:\n\n*0* - Volver", nextStep: 20 };
  }
  return {
    reply:
      `🎁 Donante: *${respuesta}*\n\n` +
      "¿Confirmás que se entregó el regalo?\n\n" +
      "*1* - Sí, entregado\n" +
      "*2* - No, cancelar",
    nextStep: 21,
    data: { regaloDonante: respuesta },
  };
}

function handleRegaloConfirmar(respuesta: string, state: ConversationState): FlowResponse {
  if (respuesta === "2") {
    return {
      reply: "Cancelado.\n\n¿Querés hacer algo más?\n*1* - Sí, volver al menú\n*0* - Volver al menú de peón",
      nextStep: 99,
    };
  }
  if (respuesta !== "1") {
    return { reply: "Elegí *1* (sí) o *2* (no):", nextStep: 21 };
  }

  return {
    reply:
      `✅ *Regalo entregado* a ${state.data.regaloDonante}\n\n` +
      "📸 Enviá una *foto* como comprobante de que pasaste por la casa:",
    nextStep: 22,
    data: { regaloEntregado: true, regaloFecha: new Date().toISOString() },
  };
}

async function handleRegaloFoto(
  respuesta: string,
  state: ConversationState,
  mediaInfo?: MediaInfo,
): Promise<FlowResponse> {
  if (!mediaInfo || mediaInfo.type !== "image") {
    return {
      reply: "📸 Enviá una *foto* como comprobante.",
      nextStep: 22,
    };
  }

  try {
    await procesarComprobante(
      mediaInfo.mediaId,
      "recoleccion",
      parseInt(state.data.codigoPeon || "0", 10),
    );
  } catch (err) {
    logger.error({ err }, "Error procesando foto de regalo peón");
  }

  return {
    reply:
      "📸 *Foto recibida*\n\n" +
      "¿Querés hacer algo más?\n*1* - Sí, volver al menú\n*0* - Volver al menú de peón",
    nextStep: 99,
    data: { fotoGuardada: true },
  };
}

// ── Donante complicada (steps 25-27) ──────────────────────────────────
function handleComplicadaDireccion(respuesta: string): FlowResponse {
  if (respuesta === "0") {
    return { reply: "¿Qué querés hacer?\n\n" + MENU_PEON + "\n\nElegí una opción:", nextStep: 1 };
  }
  if (respuesta.length < 3) {
    return { reply: "Ingresá la *dirección* de la donante:\n\n*0* - Volver", nextStep: 25 };
  }
  return {
    reply:
      `⚠️ Dirección: *${respuesta}*\n\n` +
      "¿Por qué es complicada? Explicá brevemente:\n\n" +
      "*0* - Volver",
    nextStep: 26,
    data: { complicadaDireccion: respuesta },
  };
}

function handleComplicadaExplicacion(respuesta: string, state: ConversationState): FlowResponse {
  if (respuesta === "0") {
    return {
      reply: "⚠️ *Donante complicada*\n\nIngresá la *dirección* de la donante:\n\n*0* - Volver",
      nextStep: 25,
    };
  }
  if (respuesta.length < 3) {
    return { reply: "Explicá brevemente por qué es complicada:\n\n*0* - Volver", nextStep: 26 };
  }

  return {
    reply:
      `⚠️ Donante complicada reportada.\n\n` +
      `📍 Dirección: ${state.data.complicadaDireccion}\n` +
      `📝 Motivo: ${respuesta}\n\n` +
      "📸 Enviá una *foto* como comprobante de que pasaste por la casa:\n\n*0* - Omitir foto",
    nextStep: 27,
    data: { complicadaMotivo: respuesta },
    notify: {
      target: "admin",
      message:
        `⚠️ *Donante complicada*\n\n` +
        `📍 Dirección: ${state.data.complicadaDireccion}\n` +
        `📝 Motivo: ${respuesta}\n` +
        `👷 Reportado por: Peón #${state.data.codigoPeon}`,
    },
  };
}

async function handleComplicadaFoto(
  respuesta: string,
  state: ConversationState,
  mediaInfo?: MediaInfo,
): Promise<FlowResponse> {
  if (respuesta === "0") {
    return {
      reply:
        "✅ Reporte de donante complicada registrado.\n\n" +
        "¿Querés hacer algo más?\n*1* - Sí, volver al menú\n*0* - Volver al menú de peón",
      nextStep: 99,
      data: { complicadaRegistrada: true },
    };
  }

  if (!mediaInfo || mediaInfo.type !== "image") {
    return {
      reply: "📸 Enviá una *foto* como comprobante.\n\n*0* - Omitir foto",
      nextStep: 27,
    };
  }

  try {
    await procesarComprobante(
      mediaInfo.mediaId,
      "recoleccion",
      parseInt(state.data.codigoPeon || "0", 10),
    );
  } catch (err) {
    logger.error({ err }, "Error procesando foto complicada peón");
  }

  return {
    reply:
      "📸 *Foto recibida* - Reporte de donante complicada registrado.\n\n" +
      "¿Querés hacer algo más?\n*1* - Sí, volver al menú\n*0* - Volver al menú de peón",
    nextStep: 99,
    data: { fotoGuardada: true, complicadaRegistrada: true },
  };
}

// ── No tengo lugar para el regalo (steps 30-31) ──────────────────────
function handleSinLugarDireccion(respuesta: string): FlowResponse {
  if (respuesta === "0") {
    return { reply: "¿Qué querés hacer?\n\n" + MENU_PEON + "\n\nElegí una opción:", nextStep: 1 };
  }
  if (respuesta.length < 3) {
    return { reply: "Ingresá la *dirección* de la donante:\n\n*0* - Volver", nextStep: 30 };
  }
  return {
    reply:
      `📦 Sin lugar para dejar regalo en: *${respuesta}*\n\n` +
      "📸 Enviá una *foto* como comprobante de que pasaste por la casa:",
    nextStep: 31,
    data: { sinLugarDireccion: respuesta },
    notify: {
      target: "admin",
      message:
        `📦 *Sin lugar para regalo*\n\n` +
        `📍 Dirección: ${respuesta}\n` +
        `👷 Peón #(ver contexto)`,
    },
  };
}

async function handleSinLugarFoto(
  respuesta: string,
  state: ConversationState,
  mediaInfo?: MediaInfo,
): Promise<FlowResponse> {
  if (!mediaInfo || mediaInfo.type !== "image") {
    return {
      reply: "📸 Enviá una *foto* como comprobante.",
      nextStep: 31,
    };
  }

  try {
    await procesarComprobante(
      mediaInfo.mediaId,
      "recoleccion",
      parseInt(state.data.codigoPeon || "0", 10),
    );
  } catch (err) {
    logger.error({ err }, "Error procesando foto sin lugar peón");
  }

  return {
    reply:
      "📸 *Foto recibida* - Reporte de sin lugar para regalo registrado.\n\n" +
      "¿Querés hacer algo más?\n*1* - Sí, volver al menú\n*0* - Volver al menú de peón",
    nextStep: 99,
    data: { fotoGuardada: true, sinLugarRegistrado: true },
    notify: {
      target: "admin",
      message:
        `📦 *Sin lugar para regalo - Foto recibida*\n\n` +
        `📍 Dirección: ${state.data.sinLugarDireccion}\n` +
        `👷 Peón #${state.data.codigoPeon}`,
    },
  };
}

// ── Entrega donante nueva (steps 35-36) ──────────────────────
function handleDonanteNueva(respuesta: string): FlowResponse {
  if (respuesta === "0") {
    return { reply: "¿Qué querés hacer?\n\n" + MENU_PEON + "\n\nElegí una opción:", nextStep: 1 };
  }
  if (respuesta.length < 3) {
    return { reply: "Ingresá el *nombre y dirección* de la donante nueva:\n\n*0* - Volver", nextStep: 35 };
  }
  return {
    reply:
      `🆕 Donante nueva: *${respuesta}*\n\n` +
      "📸 Enviá una *foto* como comprobante de que pasaste por la casa:",
    nextStep: 36,
    data: { donanteNueva: respuesta },
    notify: {
      target: "admin",
      message:
        `🆕 *Entrega a donante nueva*\n\n` +
        `📍 Donante: ${respuesta}\n` +
        `👷 Peón #(ver contexto)`,
    },
  };
}

async function handleDonanteNuevaFoto(
  respuesta: string,
  state: ConversationState,
  mediaInfo?: MediaInfo,
): Promise<FlowResponse> {
  if (!mediaInfo || mediaInfo.type !== "image") {
    return {
      reply: "📸 Enviá una *foto* como comprobante.",
      nextStep: 36,
    };
  }

  try {
    await procesarComprobante(
      mediaInfo.mediaId,
      "recoleccion",
      parseInt(state.data.codigoPeon || "0", 10),
    );
  } catch (err) {
    logger.error({ err }, "Error procesando foto donante nueva peón");
  }

  return {
    reply:
      "📸 *Foto recibida* - Entrega a donante nueva registrada.\n\n" +
      "¿Querés hacer algo más?\n*1* - Sí, volver al menú\n*0* - Volver al menú de peón",
    nextStep: 99,
    data: { fotoGuardada: true, donanteNuevaRegistrada: true },
    notify: {
      target: "admin",
      message:
        `🆕 *Entrega a donante nueva - Foto recibida*\n\n` +
        `📍 Donante: ${state.data.donanteNueva}\n` +
        `👷 Peón #${state.data.codigoPeon}`,
    },
  };
}

// ── Donante de baja (steps 40-42) ──────────────────────────────────
function handleBajaDonante(respuesta: string): FlowResponse {
  if (respuesta === "0") {
    return { reply: "¿Qué querés hacer?\n\n" + MENU_PEON + "\n\nElegí una opción:", nextStep: 1 };
  }
  if (respuesta.length < 3) {
    return { reply: "Ingresá el *nombre y dirección* de la donante:\n\n*0* - Volver", nextStep: 40 };
  }
  return {
    reply:
      `⚠️ Donante: *${respuesta}*\n\n` +
      "¿Cuál es el motivo de la baja?\n\n" +
      "*1* - No dona más\n" +
      "*2* - Se mudó\n" +
      "*3* - Falleció\n" +
      "*4* - Dona muy poco\n" +
      "*5* - Otro motivo\n" +
      "*0* - Volver\n\n" +
      "Elegí una opción:",
    nextStep: 41,
    data: { bajaDonante: respuesta },
  };
}

function handleBajaMotivo(respuesta: string, state: ConversationState): FlowResponse {
  if (respuesta === "0") {
    return { reply: "¿Qué querés hacer?\n\n" + MENU_PEON + "\n\nElegí una opción:", nextStep: 1 };
  }
  const motivos: Record<string, string> = {
    "1": "No dona más",
    "2": "Se mudó",
    "3": "Falleció",
    "4": "Dona muy poco",
    "5": "Otro",
  };
  const motivo = motivos[respuesta];
  if (!motivo) {
    return { reply: "Opción no válida. Elegí del *1* al *5*:\n\n*0* - Volver", nextStep: 41 };
  }
  return {
    reply:
      `📋 *Confirmar reporte de baja*\n\n` +
      `📍 Donante: ${state.data.bajaDonante}\n` +
      `📝 Motivo: ${motivo}\n\n` +
      "⚠️ *No se dará de baja automáticamente.* Se notificará a los administradores.\n\n" +
      "*1* - Confirmar\n" +
      "*2* - Cancelar",
    nextStep: 42,
    data: { bajaMotivo: motivo },
  };
}

function handleBajaConfirmar(respuesta: string, state: ConversationState): FlowResponse {
  if (respuesta === "2") {
    return {
      reply: "Cancelado.\n\n¿Querés hacer algo más?\n*1* - Sí, volver al menú\n*0* - Volver al menú de peón",
      nextStep: 99,
    };
  }
  if (respuesta !== "1") {
    return { reply: "Elegí *1* (confirmar) o *2* (cancelar):", nextStep: 42 };
  }

  const donante = state.data.bajaDonante || "Desconocida";
  const motivo = state.data.bajaMotivo || "Sin motivo";

  return {
    reply:
      "✅ *Reporte de baja enviado a los administradores*\n\n" +
      "Ellos van a contactar a la donante para confirmar.\n\n" +
      "¿Querés hacer algo más?\n*1* - Sí, volver al menú\n*0* - Volver al menú de peón",
    nextStep: 99,
    data: { bajaReportada: true },
    notify: {
      target: "admin",
      message:
        `🔴 *Reporte de baja de donante*\n\n` +
        `📍 Donante: ${donante}\n` +
        `📝 Motivo: ${motivo}\n` +
        `👷 Reportado por: Peón #${state.data.codigoPeon}\n\n` +
        `¿Contactar a la donante para confirmar?`,
    },
  };
}

// ── Foto genérica (steps 50-51) — fallback si se necesita ──────────
async function handleRecibirFoto(
  respuesta: string,
  state: ConversationState,
  mediaInfo?: MediaInfo,
): Promise<FlowResponse> {
  if (!mediaInfo || mediaInfo.type !== "image") {
    return {
      reply: "📸 Necesito que envíes una *foto*. Tomá una foto y enviala.",
      nextStep: 50,
    };
  }

  try {
    const resultado = await procesarComprobante(
      mediaInfo.mediaId,
      (state.data.fotoTipo as TipoComprobante) || "recoleccion",
      parseInt(state.data.codigoPeon || "0", 10),
    );

    const datosExtraidos = resultado.datosExtraidos;
    let resumen = "📊 *Datos extraídos de la foto:*\n\n";
    if (datosExtraidos.litros) resumen += `⛽ Litros: ${datosExtraidos.litros}\n`;
    if (datosExtraidos.monto) resumen += `💰 Monto: $${datosExtraidos.monto}\n`;
    if (datosExtraidos.bidones) resumen += `🛢️ Bidones: ${datosExtraidos.bidones}\n`;
    if (datosExtraidos.fecha) resumen += `📅 Fecha: ${datosExtraidos.fecha}\n`;
    if (datosExtraidos.patente) resumen += `🚛 Patente: ${datosExtraidos.patente}\n`;

    resumen += "\n¿Los datos son correctos?\n*1* - Sí, guardar\n*2* - No, descartar";

    return {
      reply: resumen,
      nextStep: 51,
      data: { fotoResultado: resultado, fotoDatosExtraidos: datosExtraidos },
    };
  } catch (error) {
    logger.error({ error }, "Error procesando foto de peón");
    return {
      reply: "❌ No pude procesar la foto. ¿Querés intentar de nuevo?\n*1* - Sí\n*2* - No, volver al menú",
      nextStep: 51,
    };
  }
}

function handleConfirmarFoto(respuesta: string, state: ConversationState): FlowResponse {
  if (respuesta === "1" && state.data.fotoResultado) {
    return {
      reply:
        "✅ *Comprobante guardado*\n\n" +
        "¿Querés hacer algo más?\n*1* - Sí, volver al menú\n*0* - Volver al menú de peón",
      nextStep: 99,
      data: { fotoGuardada: true },
    };
  }
  return {
    reply: "¿Querés hacer algo más?\n*1* - Sí, volver al menú\n*0* - Volver al menú de peón",
    nextStep: 99,
  };
}

// ── Step 99: volver al menú o finalizar ──────────────────────────────────
function handleVolverOFinalizar(respuesta: string): FlowResponse {
  if (respuesta === "1" || respuesta === "0") {
    return {
      reply:
        "¿Qué querés hacer?\n\n" +
        MENU_PEON + "\n\n" +
        "Elegí una opción:",
      nextStep: 1,
    };
  }
  return {
    reply: "✅ ¡Jornada registrada! Buen trabajo. 💪",
    endFlow: true,
    data: { jornadaFinalizada: true },
  };
}
