import { FlowHandler, ConversationState, FlowResponse, MediaInfo } from "./types";
import { procesarComprobante, TipoComprobante } from "../../services/image-processor";
import { logger } from "../../config/logger";

/**
 * Flow para choferes.
 * El chofer se identifica con su código/número y puede:
 * - Registrar bidones recolectados (+ foto obligatoria)
 * - Registrar carga de combustible (+ foto)
 * - Reportar incidentes (notificación INMEDIATA al CEO)
 * - Reportar donante de baja (auto-contacta a la donante)
 * - Registrar regalos (camión / peón 1-3 → entregados/faltantes/sobrantes/cambios)
 *
 * Steps:
 * 0  - Identificación
 * 1  - Menú principal
 * 2  - Bidones recolectados
 * 3  - Confirmar bidones
 * 4  - Foto de bidones (post-confirmación)
 * 5  - Confirmar foto bidones
 * 10 - Combustible (litros, monto)
 * 11 - Confirmar combustible
 * 12 - Foto de combustible
 * 13 - Confirmar foto combustible
 * 20 - Tipo de incidente
 * 21 - Detalle del incidente (descripción) → registra directo
 * 30 - Baja donante: nombre/dirección
 * 31 - Baja donante: motivo
 * 32 - Baja donante: confirmar → auto-contacta donante
 * 50 - Regalos: elegir vehículo/persona (camión / peón 1/2/3)
 * 51 - Regalos: nombre del peón (si es peón)
 * 52 - Regalos: tipo (entregados/faltantes/sobrantes/cambios)
 * 53 - Regalos: cantidad
 * 54 - Regalos: ¿registrar más?
 * 99 - Volver al menú o finalizar
 */
export const choferFlow: FlowHandler = {
  name: "chofer",
  keyword: ["chofer", "recolector", "registro", "cargar datos", "litros"],

  async handle(state: ConversationState, message: string, mediaInfo?: MediaInfo): Promise<FlowResponse> {
    const respuesta = message.trim();

    switch (state.step) {
      case 0: return handleIdentificacion(respuesta);
      case 1: return handleMenuChofer(respuesta, state);
      case 2: return handleBidones(respuesta);
      case 3: return handleConfirmacionBidones(respuesta, state);
      case 4: return handleFotoBidones(respuesta, state, mediaInfo);
      case 5: return handleConfirmarFotoBidones(respuesta, state);
      case 10: return handleCombustible(respuesta, state);
      case 11: return handleConfirmacionCombustible(respuesta, state);
      case 12: return handleFotoCombustible(respuesta, state, mediaInfo);
      case 13: return handleConfirmarFotoCombustible(respuesta, state);
      case 20: return handleTipoIncidente(respuesta);
      case 21: return handleDetalleIncidente(respuesta, state);
      case 30: return handleBajaDonante(respuesta);
      case 31: return handleBajaMotivo(respuesta, state);
      case 32: return handleBajaConfirmar(respuesta, state);
      case 50: return handleRegalosVehiculo(respuesta, state);
      case 51: return handleRegalosNombrePeon(respuesta, state);
      case 52: return handleRegalosSubTipo(respuesta, state);
      case 53: return handleRegalosCantidad(respuesta, state);
      case 54: return handleRegalosOtroMas(respuesta, state);
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
  "*1* - Bidones recolectados\n" +
  "*2* - Carga de combustible\n" +
  "*3* - Reportar incidente\n" +
  "*4* - Reportar donante de baja\n" +
  "*5* - Regalos 🎁\n" +
  "*0* - Salir";

function handleMenuChofer(respuesta: string, state: ConversationState): FlowResponse {
  const lower = respuesta.toLowerCase();

  if (lower === "0" || lower.includes("salir")) {
    return {
      reply: "Sesión de chofer finalizada. Escribí cualquier cosa para volver al menú principal.",
      endFlow: true,
    };
  }

  if (lower === "1" || lower.includes("bidon")) {
    return {
      reply:
        "🛢️ *Registro de recolección*\n\n" +
        "¿Cuántos *bidones* recolectaste hoy?\n" +
        "(ej: *17*, *25*)\n\n" +
        "*0* - Volver",
      nextStep: 2,
    };
  }

  if (lower === "2" || lower.includes("combustible") || lower.includes("nafta")) {
    return {
      reply:
        "⛽ *Carga de combustible*\n\n" +
        "Ingresá los litros y el monto separados por coma:\n" +
        "(ej: *45, 12500*)\n\n" +
        "*0* - Volver",
      nextStep: 10,
    };
  }

  if (lower === "3" || lower.includes("incidente") || lower.includes("novedad") || lower.includes("problema")) {
    return {
      reply:
        "🚨 *Reportar Incidente*\n\n" +
        "¿Qué tipo de incidente?\n\n" +
        "*1* - Accidente en el tránsito\n" +
        "*2* - Retraso significativo\n" +
        "*3* - Avería del camión\n" +
        "*4* - Intento de robo o robo\n" +
        "*5* - Otro\n" +
        "*0* - Volver\n\n" +
        "Respondé con el número.",
      nextStep: 20,
    };
  }

  if (lower === "4" || lower.includes("baja")) {
    return {
      reply:
        "⚠️ *Reportar donante de baja*\n\n" +
        "Ingresá el *nombre y dirección* de la donante:\n\n" +
        "*0* - Volver",
      nextStep: 30,
    };
  }

  if (lower === "5" || lower.includes("regalo")) {
    return {
      reply:
        "🎁 *Regalos*\n\n" +
        "¿Para quién es el registro?\n\n" +
        "*1* - Camión\n" +
        "*2* - Peón\n" +
        "*0* - Volver\n\n" +
        "Respondé con el número.",
      nextStep: 50,
    };
  }

  return {
    reply:
      "No entendí. Respondé con un número:\n\n" + MENU_CHOFER,
    nextStep: 1,
  };
}

// ── Recolección (solo bidones) ─────────────────────────────────────

function handleBidones(respuesta: string): FlowResponse {
  if (respuesta === "0") {
    return { reply: "¿Qué querés registrar?\n\n" + MENU_CHOFER + "\n\nRespondé con el número.", nextStep: 1 };
  }
  const bidones = parseInt(respuesta, 10);
  if (isNaN(bidones) || bidones <= 0) {
    return { reply: "Ingresá un número válido de bidones. (ej: *17*, *25*)\n\n*0* - Volver", nextStep: 2 };
  }
  return {
    reply:
      `📋 *Resumen de recolección*\n\n` +
      `Chofer: *#(ver datos)*\n` +
      `Bidones: *${bidones}*\n\n` +
      "*1* - Confirmar | *2* - Corregir",
    nextStep: 3,
    data: { bidones },
  };
}

function handleConfirmacionBidones(respuesta: string, state: ConversationState): FlowResponse {
  if (!["1", "si", "sí", "sep", "ok", "dale"].some((a) => respuesta.toLowerCase().includes(a))) {
    return { reply: "¿Cuántos *bidones* recolectaste? Empecemos de nuevo.", nextStep: 2, data: { bidones: undefined } };
  }

  return {
    reply:
      "✅ *Bidones registrados*\n\n" +
      "Ahora enviá una *foto* de los bidones recolectados. 📸",
    nextStep: 4,
    data: { recoleccionGuardada: true },
    notify: {
      target: "admin",
      message:
        `🛢️ *Recolección registrada*\n\nChofer: #${state.data.codigoChofer}\nBidones: ${state.data.bidones}`,
    },
  };
}

async function handleFotoBidones(
  respuesta: string,
  state: ConversationState,
  mediaInfo?: MediaInfo,
): Promise<FlowResponse> {
  if (!mediaInfo || mediaInfo.type !== "image") {
    return {
      reply: "📸 Enviá una *foto* de los bidones recolectados.",
      nextStep: 4,
    };
  }

  try {
    const resultado = await procesarComprobante(mediaInfo.mediaId, "recoleccion", state.data.choferId || 0, {
      bidones: state.data.bidones ? parseInt(state.data.bidones, 10) : undefined,
    });

    return {
      reply:
        "📸 *Foto recibida y procesada*\n\n" +
        "¿Querés registrar algo más?\n\n*1* - Sí, seguir registrando\n*0* - Volver al menú principal",
      nextStep: 99,
      data: { fotoPath: resultado.filePath, fotoGuardada: true },
    };
  } catch (err) {
    logger.error({ err }, "Error procesando foto de bidones");
    return {
      reply: "No pude procesar la foto, pero los bidones ya quedaron registrados.\n\n¿Querés registrar algo más?\n\n*1* - Sí, seguir registrando\n*0* - Volver al menú principal",
      nextStep: 99,
    };
  }
}

function handleConfirmarFotoBidones(respuesta: string, _state: ConversationState): FlowResponse {
  return {
    reply: "¿Querés registrar algo más?\n\n*1* - Sí, seguir registrando\n*0* - Volver al menú principal",
    nextStep: 99,
  };
}

// ── Combustible ─────────────────────────────────────
function handleCombustible(respuesta: string, state: ConversationState): FlowResponse {
  if (respuesta === "0") {
    return { reply: "¿Qué querés registrar?\n\n" + MENU_CHOFER + "\n\nRespondé con el número.", nextStep: 1 };
  }
  const partes = respuesta.split(/[,;]/);
  if (partes.length < 2) {
    return { reply: "Formato: *litros, monto* (ej: *45, 12500*)\n\n*0* - Volver", nextStep: 10 };
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
    reply:
      "✅ *Combustible registrado*\n\n" +
      "Ahora enviá una *foto* del ticket de combustible. 📸",
    nextStep: 12,
    notify: {
      target: "admin",
      message:
        `⛽ *Combustible registrado*\n\nChofer: #${state.data.codigoChofer}\nLitros: ${state.data.litrosCombustible}\nMonto: $${state.data.montoCombustible?.toLocaleString("es-AR")}`,
    },
  };
}

async function handleFotoCombustible(
  respuesta: string,
  state: ConversationState,
  mediaInfo?: MediaInfo,
): Promise<FlowResponse> {
  if (!mediaInfo || mediaInfo.type !== "image") {
    return {
      reply: "📸 Enviá una *foto* del ticket de combustible.",
      nextStep: 12,
    };
  }

  try {
    await procesarComprobante(mediaInfo.mediaId, "combustible", state.data.choferId || 0, {
      monto: state.data.montoCombustible ? parseFloat(state.data.montoCombustible) : undefined,
    });

    return {
      reply:
        "📸 *Foto del ticket recibida*\n\n" +
        "¿Querés registrar algo más?\n\n*1* - Sí, seguir registrando\n*0* - Volver al menú principal",
      nextStep: 99,
      data: { fotoTicketGuardada: true },
    };
  } catch (err) {
    logger.error({ err }, "Error procesando foto de combustible");
    return {
      reply: "No pude procesar la foto, pero el combustible ya quedó registrado.\n\n¿Querés registrar algo más?\n\n*1* - Sí, seguir registrando\n*0* - Volver al menú principal",
      nextStep: 99,
    };
  }
}

function handleConfirmarFotoCombustible(respuesta: string, _state: ConversationState): FlowResponse {
  return {
    reply: "¿Querés registrar algo más?\n\n*1* - Sí, seguir registrando\n*0* - Volver al menú principal",
    nextStep: 99,
  };
}

// ── Incidentes ──────────────────────────────────────
const TIPOS_INCIDENTE: Record<string, string> = {
  "1": "accidente_transito",
  "2": "retraso",
  "3": "averia",
  "4": "robo",
  "5": "otro",
};

const LABELS_INCIDENTE: Record<string, string> = {
  accidente_transito: "Accidente en el tránsito",
  retraso: "Retraso significativo",
  averia: "Avería del camión",
  robo: "Intento de robo o robo",
  otro: "Otro",
};

function handleTipoIncidente(respuesta: string): FlowResponse {
  if (respuesta.trim() === "0") {
    return { reply: "¿Qué querés registrar?\n\n" + MENU_CHOFER + "\n\nRespondé con el número.", nextStep: 1 };
  }
  const tipo = TIPOS_INCIDENTE[respuesta.trim()];
  if (!tipo) {
    return {
      reply: "Respondé con el número del tipo de incidente (1-5):\n\n*0* - Volver",
      nextStep: 20,
    };
  }

  // Cada tipo tiene su pregunta de seguimiento
  if (tipo === "retraso") {
    return {
      reply: `Tipo: *${LABELS_INCIDENTE[tipo]}*\n\n¿De cuánto tiempo es la demora estimada?`,
      nextStep: 21,
      data: { tipoIncidente: tipo },
    };
  }

  if (tipo === "averia") {
    return {
      reply: `Tipo: *${LABELS_INCIDENTE[tipo]}*\n\n¿Qué avería tiene el camión? Describilo brevemente:`,
      nextStep: 21,
      data: { tipoIncidente: tipo },
    };
  }

  if (tipo === "robo") {
    return {
      reply: `Tipo: *${LABELS_INCIDENTE[tipo]}*\n\n¿Qué pasó y dónde fue? Contanos brevemente:`,
      nextStep: 21,
      data: { tipoIncidente: tipo },
    };
  }

  return {
    reply: `Tipo: *${LABELS_INCIDENTE[tipo]}*\n\nDescribí brevemente qué pasó:`,
    nextStep: 21,
    data: { tipoIncidente: tipo },
  };
}

function handleDetalleIncidente(respuesta: string, state: ConversationState): FlowResponse {
  if (respuesta === "0") {
    return {
      reply:
        "🚨 *Reportar Incidente*\n\n¿Qué tipo de incidente?\n\n" +
        "*1* - Accidente en el tránsito\n*2* - Retraso significativo\n*3* - Avería del camión\n*4* - Intento de robo o robo\n*5* - Otro\n*0* - Volver\n\nRespondé con el número.",
      nextStep: 20,
    };
  }
  if (respuesta.length < 3) {
    return { reply: "Necesitamos más detalle. ¿Qué pasó?\n\n*0* - Volver", nextStep: 21 };
  }

  const tipo = state.data.tipoIncidente;

  return {
    reply:
      `🚨 *Incidente registrado*\n\n` +
      `Se notificó a la dirección de forma inmediata.\n` +
      `Tipo: *${LABELS_INCIDENTE[tipo]}*\n` +
      `Descripción: ${respuesta}\n\n` +
      "¿Necesitás registrar algo más?\n\n*1* - Sí, seguir registrando\n*0* - Volver al menú principal",
    nextStep: 99,
    data: { descripcionIncidente: respuesta, incidenteReportado: true },
    notify: {
      target: "admin",
      message:
        `🚨 *INCIDENTE REPORTADO*\n\n` +
        `Chofer: *#${state.data.codigoChofer}*\n` +
        `Tipo: *${LABELS_INCIDENTE[tipo]}*\n` +
        `Descripción: ${respuesta}\n` +
        `Hora: ${new Date().toLocaleTimeString("es-AR")}\n\n` +
        `_Notificación automática de GARYCIO_`,
    },
  };
}

// ── Donante de baja (steps 30-32) ──────────────────────────────────

function handleBajaDonante(respuesta: string): FlowResponse {
  if (respuesta === "0") {
    return { reply: "¿Qué querés registrar?\n\n" + MENU_CHOFER + "\n\nRespondé con el número.", nextStep: 1 };
  }
  if (respuesta.length < 3) {
    return { reply: "Ingresá el *nombre y dirección* de la donante:\n\n*0* - Volver", nextStep: 30 };
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
    nextStep: 31,
    data: { bajaDonante: respuesta },
  };
}

function handleBajaMotivo(respuesta: string, state: ConversationState): FlowResponse {
  if (respuesta === "0") {
    return { reply: "¿Qué querés registrar?\n\n" + MENU_CHOFER + "\n\nRespondé con el número.", nextStep: 1 };
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
    return { reply: "Opción no válida. Elegí del *1* al *5*:\n\n*0* - Volver", nextStep: 31 };
  }
  return {
    reply:
      `📋 *Confirmar reporte de baja*\n\n` +
      `📍 Donante: ${state.data.bajaDonante}\n` +
      `📝 Motivo: ${motivo}\n\n` +
      "⚠️ Se notificará a los administradores y *se contactará automáticamente a la donante* para confirmar la situación.\n\n" +
      "*1* - Confirmar\n" +
      "*2* - Cancelar",
    nextStep: 32,
    data: { bajaMotivo: motivo },
  };
}

function handleBajaConfirmar(respuesta: string, state: ConversationState): FlowResponse {
  if (respuesta === "2") {
    return {
      reply: "Cancelado. ¿Querés registrar algo más?\n\n*1* - Sí, seguir registrando\n*0* - Volver al menú principal",
      nextStep: 99,
    };
  }
  if (respuesta !== "1") {
    return { reply: "Elegí *1* (confirmar) o *2* (cancelar):", nextStep: 32 };
  }

  return {
    reply:
      "✅ *Reporte de baja enviado*\n\n" +
      "Se notificó a los administradores y se contactará a la donante automáticamente para confirmar la situación.\n\n" +
      "¿Querés registrar algo más?\n*1* - Sí, seguir registrando\n*0* - Volver al menú principal",
    nextStep: 99,
    data: { bajaReportada: true, bajaAutoContactar: true },
    notify: {
      target: "admin",
      message:
        `🔴 *Reporte de baja de donante*\n\n` +
        `📍 Donante: ${state.data.bajaDonante}\n` +
        `📝 Motivo: ${state.data.bajaMotivo}\n` +
        `🚛 Reportado por: Chofer #${state.data.codigoChofer}\n\n` +
        `⚠️ El bot contactará automáticamente a la donante para preguntar qué sucedió.\n` +
        `Si la donante contradice la baja, se marcará como conflicto.`,
    },
  };
}

// ── Regalos (steps 50-54) ─────────────────────────────────────────

const LABELS_VEHICULO: Record<string, string> = {
  "1": "Camión",
  "2": "Peón",
};

function handleRegalosVehiculo(respuesta: string, _state: ConversationState): FlowResponse {
  if (respuesta.trim() === "0") {
    return {
      reply: "¿Qué querés registrar?\n\n" + MENU_CHOFER + "\n\nRespondé con el número.",
      nextStep: 1,
    };
  }

  const label = LABELS_VEHICULO[respuesta.trim()];
  if (!label) {
    return {
      reply:
        "Opción no válida. ¿Para quién es el registro?\n\n" +
        "*1* - Camión\n*2* - Peón\n*0* - Volver",
      nextStep: 50,
    };
  }

  const esPeon = respuesta.trim() === "2";

  if (esPeon) {
    return {
      reply: `Registrando regalos para *Peón*.\n\n¿Cuál es el *nombre* del peón?\n\n*0* - Volver`,
      nextStep: 51,
      data: { regalosVehiculo: label, regalosEsPeon: true },
    };
  }

  // Camión → directo al sub-tipo
  return {
    reply:
      `Registrando regalos para *Camión*.\n\n` +
      "¿Qué querés registrar?\n\n" +
      "*1* - Entregados\n" +
      "*2* - Faltantes\n" +
      "*3* - Sobrantes\n" +
      "*4* - Cambios\n" +
      "*0* - Volver\n\n" +
      "Respondé con el número.",
    nextStep: 52,
    data: { regalosVehiculo: label, regalosEsPeon: false, regalosNombrePeon: null },
  };
}

function handleRegalosNombrePeon(respuesta: string, _state: ConversationState): FlowResponse {
  if (respuesta === "0") {
    return {
      reply:
        "🎁 *Regalos*\n\n¿Para quién es el registro?\n\n" +
        "*1* - Camión\n*2* - Peón\n*0* - Volver\n\nRespondé con el número.",
      nextStep: 50,
    };
  }

  if (respuesta.length < 2) {
    return { reply: "Ingresá el nombre del peón:\n\n*0* - Volver", nextStep: 51 };
  }

  return {
    reply:
      `Peón: *${respuesta}*\n\n` +
      "¿Qué querés registrar?\n\n" +
      "*1* - Entregados\n" +
      "*2* - Faltantes\n" +
      "*3* - Sobrantes\n" +
      "*4* - Cambios\n" +
      "*0* - Volver\n\n" +
      "Respondé con el número.",
    nextStep: 52,
    data: { regalosNombrePeon: respuesta },
  };
}

const LABELS_SUBTIPO_REGALO: Record<string, string> = {
  "1": "Entregados",
  "2": "Faltantes",
  "3": "Sobrantes",
  "4": "Cambios",
};

function handleRegalosSubTipo(respuesta: string, _state: ConversationState): FlowResponse {
  if (respuesta.trim() === "0") {
    return {
      reply:
        "🎁 *Regalos*\n\n¿Para quién es el registro?\n\n" +
        "*1* - Camión\n*2* - Peón\n*0* - Volver\n\nRespondé con el número.",
      nextStep: 50,
    };
  }

  const label = LABELS_SUBTIPO_REGALO[respuesta.trim()];
  if (!label) {
    return {
      reply:
        "Opción no válida.\n\n*1* - Entregados\n*2* - Faltantes\n*3* - Sobrantes\n*4* - Cambios\n*0* - Volver",
      nextStep: 52,
    };
  }

  // "Cambios" → pregunta "cambian" en vez de "cambios"
  const pregunta = label === "Cambios"
    ? "¿Cuántos regalos *cambian*?"
    : `¿Cuántos regalos *${label.toLowerCase()}*?`;

  return {
    reply: pregunta + "\n\n*0* - Volver",
    nextStep: 53,
    data: { regalosSubTipo: label },
  };
}

function handleRegalosCantidad(respuesta: string, state: ConversationState): FlowResponse {
  if (respuesta.trim() === "0") {
    return {
      reply:
        "¿Qué querés registrar?\n\n*1* - Entregados\n*2* - Faltantes\n*3* - Sobrantes\n*4* - Cambios\n*0* - Volver\n\nRespondé con el número.",
      nextStep: 52,
    };
  }

  const cantidad = parseInt(respuesta, 10);
  if (isNaN(cantidad) || cantidad < 0) {
    return { reply: "Ingresá un número válido (ej: *5*, *0*):\n\n*0* - Volver", nextStep: 53 };
  }

  const vehiculo = state.data.regalosVehiculo || "?";
  const nombre = state.data.regalosNombrePeon;
  const subtipo = state.data.regalosSubTipo || "?";
  const registro = { vehiculo, nombre, subtipo, cantidad };

  const listaActual: Array<typeof registro> = [...(state.data.regalosLista || []), registro];

  const resumen = listaActual
    .map((r) => `  • ${r.vehiculo}${r.nombre ? ` (${r.nombre})` : ""}: ${r.cantidad} ${r.subtipo.toLowerCase()}`)
    .join("\n");

  return {
    reply:
      `✅ Registrado: *${vehiculo}*${nombre ? ` (${nombre})` : ""} → *${cantidad} ${subtipo.toLowerCase()}*\n\n` +
      `📋 *Resumen actual:*\n${resumen}\n\n` +
      "¿Querés registrar más regalos?\n\n" +
      "*1* - Sí, registrar otro\n" +
      "*2* - No, confirmar y guardar",
    nextStep: 54,
    data: { regalosLista: listaActual, regalosUltimaCantidad: cantidad },
  };
}

function handleRegalosOtroMas(respuesta: string, state: ConversationState): FlowResponse {
  if (respuesta === "1") {
    return {
      reply:
        "🎁 ¿Para quién es el registro?\n\n" +
        "*1* - Camión\n" +
        "*2* - Peón\n" +
        "*0* - Volver\n\n" +
        "Respondé con el número.",
      nextStep: 50,
    };
  }

  // Confirmar todo
  const lista: Array<{ vehiculo: string; nombre: string | null; subtipo: string; cantidad: number }> =
    state.data.regalosLista || [];

  const resumenAdmin = lista
    .map((r) => `  ${r.vehiculo}${r.nombre ? ` (${r.nombre})` : ""}: ${r.cantidad} ${r.subtipo.toLowerCase()}`)
    .join("\n");

  const totalRegalos = lista.reduce((sum, r) => sum + r.cantidad, 0);

  return {
    reply:
      `✅ *Regalos registrados*\n\n` +
      `📦 Total registros: *${lista.length}*\n\n` +
      "¿Querés registrar algo más?\n\n*1* - Sí, seguir registrando\n*0* - Volver al menú principal",
    nextStep: 99,
    data: { regalosGuardados: true },
    notify: {
      target: "admin",
      message:
        `🎁 *Regalos registrados por Chofer #${state.data.codigoChofer}*\n\n` +
        `${resumenAdmin}\n\n` +
        `📦 Total: ${totalRegalos}\n` +
        `Hora: ${new Date().toLocaleTimeString("es-AR")}`,
    },
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
      reply:
        `¿Qué querés registrar?\n\n` +
        MENU_CHOFER + "\n\n" +
        "Respondé con el número.",
      nextStep: 1,
    };
  }

  // Cualquier otra respuesta no reconocida → re-preguntar
  return {
    reply:
      "No entendí. Respondé con:\n\n" +
      "*1* - Sí, seguir registrando\n" +
      "*0* - Volver al menú de chofer",
    nextStep: 99,
  };
}
