import { FlowHandler, ConversationState, FlowResponse } from "./types";
import { sendMessage } from "../client";
import { env } from "../../config/env";
import { logger } from "../../config/logger";

/**
 * Flow para choferes.
 * El chofer se identifica con su código/número y puede:
 * - Registrar litros y bidones recolectados
 * - Registrar carga de combustible
 * - Reportar incidentes (notificación INMEDIATA al CEO)
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
 */
export const choferFlow: FlowHandler = {
  name: "chofer",
  keyword: ["chofer", "recolector", "registro", "cargar datos", "litros"],

  async handle(state: ConversationState, message: string): Promise<FlowResponse> {
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
      "*1* - Litros y bidones recolectados\n" +
      "*2* - Carga de combustible\n" +
      "*3* - Reportar incidente\n" +
      "*4* - Finalizar jornada\n\n" +
      "Respondé con el número.",
    nextStep: 1,
    data: { codigoChofer, choferId: parseInt(match[1], 10) },
  };
}

// ── Menú principal ──────────────────────────────────
function handleMenuChofer(respuesta: string, state: ConversationState): FlowResponse {
  const lower = respuesta.toLowerCase();

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

  if (lower === "4" || lower.includes("finalizar")) {
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
      "No entendí. Respondé con un número:\n\n" +
      "*1* - Litros y bidones\n" +
      "*2* - Combustible\n" +
      "*3* - Reportar incidente\n" +
      "*4* - Finalizar jornada",
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
    reply: "✅ *Datos guardados*\n\n¿Querés registrar algo más?\n\n*1* - Sí | *2* - Finalizar jornada",
    nextStep: 1,
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
    reply: "✅ *Combustible registrado*\n\n¿Querés registrar algo más?\n\n*1* - Sí | *2* - Finalizar",
    nextStep: 1,
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

  // Construir alerta para CEO (se envía INMEDIATAMENTE)
  const alertaCEO =
    `${emoji} *INCIDENTE REPORTADO*\n\n` +
    `Chofer: *#${state.data.codigoChofer}*\n` +
    `Tipo: *${LABELS_INCIDENTE[tipo]}*\n` +
    `Gravedad: *${gravedad.toUpperCase()}*\n` +
    `Descripción: ${desc}\n` +
    `Hora: ${new Date().toLocaleTimeString("es-AR")}\n\n` +
    `_Notificación automática de GARYCIO_`;

  // Enviar al CEO inmediatamente (fire-and-forget)
  sendMessage(env.CEO_PHONE, alertaCEO).catch((err) => {
    logger.error({ err }, "Error al notificar incidente al CEO");
  });

  return {
    reply:
      `${emoji} *Incidente registrado*\n\n` +
      `Se notificó a la dirección de forma inmediata.\n` +
      `Tipo: *${LABELS_INCIDENTE[tipo]}*\n` +
      `Gravedad: *${gravedad}*\n\n` +
      "¿Necesitás registrar algo más?\n\n*1* - Sí | *2* - Finalizar jornada",
    nextStep: 1,
    data: { gravedadIncidente: gravedad, incidenteReportado: true },
    notify: {
      target: "admin",
      message:
        `${emoji} *Incidente*\nChofer: #${state.data.codigoChofer}\nTipo: ${LABELS_INCIDENTE[tipo]}\nGravedad: ${gravedad}\nDescripción: ${desc}`,
    },
  };
}
