import { FlowHandler, ConversationState, FlowResponse } from "./types";

/**
 * Flow para registrar nuevas donantes.
 * Se activa cuando una persona escribe por primera vez
 * o menciona que quiere empezar a donar.
 *
 * Secuencia:
 * 0 - Presentación + pedir nombre completo
 * 1 - Pedir dirección
 * 2 - Pedir días de preferencia para recolección
 * 3 - Confirmar datos → notifica al chofer de la zona
 */
export const nuevaDonanteFlow: FlowHandler = {
  name: "nueva_donante",
  keyword: ["donar", "nueva", "empezar a donar", "quiero donar", "inscribir", "registrar"],

  async handle(state: ConversationState, message: string): Promise<FlowResponse> {
    const respuesta = message.trim();

    switch (state.step) {
      case 0:
        return handleNombre(respuesta);
      case 1:
        return handleDireccion(respuesta, state);
      case 2:
        return handleDiasPreferencia(respuesta, state);
      case 3:
        return handleConfirmacion(respuesta, state);
      default:
        return { reply: "¡Gracias por sumarte!", endFlow: true };
    }
  },
};

function handleNombre(respuesta: string): FlowResponse {
  if (respuesta.length < 3) {
    return {
      reply:
        "¡Hola! Bienvenida a *GARYCIO*. 🎉\n\n" +
        "Para registrarte como donante necesitamos algunos datos.\n\n" +
        "¿Cuál es tu *nombre completo*?",
      nextStep: 0,
    };
  }

  return {
    reply:
      `Perfecto, *${respuesta}*. 👋\n\n` +
      "¿Cuál es tu *dirección completa*? (calle, número, piso si aplica, localidad)",
    nextStep: 1,
    data: { nombre: respuesta },
  };
}

function handleDireccion(respuesta: string, _state: ConversationState): FlowResponse {
  if (respuesta.length < 5) {
    return {
      reply: "Necesitamos una dirección más completa para poder ubicarte. ¿Cuál es tu dirección?",
      nextStep: 1,
    };
  }

  return {
    reply:
      "¡Anotado! 📝\n\n" +
      "¿Qué *días te quedan más cómodos* para la recolección?\n\n" +
      "Podés decirnos los días (ej: lunes y jueves) o si te da igual decí *cualquier día*.",
    nextStep: 2,
    data: { direccion: respuesta },
  };
}

function handleDiasPreferencia(respuesta: string, state: ConversationState): FlowResponse {
  const dias = respuesta.toLowerCase().includes("cualquier")
    ? "A coordinar"
    : respuesta;

  return {
    reply:
      `Confirmemos tus datos:\n\n` +
      `👤 Nombre: *${state.data.nombre}*\n` +
      `📍 Dirección: *${state.data.direccion}*\n` +
      `📅 Días preferidos: *${dias}*\n\n` +
      `¿Está todo correcto? Respondé *1* para SÍ o *2* para corregir algo.`,
    nextStep: 3,
    data: { diasPreferencia: dias },
  };
}

function handleConfirmacion(respuesta: string, state: ConversationState): FlowResponse {
  const confirma = ["1", "si", "sí", "sep", "sip", "correcto", "dale"].some(
    (a) => respuesta.toLowerCase().includes(a),
  );

  if (!confirma) {
    return {
      reply:
        "Sin problema, empecemos de nuevo.\n\n¿Cuál es tu *nombre completo*?",
      nextStep: 0,
      data: {},
    };
  }

  return {
    reply:
      "¡Listo! Quedaste registrada como nueva donante. 🎉\n\n" +
      "En los próximos días un recolector va a pasar por tu domicilio. " +
      "Te vamos a avisar por acá cuándo.\n\n" +
      "Si tenés alguna duda, escribinos cuando quieras. ¡Gracias por sumarte! 💪",
    endFlow: true,
    data: { confirmado: true },
    notify: {
      target: "chofer",
      message:
        `🆕 *Nueva donante registrada*\n\n` +
        `Nombre: ${state.data.nombre}\n` +
        `Dirección: ${state.data.direccion}\n` +
        `Días preferidos: ${state.data.diasPreferencia}\n\n` +
        `Por favor pasá por el domicilio en los próximos días.`,
    },
  };
}
