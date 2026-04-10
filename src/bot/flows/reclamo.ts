import { FlowHandler, ConversationState, FlowResponse, MediaInfo } from "./types";
import { procesarComprobante } from "../../services/image-processor";
import { logger } from "../../config/logger";

/**
 * Flow de reclamos de donantes.
 *
 * Menú:
 * 1-1  No me dejaron bidón vacío
 * 1-2  No pasaron hoy a retirar el bidón
 * 1-3  Bidón sucio (respuesta directa)
 * 1-4  Necesito pelela (respuesta directa)
 * 1-5  Regalo → sub-menú (falta / roto)
 *
 * Steps:
 * 0 - Menú de tipo de reclamo
 * 1 - Sub-menú regalo (falta / roto)
 * 2 - Detalle del reclamo (opcional)
 * 3 - Confirmación final → escala y notifica
 * 4 - Foto del regalo roto
 */
export const reclamoFlow: FlowHandler = {
  name: "reclamo",
  keyword: ["reclamo", "queja", "problema", "reclamos"],

  async handle(state: ConversationState, message: string, mediaInfo?: MediaInfo): Promise<FlowResponse> {
    const respuesta = message.trim();

    switch (state.step) {
      case 0:
        return handleTipoReclamo(respuesta);
      case 1:
        return handleSubMenuRegalo(respuesta);
      case 2:
        return handleDetalleReclamo(respuesta, state);
      case 3:
        return handleConfirmacionFinal(respuesta, state);
      case 4:
        return handleFotoRegaloRoto(respuesta, state, mediaInfo);
      default:
        return { reply: "Gracias por reportar. ¡Lo vamos a resolver!", endFlow: true };
    }
  },
};

const MENU_RECLAMO =
  "¿Qué tipo de reclamo querés hacer?\n\n" +
  "*1* - No me dejaron bidón vacío\n" +
  "*2* - No pasaron hoy a retirar el bidón\n" +
  "*3* - Bidón sucio\n" +
  "*4* - Necesito pelela\n" +
  "*5* - Regalo\n" +
  "*0* - Volver al menú principal\n\n" +
  "Respondé con el número correspondiente.";

function handleTipoReclamo(respuesta: string): FlowResponse {
  const lower = respuesta.toLowerCase();

  // Opción 0: Volver al menú principal → endFlow con reply vacío para que el manager muestre el menú
  if (lower === "0" || lower.includes("volver") || lower.includes("menu principal")) {
    return { reply: "", endFlow: true };
  }

  // Opción 1: No me dejaron bidón vacío
  if (lower === "1") {
    return {
      reply:
        "Registramos tu reclamo: *no te dejaron bidón vacío*.\n\n" +
        "¿Querés agregar algún detalle? Si no, respondé *no*.\n\n" +
        "*0* - Volver",
      nextStep: 2,
      data: { tipoReclamo: "falta_bidon_vacio", labelReclamo: "No dejaron bidón vacío" },
    };
  }

  // Opción 2: No pasaron hoy
  if (lower === "2") {
    return {
      reply:
        "Registramos tu reclamo: *no pasaron hoy a retirar el bidón*.\n\n" +
        "¿Querés agregar algún detalle? Si no, respondé *no*.\n\n" +
        "*0* - Volver",
      nextStep: 2,
      data: { tipoReclamo: "no_pasaron", labelReclamo: "No pasaron a retirar" },
    };
  }

  // Opción 3: Bidón sucio → respuesta directa
  if (lower === "3") {
    return {
      reply:
        "Tomamos nota de tu reclamo por *bidón sucio*. 🧹\n\n" +
        "Estamos trabajando para mejorar nuestro servicio de limpieza de bidones. " +
        "Tu comentario nos ayuda a mejorar.\n\n" +
        "Elevaremos un reclamo, pronto solucionaremos tu situación.\n\n" +
        "¿Hay algo más que te podamos ayudar?\n" +
        "*1* - Sí\n*2* - No, gracias",
      nextStep: 3,
      data: { tipoReclamo: "bidon_sucio", labelReclamo: "Bidón sucio" },
      notify: {
        target: "admin",
        message:
          `📋 *Reclamo: Bidón sucio*\n\n` +
          `📱 Donante: (ver contexto)\n` +
          `Tipo: bidón sucio\n\n` +
          `_Reclamo automático_`,
      },
    };
  }

  // Opción 4: Necesito pelela → respuesta directa
  if (lower === "4") {
    return {
      reply:
        "Tomamos nota de tu pedido de *pelela*. 🪣\n\n" +
        "Nos vamos a comunicar con los recolectores para que te lleven una pelela " +
        "en la próxima visita.\n\n" +
        "¿Hay algo más que te podamos ayudar?\n" +
        "*1* - Sí\n*2* - No, gracias",
      nextStep: 3,
      data: { tipoReclamo: "pelela", labelReclamo: "Necesita pelela" },
      notify: {
        target: "chofer",
        message:
          `🪣 *Pedido de pelela*\n\n` +
          `📱 Donante: (ver contexto)\n\n` +
          `Llevar pelela en la próxima visita.`,
      },
    };
  }

  // Opción 5: Regalo → sub-menú
  if (lower === "5") {
    return {
      reply:
        "¿Qué pasó con el regalo?\n\n" +
        "*1* - Falta el regalo (no me lo dejaron)\n" +
        "*2* - El regalo está roto\n\n" +
        "Respondé con el número.",
      nextStep: 1,
      data: { tipoReclamo: "regalo" },
    };
  }

  // No entendió → mostrar menú
  return {
    reply: MENU_RECLAMO,
    nextStep: 0,
  };
}

function handleSubMenuRegalo(respuesta: string): FlowResponse {
  const lower = respuesta.toLowerCase();

  if (lower === "0") {
    return { reply: MENU_RECLAMO, nextStep: 0 };
  }

  if (lower === "1") {
    return {
      reply:
        "Registramos tu reclamo: *falta el regalo*.\n\n" +
        "¿Cuál es el regalo que te falta? (describilo brevemente o escribí *no sé*)\n\n" +
        "*0* - Volver",
      nextStep: 2,
      data: { subTipoRegalo: "falta", labelReclamo: "Falta regalo" },
    };
  }

  if (lower === "2") {
    return {
      reply:
        "Registramos tu reclamo: *regalo roto*.\n\n" +
        "¿Querés agregar algún detalle de qué está roto? Si no, respondé *no*.\n\n" +
        "*0* - Volver",
      nextStep: 2,
      data: { subTipoRegalo: "roto", labelReclamo: "Regalo roto" },
    };
  }

  return {
    reply:
      "Opción no válida. ¿Qué pasó con el regalo?\n\n" +
      "*1* - Falta el regalo\n" +
      "*2* - El regalo está roto\n" +
      "*0* - Volver",
    nextStep: 1,
  };
}

function handleDetalleReclamo(respuesta: string, state: ConversationState): FlowResponse {
  if (respuesta.toLowerCase() === "0") {
    // Volver: si estaba en regalo, volver al sub-menú; si no, al menú principal
    if (state.data.tipoReclamo === "regalo") {
      return {
        reply:
          "¿Qué pasó con el regalo?\n\n" +
          "*1* - Falta el regalo (no me lo dejaron)\n" +
          "*2* - El regalo está roto\n" +
          "*0* - Volver",
        nextStep: 1,
      };
    }
    return { reply: MENU_RECLAMO, nextStep: 0 };
  }

  const sinDetalle = ["no", "nop", "na", "nada", "no se", "no sé"].some(
    (n) => respuesta.toLowerCase() === n,
  );

  const label = state.data.labelReclamo || "general";
  const detalle = sinDetalle ? null : respuesta;

  // Si es regalo roto → pedir foto antes de confirmar
  if (state.data.subTipoRegalo === "roto") {
    return {
      reply:
        `Tu reclamo por *${label}* quedó registrado. ✅\n\n` +
        "📸 Por favor enviá una *foto del regalo roto* para que podamos verificarlo:",
      nextStep: 4,
      data: { detalleReclamo: detalle },
      notify: {
        target: "chofer",
        message: formatNotificacionChofer(state, detalle),
      },
    };
  }

  return {
    reply:
      `Tu reclamo por *${label}* quedó registrado. ✅\n\n` +
      "Elevaremos un reclamo, pronto solucionaremos tu situación.\n\n" +
      "Se lo vamos a informar al recolector de tu zona. " +
      "En *4 días* te vamos a escribir para saber si se resolvió.\n\n" +
      "¿Hay algo más en lo que te podamos ayudar?\n" +
      "*1* - Sí\n*2* - No, gracias",
    nextStep: 3,
    data: { detalleReclamo: detalle },
    notify: {
      target: "chofer",
      message: formatNotificacionChofer(state, detalle),
    },
  };
}

function handleConfirmacionFinal(respuesta: string, _state: ConversationState): FlowResponse {
  const lower = respuesta.toLowerCase();
  const esAfirmativo = ["si", "sí", "sep", "sip", "1"].some(
    (a) => lower === a || lower.startsWith(a + ",") || lower.startsWith(a + " "),
  );

  // Sí → volver al menú principal (endFlow sin reply propio; el manager muestra el menú)
  if (esAfirmativo) {
    return { reply: "", endFlow: true };
  }

  // Texto libre con suficiente contexto → escalar
  if (respuesta.trim().length >= 8 && !["no", "nop", "na", "nah", "gracias", "2"].some((n) => lower === n)) {
    return {
      reply:
        "Anotamos tu consulta y te respondemos a la brevedad. 📩\n\n" +
        "Una persona de nuestro equipo va a revisar tu mensaje y te va a contestar personalmente.\n\n" +
        "¡Buen día! 😊",
      endFlow: true,
      notify: {
        target: "admin",
        message:
          `📩 *Consulta adicional post-reclamo*\n\n` +
          `💬 Mensaje: "${respuesta}"\n\n` +
          `⚠️ La donante tiene una duda adicional. Requiere respuesta manual.`,
      },
    };
  }

  return {
    reply: "¡Perfecto! Cualquier cosa estamos por acá. ¡Buen día! 😊",
    endFlow: true,
  };
}

// ── Foto regalo roto (step 4) ──────────────────────────────────
async function handleFotoRegaloRoto(
  respuesta: string,
  state: ConversationState,
  mediaInfo?: MediaInfo,
): Promise<FlowResponse> {
  if (respuesta === "0") {
    return {
      reply:
        "Elevaremos un reclamo, pronto solucionaremos tu situación.\n\n" +
        "Se lo vamos a informar al recolector de tu zona. " +
        "En *4 días* te vamos a escribir para saber si se resolvió.\n\n" +
        "¿Hay algo más que te podamos ayudar?\n" +
        "*1* - Sí\n*2* - No, gracias",
      nextStep: 3,
    };
  }

  if (!mediaInfo || mediaInfo.type !== "image") {
    return {
      reply: "📸 Enviá una *foto* del regalo roto.\n\n*0* - Omitir foto",
      nextStep: 4,
    };
  }

  try {
    await procesarComprobante(mediaInfo.mediaId, "recoleccion", 0);
  } catch (err) {
    logger.error({ err }, "Error procesando foto de regalo roto");
  }

  return {
    reply:
      "📸 *Foto recibida*\n\n" +
      "Elevaremos un reclamo, pronto solucionaremos tu situación.\n\n" +
      "Se lo vamos a informar al recolector de tu zona. " +
      "En *4 días* te vamos a escribir para saber si se resolvió.\n\n" +
      "¿Hay algo más en lo que te podamos ayudar?\n" +
      "*1* - Sí\n*2* - No, gracias",
    nextStep: 3,
    data: { fotoRegaloRoto: true },
  };
}

function formatNotificacionChofer(state: ConversationState, detalle: string | null): string {
  const tipo = state.data.labelReclamo || "general";
  const phone = state.phone;

  return (
    `📋 *Nuevo reclamo*\n\n` +
    `Donante: ${phone}\n` +
    `Tipo: ${tipo}\n` +
    `Detalle: ${detalle || "Sin detalle adicional"}\n\n` +
    `Por favor resolvelo en los próximos días.`
  );
}
