import { FlowHandler, ConversationState, FlowResponse } from "./types";

/**
 * Flow de consulta general.
 * Responde preguntas frecuentes y redirige según necesidad.
 *
 * Secuencia:
 * 0 - Menú de consultas frecuentes
 * 1 - Respuesta según opción / derivación
 */

const FAQ: Record<string, { titulo: string; respuesta: string }> = {
  "1": {
    titulo: "Días de recolección",
    respuesta:
      "Los días de recolección dependen de tu zona. Si hubo cambios recientes, " +
      "tu recolector te va a avisar los nuevos días.\n\n" +
      "Si no recibiste aviso, escribinos diciendo *reclamo* y lo resolvemos.",
  },
  "2": {
    titulo: "Regalos y beneficios",
    respuesta:
      "Los regalos se entregan una vez al mes durante la recolección. " +
      "Si no te lo dejaron, escribinos diciendo *reclamo* y seleccioná " +
      "la opción de regalo para que lo resolvamos.",
  },
  "3": {
    titulo: "Cambio de dirección",
    respuesta:
      "Si te mudaste o cambiaste de dirección, por favor escribinos tu " +
      "*nueva dirección completa* y la actualizamos en el sistema.\n\n" +
      "Avisale también a tu recolector cuando pase.",
  },
  "4": {
    titulo: "Dejar de donar",
    respuesta:
      "Lamentamos que quieras dejar de donar. Si es temporal, podés avisarnos " +
      "como *aviso* (vacaciones, enfermedad) y te pausamos.\n\n" +
      "Si es definitivo, te damos de baja del sistema. ¿Estás segura?",
  },
};

export const consultaGeneralFlow: FlowHandler = {
  name: "consulta_general",
  keyword: ["consulta", "pregunta", "duda", "info", "información", "ayuda", "3"],

  async handle(state: ConversationState, message: string): Promise<FlowResponse> {
    const respuesta = message.trim().toLowerCase();

    switch (state.step) {
      case 0:
        return handleMenuConsulta(respuesta);
      case 1:
        return handleRespuestaConsulta(respuesta, state);
      default:
        return { reply: "¡Cualquier cosa estamos por acá!", endFlow: true };
    }
  },
};

function handleMenuConsulta(respuesta: string): FlowResponse {
  const faq = FAQ[respuesta.trim()];

  if (faq) {
    return {
      reply:
        `📌 *${faq.titulo}*\n\n${faq.respuesta}\n\n` +
        "¿Te puedo ayudar en algo más? Respondé *sí* o *no*.",
      nextStep: 1,
      data: { consultaTipo: faq.titulo },
    };
  }

  // Si escribió texto libre con suficiente contexto (no un número del catálogo): derivar a admin
  if (respuesta.trim().length >= 8 && !["1","2","3","4"].includes(respuesta.trim())) {
    return {
      reply:
        "Anotamos tu consulta y te respondemos a la brevedad. 📩\n\n" +
        "Una persona de nuestro equipo va a revisar tu mensaje y te va a contestar personalmente.\n\n" +
        "¿Hay algo más en lo que te podamos ayudar?\n" +
        "*1* - Sí\n" +
        "*2* - No, gracias",
      nextStep: 1,
      data: { consultaLibre: respuesta },
      notify: {
        target: "admin",
        message:
          `📩 *Consulta libre de donante*\n\n` +
          `📱 Teléfono: (ver contexto)\n` +
          `💬 Mensaje: "${respuesta}"\n\n` +
          `⚠️ Requiere respuesta manual.`,
      },
    };
  }

  return {
    reply:
      "¿Sobre qué querés consultar?\n\n" +
      "*1* - Días de recolección\n" +
      "*2* - Regalos y beneficios\n" +
      "*3* - Cambio de dirección\n" +
      "*4* - Dejar de donar\n\n" +
      "Respondé con el número o escribí tu consulta directamente.",
    nextStep: 0,
  };
}

function handleRespuestaConsulta(
  respuesta: string,
  _state: ConversationState,
): FlowResponse {
  // Si escribió una consulta libre (no un número del menú)
  if (!FAQ[respuesta] && !["si", "sí", "no", "nop", "na"].some((w) => respuesta.includes(w))) {
    return {
      reply:
        "Tu consulta fue registrada. Un encargado te va a responder a la brevedad.\n\n" +
        "Mientras tanto, ¿te puedo ayudar en algo más?",
      nextStep: 1,
      data: { consultaLibre: respuesta },
      notify: {
        target: "admin",
        message:
          `📩 *Consulta de donante*\n\n` +
          `Consulta: ${respuesta}\n\n` +
          `Requiere respuesta manual.`,
      },
    };
  }

  const quiereMas = ["si", "sí", "sep", "sip"].some((a) => respuesta.includes(a));

  if (quiereMas) {
    return {
      reply:
        "¿En qué más te puedo ayudar?\n\n" +
        "*1* - Tengo un reclamo\n" +
        "*2* - Quiero dar un aviso\n" +
        "*3* - Otra consulta",
      endFlow: true,
    };
  }

  return {
    reply: "¡Perfecto! Cualquier cosa estamos por acá. ¡Buen día! 😊",
    endFlow: true,
  };
}
