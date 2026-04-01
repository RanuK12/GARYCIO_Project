import { FlowHandler, ConversationState, FlowResponse, MediaInfo } from "./types";
import { procesarComprobante, TipoComprobante } from "../../services/image-processor";
import { logger } from "../../config/logger";

/**
 * Flow para peones (acompañantes del chofer).
 * El peón puede:
 * - Reportar reclamos de donantes en la zona
 * - Marcar entrega de regalo a donante
 * - Reportar donante de baja (NO auto-desactiva, notifica admin)
 * - Enviar fotos/comprobantes
 * - Al finalizar: informar conteo de regalos (inicio, entregados, sobrantes)
 *
 * Steps:
 * 0  - Identificación
 * 1  - Menú principal
 * 10 - Reclamo: dirección donante
 * 11 - Reclamo: tipo
 * 12 - Reclamo: descripción + confirmar
 * 20 - Regalo: dirección donante
 * 21 - Regalo: confirmar entrega
 * 30 - Baja: nombre/dirección donante
 * 31 - Baja: motivo
 * 32 - Baja: confirmar
 * 40 - Foto: tipo comprobante
 * 41 - Foto: esperando foto
 * 42 - Foto: confirmar datos
 * 60 - Cierre de jornada: regalos al inicio
 * 61 - Cierre de jornada: regalos sobrantes
 * 62 - Cierre de jornada: confirmar resumen
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
      case 30: return handleBajaDonante(respuesta);
      case 31: return handleBajaMotivo(respuesta, state);
      case 32: return handleBajaConfirmar(respuesta, state);
      case 40: return handleTipoComprobante(respuesta);
      case 41: return handleRecibirFoto(respuesta, state, mediaInfo);
      case 42: return handleConfirmarFoto(respuesta, state);
      case 60: return handleCierreRegalosInicio(respuesta, state);
      case 61: return handleCierreRegalosRestantes(respuesta, state);
      case 62: return handleCierreConfirmar(respuesta, state);
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
  "*2* - Marcar entrega de regalo 🎁\n" +
  "*3* - Reportar donante de baja\n" +
  "*4* - Enviar foto/comprobante 📸\n" +
  "*5* - Finalizar\n" +
  "*0* - Volver al menú principal";

function handleMenu(respuesta: string): FlowResponse {
  switch (respuesta) {
    case "0":
      return {
        reply: "Saliste del registro de peón. Escribí cualquier cosa para volver al menú principal.",
        endFlow: true,
      };
    case "1":
      return {
        reply: "📋 *Reclamo de donante*\n\nIngresá la *dirección o nombre* de la donante:",
        nextStep: 10,
      };
    case "2":
      return {
        reply: "🎁 *Entrega de regalo*\n\nIngresá la *dirección o nombre* de la donante a quien le entregaste el regalo:",
        nextStep: 20,
      };
    case "3":
      return {
        reply: "⚠️ *Reportar donante de baja*\n\nIngresá el *nombre y/o dirección* de la donante:",
        nextStep: 30,
      };
    case "4":
      return {
        reply:
          "📸 *Enviar comprobante*\n\n" +
          "¿Qué tipo de comprobante vas a enviar?\n\n" +
          "*1* - Foto de recolección\n" +
          "*2* - Combustible\n" +
          "*3* - Lavado de camión\n\n" +
          "Elegí una opción:",
        nextStep: 40,
      };
    case "5":
      return {
        reply:
          "📦 *Cierre de jornada*\n\n" +
          "Antes de cerrar, necesitamos el conteo de regalos.\n\n" +
          "¿Cuántos regalos tenías al *inicio* del día?\n" +
          "(ej: *30*)",
        nextStep: 60,
      };
    default:
      return {
        reply: "Opción no válida. Elegí *1*, *2*, *3*, *4*, *5* o *0*:",
        nextStep: 1,
      };
  }
}

// ── Reclamo ──────────────────────────────────
function handleReclamoDireccion(respuesta: string): FlowResponse {
  if (respuesta.length < 3) {
    return { reply: "Ingresá la dirección o nombre de la donante:", nextStep: 10 };
  }
  return {
    reply:
      `📍 Donante: *${respuesta}*\n\n` +
      "¿Qué tipo de reclamo?\n\n" +
      "*1* - No le dejaron regalo\n" +
      "*2* - Falta bidón\n" +
      "*3* - Nueva pelela\n" +
      "*4* - Otro\n\n" +
      "Elegí una opción:",
    nextStep: 11,
    data: { reclamoDonante: respuesta },
  };
}

function handleReclamoTipo(respuesta: string): FlowResponse {
  const tipos: Record<string, string> = { "1": "regalo", "2": "falta_bidon", "3": "nueva_pelela", "4": "otro" };
  const tipo = tipos[respuesta];
  if (!tipo) {
    return { reply: "Opción no válida. Elegí *1*, *2*, *3* o *4*:", nextStep: 11 };
  }
  return {
    reply: "Describí brevemente el reclamo (o escribí *-* si no hay más detalle):",
    nextStep: 12,
    data: { reclamoTipo: tipo },
  };
}

function handleReclamoDescripcion(respuesta: string, state: ConversationState): FlowResponse {
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
      "*2* - No, finalizar",
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

// ── Entrega de regalo ──────────────────────────────────
function handleRegaloDireccion(respuesta: string): FlowResponse {
  if (respuesta.length < 3) {
    return { reply: "Ingresá la dirección o nombre de la donante:", nextStep: 20 };
  }
  return {
    reply:
      `🎁 Donante: *${respuesta}*\n\n` +
      "¿Confirmás que se entregó el regalo?\n\n" +
      "*1* - Sí, entregado\n" +
      "*2* - No, cancelar\n",
    nextStep: 21,
    data: { regaloDonante: respuesta },
  };
}

function handleRegaloConfirmar(respuesta: string, state: ConversationState): FlowResponse {
  if (respuesta === "2") {
    return {
      reply: "Cancelado. ¿Querés hacer algo más?\n*1* - Sí, seguir registrando\n*2* - No, finalizar\n*0* - Volver al menú principal",
      nextStep: 99,
    };
  }
  if (respuesta !== "1") {
    return { reply: "Elegí *1* (sí) o *2* (no):", nextStep: 21 };
  }

  return {
    reply:
      `✅ *Regalo entregado* a ${state.data.regaloDonante}\n\n` +
      "¿Querés registrar otro?\n*1* - Sí, seguir registrando\n*2* - No, finalizar\n*0* - Volver al menú principal",
    nextStep: 99,
    data: { regaloEntregado: true, regaloFecha: new Date().toISOString() },
  };
}

// ── Donante de baja ──────────────────────────────────
function handleBajaDonante(respuesta: string): FlowResponse {
  if (respuesta.length < 3) {
    return { reply: "Ingresá el nombre y/o dirección de la donante:", nextStep: 30 };
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
    nextStep: 31,
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
    return { reply: "Opción no válida. Elegí del *1* al *5*:", nextStep: 31 };
  }
  return {
    reply:
      `📋 *Confirmar reporte de baja*\n\n` +
      `📍 Donante: ${state.data.bajaDonante}\n` +
      `📝 Motivo: ${motivo}\n\n` +
      "⚠️ *No se dará de baja automáticamente.* Se notificará a los administradores para que contacten a la donante.\n\n" +
      "*1* - Confirmar\n" +
      "*2* - Cancelar",
    nextStep: 32,
    data: { bajaMotivo: motivo },
  };
}

function handleBajaConfirmar(respuesta: string, state: ConversationState): FlowResponse {
  if (respuesta === "2") {
    return {
      reply: "Cancelado. ¿Querés hacer algo más?\n*1* - Sí, seguir registrando\n*2* - No, finalizar\n*0* - Volver al menú principal",
      nextStep: 99,
    };
  }
  if (respuesta !== "1") {
    return { reply: "Elegí *1* (confirmar) o *2* (cancelar):", nextStep: 32 };
  }

  const donante = state.data.bajaDonante || "Desconocida";
  const motivo = state.data.bajaMotivo || "Sin motivo";

  return {
    reply:
      "✅ *Reporte de baja enviado a los administradores*\n\n" +
      "Ellos van a contactar a la donante para confirmar.\n\n" +
      "¿Querés hacer algo más?\n*1* - Sí, seguir registrando\n*2* - No, finalizar\n*0* - Volver al menú principal",
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

// ── Cierre de jornada: conteo de regalos (steps 60-62) ───────────

function handleCierreRegalosInicio(respuesta: string, _state: ConversationState): FlowResponse {
  const n = parseInt(respuesta, 10);
  if (isNaN(n) || n < 0) {
    return {
      reply: "Ingresá un número válido (ej: *30*, *0*):",
      nextStep: 60,
    };
  }
  return {
    reply:
      `Tenías *${n} regalos* al inicio.\n\n` +
      "¿Cuántos regalos te *sobraron* (no entregaste)?\n" +
      "(ej: *5*, *0* si entregaste todos)",
    nextStep: 61,
    data: { regalosAlInicio: n },
  };
}

function handleCierreRegalosRestantes(respuesta: string, state: ConversationState): FlowResponse {
  const sobraron = parseInt(respuesta, 10);
  if (isNaN(sobraron) || sobraron < 0) {
    return {
      reply: "Ingresá un número válido (ej: *5*, *0*):",
      nextStep: 61,
    };
  }

  const inicio = state.data.regalosAlInicio ?? 0;
  const entregados = inicio - sobraron;

  if (sobraron > inicio) {
    return {
      reply:
        `No puede sobrar más de lo que tenías. Tenías *${inicio}*, ingresá cuántos te sobraron:`,
      nextStep: 61,
    };
  }

  return {
    reply:
      `📦 *Resumen de regalos - Peón #${state.data.codigoPeon}*\n\n` +
      `• Regalos al inicio: *${inicio}*\n` +
      `• Regalos entregados: *${entregados}*\n` +
      `• Regalos sobrantes: *${sobraron}*\n\n` +
      "*1* - Confirmar y cerrar | *2* - Corregir",
    nextStep: 62,
    data: { regalosEntregados: entregados, regalsobrantes: sobraron },
  };
}

function handleCierreConfirmar(respuesta: string, state: ConversationState): FlowResponse {
  if (respuesta === "2") {
    return {
      reply: "¿Cuántos regalos tenías al inicio del día?",
      nextStep: 60,
      data: { regalosAlInicio: undefined, regalosEntregados: undefined, regalsobrantes: undefined },
    };
  }

  const inicio = state.data.regalosAlInicio ?? 0;
  const entregados = state.data.regalosEntregados ?? 0;
  const sobraron = state.data.regalsobrantes ?? 0;

  return {
    reply:
      `✅ *Jornada cerrada - Peón #${state.data.codigoPeon}*\n\n` +
      `📦 Regalos: ${entregados} entregados, ${sobraron} sobrantes.\n\n` +
      "¡Buen trabajo hoy! 💪",
    endFlow: true,
    data: { jornadaFinalizada: true },
    notify: {
      target: "admin",
      message:
        `📦 *Cierre de jornada - Peón #${state.data.codigoPeon}*\n\n` +
        `Regalos al inicio: ${inicio}\n` +
        `Regalos entregados: ${entregados}\n` +
        `Regalos sobrantes: ${sobraron}\n` +
        `Hora: ${new Date().toLocaleTimeString("es-AR")}`,
    },
  };
}

// ── Step 99: volver o finalizar ──────────────────────────────────
function handleVolverOFinalizar(respuesta: string): FlowResponse {
  if (respuesta === "1") {
    return {
      reply:
        "¿Qué querés hacer?\n\n" +
        MENU_PEON + "\n\n" +
        "Elegí una opción:",
      nextStep: 1,
    };
  }
  if (respuesta === "0") {
    return {
      reply: "Saliste del registro de peón. Escribí cualquier cosa para volver al menú principal.",
      endFlow: true,
    };
  }
  return {
    reply: "✅ ¡Jornada registrada! Buen trabajo. 💪",
    endFlow: true,
    data: { jornadaFinalizada: true },
  };
}

// ── Foto/comprobante (reutiliza lógica de chofer) ──────────────
function handleTipoComprobante(respuesta: string): FlowResponse {
  const tipos: Record<string, TipoComprobante> = {
    "1": "recoleccion",
    "2": "combustible",
    "3": "lavado",
  };
  const tipo = tipos[respuesta];
  if (!tipo) {
    return { reply: "Opción no válida. Elegí *1*, *2* o *3*:", nextStep: 40 };
  }
  return {
    reply: "📸 Enviá la foto del comprobante:",
    nextStep: 41,
    data: { fotoTipo: tipo },
  };
}

async function handleRecibirFoto(
  respuesta: string,
  state: ConversationState,
  mediaInfo?: MediaInfo,
): Promise<FlowResponse> {
  if (!mediaInfo || mediaInfo.type !== "image") {
    return {
      reply: "📸 Necesito que envíes una *foto*. Tomá una foto del comprobante y enviala.",
      nextStep: 41,
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
      nextStep: 42,
      data: { fotoResultado: resultado, fotoDatosExtraidos: datosExtraidos },
    };
  } catch (error) {
    logger.error({ error }, "Error procesando foto de peón");
    return {
      reply: "❌ No pude procesar la foto. ¿Querés intentar de nuevo?\n*1* - Sí\n*2* - No, volver al menú",
      nextStep: 42,
    };
  }
}

function handleConfirmarFoto(respuesta: string, state: ConversationState): FlowResponse {
  if (respuesta === "1" && state.data.fotoResultado) {
    return {
      reply:
        "✅ *Comprobante guardado*\n\n" +
        "¿Querés hacer algo más?\n*1* - Sí, seguir registrando\n*2* - No, finalizar\n*0* - Volver al menú principal",
      nextStep: 99,
      data: { fotoGuardada: true },
    };
  }
  return {
    reply: "¿Querés hacer algo más?\n*1* - Sí, seguir registrando\n*2* - No, finalizar\n*0* - Volver al menú principal",
    nextStep: 99,
  };
}
