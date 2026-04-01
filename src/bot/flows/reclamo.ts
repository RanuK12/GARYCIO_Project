import { FlowHandler, ConversationState, FlowResponse } from "./types";

/**
 * Flow de reclamos de donantes.
 * Tipos: regalo, falta_bidon, nueva_pelela, otro
 *
 * Secuencia:
 * 0 - Menú de tipo de reclamo
 * 1 - Detalle del reclamo
 * 2 - Confirmación → notifica al chofer
 *
 * Post-flow (manejado por scheduler):
 * - A los 4 días: mensaje a donante preguntando si se resolvió
 * - Si no se resolvió: escala a visitadora
 */
export const reclamoFlow: FlowHandler = {
  name: "reclamo",
  keyword: ["reclamo", "queja", "problema", "reclamos"],

  async handle(state: ConversationState, message: string): Promise<FlowResponse> {
    const respuesta = message.trim().toLowerCase();

    switch (state.step) {
      case 0:
        return handleTipoReclamo(respuesta);
      case 1:
        return handleDetalleReclamo(respuesta, state);
      case 2:
        return handleConfirmacionReclamo(respuesta, state);
      default:
        return { reply: "Gracias por reportar. ¡Lo vamos a resolver!", endFlow: true };
    }
  },
};

function handleTipoReclamo(respuesta: string): FlowResponse {
  const tipos: Record<string, string> = {
    "1": "regalo",
    "2": "falta_bidon",
    "3": "nueva_pelela",
    "4": "otro",
    regalo: "regalo",
    bidon: "falta_bidon",
    bidón: "falta_bidon",
    pelela: "nueva_pelela",
  };

  const tipo = tipos[respuesta];

  if (!tipo) {
    return {
      reply:
        "¿Qué tipo de reclamo querés hacer?\n\n" +
        "*1* - No me dejaron el regalo\n" +
        "*2* - Me falta un bidón\n" +
        "*3* - Necesito una pelela nueva\n" +
        "*4* - Otro reclamo\n\n" +
        "Respondé con el número correspondiente.",
      nextStep: 0,
    };
  }

  const labels: Record<string, string> = {
    regalo: "regalo no entregado",
    falta_bidon: "falta de bidón",
    nueva_pelela: "pelela nueva",
    otro: "otro",
  };

  return {
    reply:
      `Registramos un reclamo por: *${labels[tipo]}*.\n\n` +
      (tipo === "otro"
        ? "Contanos brevemente cuál es el problema:"
        : "¿Querés agregar algún detalle? Si no, respondé *no*."),
    nextStep: 1,
    data: { tipoReclamo: tipo },
  };
}

function handleDetalleReclamo(respuesta: string, state: ConversationState): FlowResponse {
  const sinDetalle = ["no", "nop", "na", "nada"].some((n) => respuesta === n);

  return {
    reply:
      "Tu reclamo quedó registrado. ✅\n\n" +
      "Se lo vamos a informar al recolector de tu zona. " +
      "En *4 días* te vamos a escribir para saber si se resolvió.\n\n" +
      "¿Hay algo más en lo que te podamos ayudar?",
    nextStep: 2,
    data: { detalleReclamo: sinDetalle ? null : respuesta },
    notify: {
      target: "chofer",
      message: formatNotificacionChofer(state),
    },
  };
}

function handleConfirmacionReclamo(respuesta: string, _state: ConversationState): FlowResponse {
  const lower = respuesta.toLowerCase();
  const esNegativo = ["no", "nop", "na", "nah", "gracias"].some((n) => lower === n || lower.startsWith(n + " "));
  const esAfirmativo = ["si", "sí", "sep", "sip", "1"].some((a) => lower === a || lower.startsWith(a + ",") || lower.startsWith(a + " "));

  if (esNegativo) {
    return {
      reply: "¡Perfecto! Cualquier cosa estamos por acá. ¡Buen día! 😊",
      endFlow: true,
    };
  }

  if (esAfirmativo) {
    return {
      reply:
        "¿En qué más te podemos ayudar?\n\n" +
        "*1* - Tengo otro reclamo\n" +
        "*2* - Quiero dar un aviso (vacaciones/enfermedad)\n" +
        "*3* - Tengo una consulta",
      endFlow: true,
    };
  }

  // Texto libre con suficiente contexto → escalarla
  if (respuesta.trim().length >= 8) {
    return {
      reply:
        "Anotamos tu consulta y te respondemos a la brevedad. 📩\n\n" +
        "Una persona de nuestro equipo va a revisar tu mensaje y te va a contestar personalmente.\n\n" +
        "¿Hay algo más en lo que te podamos ayudar?\n" +
        "*1* - Sí, tengo otra cosa\n" +
        "*2* - No, gracias",
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

function formatNotificacionChofer(state: ConversationState): string {
  const tipo = state.data.tipoReclamo || "general";
  const detalle = state.data.detalleReclamo || "Sin detalle adicional";
  const phone = state.phone;

  return (
    `📋 *Nuevo reclamo*\n\n` +
    `Donante: ${phone}\n` +
    `Tipo: ${tipo}\n` +
    `Detalle: ${detalle}\n\n` +
    `Por favor resolvelo en los próximos días.`
  );
}
