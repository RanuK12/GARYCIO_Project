import { FlowHandler, ConversationState, FlowResponse, MediaInfo } from "./types";
import { procesarComprobante, TipoComprobante } from "../../services/image-processor";
import { logger } from "../../config/logger";

/**
 * Flow para choferes.
 * El chofer se identifica con su código/número y puede:
 * - Registrar litros y bidones recolectados
 * - Registrar carga de combustible
 * - Reportar incidentes (notificación INMEDIATA al CEO)
 * - Enviar fotos de comprobantes (recolección, combustible, lavado)
 * - Finalizar jornada
 *
 * Steps:
 * 0  - Identificación
 * 1  - Menú principal
 * 2  - Litros
 * 3  - Bidones
 * 4  - Confirmar recolección
 * 10 - Combustible (litros, monto)
 * 11 - Confirmar combustible
 * 20 - Tipo de incidente
 * 21 - Descripción del incidente
 * 22 - Gravedad del incidente
 * 30 - Tipo de comprobante (foto)
 * 31 - Esperando foto
 * 32 - Confirmar datos extraídos de la foto
 */
export const choferFlow: FlowHandler = {
  name: "chofer",
  keyword: ["chofer", "recolector", "registro", "cargar datos", "litros"],

  async handle(state: ConversationState, message: string, mediaInfo?: MediaInfo): Promise<FlowResponse> {
    const respuesta = message.trim();

    switch (state.step) {
      case 0: return handleIdentificacion(respuesta);
      case 1: return handleMenuChofer(respuesta, state);
      case 2: return handleLitros(respuesta);
      case 3: return handleBidones(respuesta, state);
      case 4: return handleConfirmacionRecoleccion(respuesta, state);
      case 10: return handleCombustible(respuesta, state);
      case 11: return handleConfirmacionCombustible(respuesta, state);
      case 20: return handleTipoIncidente(respuesta);
      case 21: return handleDescripcionIncidente(respuesta, state);
      case 22: return handleGravedadIncidente(respuesta, state);
      case 30: return handleTipoComprobante(respuesta);
      case 31: return handleRecibirFoto(respuesta, state, mediaInfo);
      case 32: return handleConfirmarDatosFoto(respuesta, state);
      case 40: return handleBajaDonante(respuesta);
      case 41: return handleBajaMotivo(respuesta, state);
      case 42: return handleBajaConfirmar(respuesta, state);
      case 99: return handleVolverOFinalizar(respuesta, state);
      default:
        return { reply: "Sesión finalizada. Escribí *chofer* para volver al menú.", endFlow: true };
    }
  },
};

// ── Identificación ──────────────────────────────────
function handleIdentificacion(respuesta: string): FlowResponse {
  const match = respuesta.match(/(\d+)/);

  if (!match) {
    return {
      reply:
        "🚛 *Registro de Chofer*\n\n" +
        "Ingresá tu *número de chofer* para identificarte.\n" +
        "(ej: *1*, *2*, *CH01*, etc.)",
      nextStep: 0,
    };
  }

  const codigoChofer = match[1].padStart(2, "0");

  return {
    reply:
      `✅ Identificado como *Chofer #${codigoChofer}*\n\n` +
      "¿Qué querés registrar?\n\n" +
      MENU_CHOFER + "\n\n" +
      "Respondé con el número.",
    nextStep: 1,
    data: { codigoChofer, choferId: parseInt(match[1], 10) },
  };
}

// ── Menú principal ──────────────────────────────────

const MENU_CHOFER =
  "*1* - Litros y bidones recolectados\n" +
  "*2* - Carga de combustible\n" +
  "*3* - Reportar incidente\n" +
  "*4* - Enviar foto/comprobante 📸\n" +
  "*5* - Reportar donante de baja\n" +
  "*6* - Finalizar jornada\n" +
  "*0* - Volver al menú principal";

function handleMenuChofer(respuesta: string, state: ConversationState): FlowResponse {
  const lower = respuesta.toLowerCase();

  if (lower === "0" || lower.includes("volver") || lower.includes("salir") || lower.includes("menu principal")) {
    return {
      reply: "Saliste del registro de chofer. Escribí cualquier cosa para volver al menú principal.",
      endFlow: true,
    };
  }

  if (lower === "1" || lower.includes("litro") || lower.includes("bidon")) {
    return {
      reply:
        "🥛 *Registro de recolección*\n\n" +
        "¿Cuántos *litros* recolectaste en total hoy?\n" +
        "(ej: *850*, *1200.5*)",
      nextStep: 2,
    };
  }

  if (lower === "2" || lower.includes("combustible") || lower.includes("nafta")) {
    return {
      reply:
        "⛽ *Carga de combustible*\n\n" +
        "Ingresá los litros y el monto separados por coma:\n" +
        "(ej: *45, 12500*)",
      nextStep: 10,
    };
  }

  if (lower === "3" || lower.includes("incidente") || lower.includes("novedad") || lower.includes("problema")) {
    return {
      reply:
        "🚨 *Reportar Incidente*\n\n" +
        "¿Qué tipo de incidente?\n\n" +
        "*1* - Accidente de tránsito\n" +
        "*2* - Retraso significativo\n" +
        "*3* - Avería del camión\n" +
        "*4* - Robo o intento de robo\n" +
        "*5* - Problema climático\n" +
        "*6* - Otro\n\n" +
        "Respondé con el número.",
      nextStep: 20,
    };
  }

  if (lower === "4" || lower.includes("foto") || lower.includes("comprobante") || lower.includes("imagen")) {
    return {
      reply:
        "📸 *Enviar Comprobante / Foto*\n\n" +
        "¿Qué tipo de comprobante querés enviar?\n\n" +
        "*1* - Foto de bidones recolectados\n" +
        "*2* - Ticket de combustible\n" +
        "*3* - Foto de lavado de camión\n\n" +
        "Respondé con el número.",
      nextStep: 30,
    };
  }

  if (lower === "5" || lower.includes("baja")) {
    return {
      reply:
        "⚠️ *Reportar donante de baja*\n\n" +
        "Ingresá el *nombre y/o dirección* de la donante:",
      nextStep: 40,
    };
  }

  if (lower === "6" || lower.includes("finalizar")) {
    return {
      reply:
        `✅ *Jornada finalizada - Chofer #${state.data.codigoChofer}*\n\n` +
        "¡Buen trabajo hoy! 💪 Los datos quedaron cargados.\n" +
        "Mañana no te olvides de cargar los litros.",
      endFlow: true,
      notify: {
        target: "admin",
        message:
          `📋 Chofer #${state.data.codigoChofer} finalizó su jornada.\n` +
          `Litros: ${state.data.litros || "No registrado"}\n` +
          `Bidones: ${state.data.bidones || "No registrado"}`,
      },
    };
  }

  return {
    reply:
      "No entendí. Respondé con un número:\n\n" + MENU_CHOFER,
    nextStep: 1,
  };
}

// ── Recolección ─────────────────────────────────────
function handleLitros(respuesta: string): FlowResponse {
  const litros = parseFloat(respuesta.replace(",", "."));
  if (isNaN(litros) || litros <= 0) {
    return { reply: "Ingresá un número válido de litros. (ej: *850*, *1200.5*)", nextStep: 2 };
  }
  return {
    reply: `Registrado: *${litros} litros*.\n\n¿Cuántos *bidones* recolectaste? (ej: *17*, *25*)`,
    nextStep: 3,
    data: { litros },
  };
}

function handleBidones(respuesta: string, state: ConversationState): FlowResponse {
  const bidones = parseInt(respuesta, 10);
  if (isNaN(bidones) || bidones <= 0) {
    return { reply: "Ingresá un número válido de bidones. (ej: *17*, *25*)", nextStep: 3 };
  }
  const promedio = (state.data.litros / bidones).toFixed(1);
  return {
    reply:
      `📋 *Resumen de recolección*\n\n` +
      `Chofer: *#${state.data.codigoChofer}*\n` +
      `Litros: *${state.data.litros}*\n` +
      `Bidones: *${bidones}*\n` +
      `Promedio/bidón: *${promedio} L*\n\n` +
      "*1* - Confirmar | *2* - Corregir",
    nextStep: 4,
    data: { bidones },
  };
}

function handleConfirmacionRecoleccion(respuesta: string, state: ConversationState): FlowResponse {
  if (!["1", "si", "sí", "sep", "ok", "dale"].some((a) => respuesta.toLowerCase().includes(a))) {
    return { reply: "¿Cuántos *litros* recolectaste? Empecemos de nuevo.", nextStep: 2, data: { litros: undefined, bidones: undefined } };
  }
  return {
    reply: "✅ *Datos guardados*\n\n¿Querés registrar algo más?\n\n*1* - Sí, seguir registrando\n*2* - Finalizar jornada\n*0* - Volver al menú principal",
    nextStep: 99,
    data: { recoleccionGuardada: true },
    notify: {
      target: "admin",
      message:
        `🥛 *Recolección registrada*\n\nChofer: #${state.data.codigoChofer}\nLitros: ${state.data.litros}\nBidones: ${state.data.bidones}\nPromedio: ${(state.data.litros / state.data.bidones).toFixed(1)} L/bidón`,
    },
  };
}

// ── Combustible ─────────────────────────────────────
function handleCombustible(respuesta: string, state: ConversationState): FlowResponse {
  const partes = respuesta.split(/[,;]/);
  if (partes.length < 2) {
    return { reply: "Formato: *litros, monto* (ej: *45, 12500*)", nextStep: 10 };
  }
  const litrosComb = parseFloat(partes[0].trim().replace(",", "."));
  const monto = parseFloat(partes[1].trim().replace(",", "."));
  if (isNaN(litrosComb) || isNaN(monto)) {
    return { reply: "Datos no válidos. Formato: *litros, monto* (ej: *45, 12500*)", nextStep: 10 };
  }
  return {
    reply:
      `⛽ *Carga de combustible*\n\nLitros: *${litrosComb}*\nMonto: *$${monto.toLocaleString("es-AR")}*\n\n*1* - Confirmar | *2* - Corregir`,
    nextStep: 11,
    data: { litrosCombustible: litrosComb, montoCombustible: monto },
  };
}

function handleConfirmacionCombustible(respuesta: string, state: ConversationState): FlowResponse {
  if (!["1", "si", "sí"].some((a) => respuesta.toLowerCase().includes(a))) {
    return { reply: "Ingresá de nuevo: *litros, monto*", nextStep: 10 };
  }
  return {
    reply: "✅ *Combustible registrado*\n\n¿Querés registrar algo más?\n\n*1* - Sí, seguir registrando\n*2* - Finalizar jornada\n*0* - Volver al menú principal",
    nextStep: 99,
    notify: {
      target: "admin",
      message:
        `⛽ *Combustible registrado*\n\nChofer: #${state.data.codigoChofer}\nLitros: ${state.data.litrosCombustible}\nMonto: $${state.data.montoCombustible?.toLocaleString("es-AR")}`,
    },
  };
}

// ── Incidentes ──────────────────────────────────────
const TIPOS_INCIDENTE: Record<string, string> = {
  "1": "accidente",
  "2": "retraso",
  "3": "averia",
  "4": "robo",
  "5": "clima",
  "6": "otro",
};

const LABELS_INCIDENTE: Record<string, string> = {
  accidente: "Accidente de tránsito",
  retraso: "Retraso significativo",
  averia: "Avería del camión",
  robo: "Robo o intento de robo",
  clima: "Problema climático",
  otro: "Otro",
};

function handleTipoIncidente(respuesta: string): FlowResponse {
  const tipo = TIPOS_INCIDENTE[respuesta.trim()];
  if (!tipo) {
    return {
      reply: "Respondé con el número del tipo de incidente (1-6):",
      nextStep: 20,
    };
  }
  return {
    reply: `Tipo: *${LABELS_INCIDENTE[tipo]}*\n\nDescribí brevemente qué pasó:`,
    nextStep: 21,
    data: { tipoIncidente: tipo },
  };
}

function handleDescripcionIncidente(respuesta: string, _state: ConversationState): FlowResponse {
  if (respuesta.length < 5) {
    return { reply: "Necesitamos más detalle. ¿Qué pasó?", nextStep: 21 };
  }
  return {
    reply:
      "¿Qué tan grave es la situación?\n\n" +
      "*1* - Baja (informativo, no afecta la operación)\n" +
      "*2* - Media (afecta parcialmente el recorrido)\n" +
      "*3* - Alta (no se puede continuar el recorrido)\n" +
      "*4* - Crítica (emergencia, se necesita asistencia)",
    nextStep: 22,
    data: { descripcionIncidente: respuesta },
  };
}

const GRAVEDADES: Record<string, string> = {
  "1": "baja", "2": "media", "3": "alta", "4": "critica",
};

const GRAVEDAD_EMOJI: Record<string, string> = {
  baja: "🟢", media: "🟡", alta: "🟠", critica: "🔴",
};

function handleGravedadIncidente(respuesta: string, state: ConversationState): FlowResponse {
  const gravedad = GRAVEDADES[respuesta.trim()] || "media";
  const tipo = state.data.tipoIncidente;
  const desc = state.data.descripcionIncidente;
  const emoji = GRAVEDAD_EMOJI[gravedad];

  // La notificación al CEO se maneja via el campo notify → handler.ts
  return {
    reply:
      `${emoji} *Incidente registrado*\n\n` +
      `Se notificó a la dirección de forma inmediata.\n` +
      `Tipo: *${LABELS_INCIDENTE[tipo]}*\n` +
      `Gravedad: *${gravedad}*\n\n` +
      "¿Necesitás registrar algo más?\n\n*1* - Sí, seguir registrando\n*2* - Finalizar jornada\n*0* - Volver al menú principal",
    nextStep: 99,
    data: { gravedadIncidente: gravedad, incidenteReportado: true },
    notify: {
      target: "admin",
      message:
        `${emoji} *INCIDENTE REPORTADO*\n\n` +
        `Chofer: *#${state.data.codigoChofer}*\n` +
        `Tipo: *${LABELS_INCIDENTE[tipo]}*\n` +
        `Gravedad: *${gravedad.toUpperCase()}*\n` +
        `Descripción: ${desc}\n` +
        `Hora: ${new Date().toLocaleTimeString("es-AR")}\n\n` +
        `_Notificación automática de GARYCIO_`,
    },
  };
}

// ── Comprobantes / Fotos ────────────────────────────────

const TIPOS_COMPROBANTE: Record<string, TipoComprobante> = {
  "1": "recoleccion",
  "2": "combustible",
  "3": "lavado",
};

const LABELS_COMPROBANTE: Record<string, string> = {
  recoleccion: "Bidones recolectados",
  combustible: "Ticket de combustible",
  lavado: "Lavado de camión",
};

function handleTipoComprobante(respuesta: string): FlowResponse {
  const tipo = TIPOS_COMPROBANTE[respuesta.trim()];

  if (!tipo) {
    return {
      reply:
        "Respondé con el número del tipo de comprobante:\n\n" +
        "*1* - Foto de bidones recolectados\n" +
        "*2* - Ticket de combustible\n" +
        "*3* - Foto de lavado de camión",
      nextStep: 30,
    };
  }

  return {
    reply:
      `📸 *${LABELS_COMPROBANTE[tipo]}*\n\n` +
      "Enviá la foto ahora.\n" +
      "Podés adjuntar una imagen directamente en el chat.\n\n" +
      "_El sistema va a leer automáticamente los datos de la foto._",
    nextStep: 31,
    data: { tipoComprobante: tipo },
  };
}

async function handleRecibirFoto(
  respuesta: string,
  state: ConversationState,
  mediaInfo?: MediaInfo,
): Promise<FlowResponse> {
  // Si no envió una imagen
  if (!mediaInfo || mediaInfo.type !== "image") {
    // Permitir cancelar
    if (["cancelar", "volver", "atras", "no"].some((w) => respuesta.toLowerCase().includes(w))) {
      return {
        reply: "Cancelado. ¿Querés registrar algo más?\n\n*1* - Sí, seguir registrando\n*2* - Finalizar jornada\n*0* - Volver al menú principal",
        nextStep: 99,
      };
    }

    return {
      reply:
        "No recibí una imagen. Por favor *enviá una foto* desde la cámara o galería.\n\n" +
        "Si querés cancelar, escribí *cancelar*.",
      nextStep: 31,
    };
  }

  // Procesar la imagen
  const tipo = state.data.tipoComprobante as TipoComprobante;
  const choferId = state.data.choferId || 0;

  try {
    const resultado = await procesarComprobante(mediaInfo.mediaId, tipo, choferId, {
      litros: state.data.litros ? parseFloat(state.data.litros) : undefined,
      bidones: state.data.bidones ? parseInt(state.data.bidones, 10) : undefined,
      monto: state.data.montoCombustible ? parseFloat(state.data.montoCombustible) : undefined,
    });

    const datos = resultado.datosExtraidos;

    // Construir resumen de lo que se detectó
    let resumen = `📋 *Datos detectados en la foto:*\n\n`;

    if (datos.litros) resumen += `  Litros: *${datos.litros}*\n`;
    if (datos.bidones) resumen += `  Bidones: *${datos.bidones}*\n`;
    if (datos.monto) resumen += `  Monto: *$${datos.monto.toLocaleString("es-AR")}*\n`;
    if (datos.fecha) resumen += `  Fecha: *${datos.fecha}*\n`;
    if (datos.patente) resumen += `  Patente: *${datos.patente}*\n`;

    if (!datos.litros && !datos.bidones && !datos.monto && !datos.fecha) {
      resumen += "  _No se pudo leer texto automáticamente de la imagen._\n";
      resumen += "  _La foto quedó guardada igual como comprobante._\n";
    }

    resumen += `\n  Confianza: ${datos.confianza}%`;
    resumen += `\n  Tipo: *${LABELS_COMPROBANTE[tipo]}*`;

    resumen += "\n\n*1* - Confirmar y guardar";
    resumen += "\n*2* - Enviar otra foto";
    resumen += "\n*3* - Cancelar";

    return {
      reply: resumen,
      nextStep: 32,
      data: {
        fotoPath: resultado.filePath,
        fotoRegistroId: resultado.registroId,
        fotoDatos: datos,
        fotoGuardada: resultado.guardadoEnDB,
      },
    };
  } catch (err) {
    logger.error({ err, mediaId: mediaInfo.mediaId }, "Error procesando foto");

    return {
      reply:
        "Hubo un error al procesar la foto. Podés intentar de nuevo:\n\n" +
        "*1* - Enviar otra foto\n" +
        "*2* - Volver al menú",
      nextStep: 31,
    };
  }
}

function handleConfirmarDatosFoto(respuesta: string, state: ConversationState): FlowResponse {
  const lower = respuesta.toLowerCase().trim();

  if (lower === "1" || lower.includes("confirm") || lower.includes("si") || lower === "sí") {
    const tipo = state.data.tipoComprobante as string;

    return {
      reply:
        `✅ *Comprobante guardado*\n\n` +
        `Tipo: *${LABELS_COMPROBANTE[tipo]}*\n` +
        `La foto y los datos quedaron registrados en el sistema.\n\n` +
        "¿Querés registrar algo más?\n\n*1* - Sí, seguir registrando\n*2* - Finalizar jornada\n*0* - Volver al menú principal",
      nextStep: 99,
      data: { comprobanteGuardado: true },
      notify: {
        target: "admin",
        message:
          `📸 *Comprobante recibido*\n\n` +
          `Chofer: *#${state.data.codigoChofer}*\n` +
          `Tipo: *${LABELS_COMPROBANTE[tipo]}*\n` +
          `Archivo: ${state.data.fotoPath || "guardado"}\n` +
          (state.data.fotoDatos?.litros ? `Litros detectados: ${state.data.fotoDatos.litros}\n` : "") +
          (state.data.fotoDatos?.monto ? `Monto detectado: $${state.data.fotoDatos.monto}\n` : "") +
          (state.data.fotoDatos?.bidones ? `Bidones detectados: ${state.data.fotoDatos.bidones}\n` : "") +
          `Hora: ${new Date().toLocaleTimeString("es-AR")}\n\n` +
          `_Notificación automática de GARYCIO_`,
      },
    };
  }

  if (lower === "2") {
    return {
      reply: "Enviá otra foto ahora:",
      nextStep: 31,
    };
  }

  // Cancelar
  return {
    reply: "Comprobante cancelado. ¿Querés registrar algo más?\n\n*1* - Sí, seguir registrando\n*2* - Finalizar jornada\n*0* - Volver al menú principal",
    nextStep: 99,
  };
}

// ── Donante de baja (steps 40-42) ──────────────────────────────────

function handleBajaDonante(respuesta: string): FlowResponse {
  if (respuesta.length < 3) {
    return { reply: "Ingresá el nombre y/o dirección de la donante:", nextStep: 40 };
  }
  return {
    reply:
      `⚠️ Donante: *${respuesta}*\n\n` +
      "¿Cuál es el motivo de la baja?\n\n" +
      "*1* - No dona más\n" +
      "*2* - Se mudó\n" +
      "*3* - Falleció\n" +
      "*4* - Dona muy poco\n" +
      "*5* - Otro motivo\n\n" +
      "Elegí una opción:",
    nextStep: 41,
    data: { bajaDonante: respuesta },
  };
}

function handleBajaMotivo(respuesta: string, state: ConversationState): FlowResponse {
  const motivos: Record<string, string> = {
    "1": "No dona más",
    "2": "Se mudó",
    "3": "Falleció",
    "4": "Dona muy poco",
    "5": "Otro",
  };
  const motivo = motivos[respuesta];
  if (!motivo) {
    return { reply: "Opción no válida. Elegí del *1* al *5*:", nextStep: 41 };
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

// ── Volver al menú o finalizar (step 99) ──────────────────────────
function handleVolverOFinalizar(respuesta: string, state: ConversationState): FlowResponse {
  if (respuesta === "1") {
    return {
      reply:
        `¿Qué querés registrar?\n\n` +
        MENU_CHOFER + "\n\n" +
        "Respondé con el número.",
      nextStep: 1,
    };
  }

  if (respuesta === "0") {
    return {
      reply: "Saliste del registro de chofer. Escribí cualquier cosa para volver al menú principal.",
      endFlow: true,
    };
  }

  // Cualquier otra respuesta (incluyendo "2") = finalizar jornada
  return {
    reply:
      `✅ *Jornada finalizada - Chofer #${state.data.codigoChofer}*\n\n` +
      "¡Buen trabajo hoy! 💪 Los datos quedaron cargados.\n" +
      "Mañana no te olvides de cargar los litros.",
    endFlow: true,
    notify: {
      target: "admin",
      message:
        `📋 Chofer #${state.data.codigoChofer} finalizó su jornada.\n` +
        `Litros: ${state.data.litros || "No registrado"}\n` +
        `Bidones: ${state.data.bidones || "No registrado"}`,
    },
  };
}

function handleBajaConfirmar(respuesta: string, state: ConversationState): FlowResponse {
  if (respuesta === "2") {
    return {
      reply: "Cancelado. ¿Querés registrar algo más?\n\n*1* - Sí, seguir registrando\n*2* - Finalizar jornada\n*0* - Volver al menú principal",
      nextStep: 99,
    };
  }
  if (respuesta !== "1") {
    return { reply: "Elegí *1* (confirmar) o *2* (cancelar):", nextStep: 42 };
  }

  return {
    reply:
      "✅ *Reporte de baja enviado a los administradores*\n\n" +
      "Ellos van a contactar a la donante para confirmar.\n\n" +
      "¿Querés registrar algo más?\n*1* - Sí, seguir registrando\n*2* - Finalizar jornada\n*0* - Volver al menú principal",
    nextStep: 99,
    data: { bajaReportada: true },
    notify: {
      target: "admin",
      message:
        `🔴 *Reporte de baja de donante*\n\n` +
        `📍 Donante: ${state.data.bajaDonante}\n` +
        `📝 Motivo: ${state.data.bajaMotivo}\n` +
        `🚛 Reportado por: Chofer #${state.data.codigoChofer}\n\n` +
        `¿Contactar a la donante para confirmar?`,
    },
  };
}
