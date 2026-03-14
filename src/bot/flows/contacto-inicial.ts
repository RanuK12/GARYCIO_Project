import { FlowHandler, ConversationState, FlowResponse } from "./types";

/**
 * Flow de contacto inicial para donantes de zonas nuevas.
 * Objetivo: confirmar datos y recopilar información de recolección.
 *
 * Pasos:
 * 0 - Saludo + preguntar si actualmente está donando
 * 1 - Si dona: preguntar qué días le pasan a recolectar
 * 2 - Confirmar dirección
 * 3 - Agradecer y confirmar datos
 */
export const contactoInicialFlow: FlowHandler = {
  name: "contacto_inicial",
  keyword: [],

  async handle(state: ConversationState, message: string): Promise<FlowResponse> {
    const respuesta = message.trim().toLowerCase();

    switch (state.step) {
      case 0:
        return handleDonandoActualmente(respuesta, state);
      case 1:
        return handleDiasRecoleccion(respuesta, state);
      case 2:
        return handleConfirmacionDireccion(respuesta, state);
      default:
        return { reply: "Gracias por tu tiempo. ¡Nos vemos pronto!", endFlow: true };
    }
  },
};

function handleDonandoActualmente(respuesta: string, state: ConversationState): FlowResponse {
  const afirmativas = ["si", "sí", "sep", "sip", "claro", "obvio", "dale", "1"];
  const negativas = ["no", "nop", "na", "nah", "2"];

  if (afirmativas.some((a) => respuesta.includes(a))) {
    return {
      reply:
        "¡Genial! 🙌 ¿Qué días te pasan a recolectar actualmente?\n\n" +
        "Podés decirme los días (ej: lunes y jueves) o si no te acordás decime \"no sé\".",
      nextStep: 1,
      data: { donandoActualmente: true },
    };
  }

  if (negativas.some((n) => respuesta.includes(n))) {
    return {
      reply:
        "Entendido, no hay problema. Si en algún momento querés retomar la donación " +
        "no dudes en escribirnos. ¡Gracias por tu tiempo!",
      endFlow: true,
      data: { donandoActualmente: false },
    };
  }

  return {
    reply:
      "Disculpá, no entendí bien. ¿Actualmente estás donando?\n\n" +
      "Respondé *1* para SÍ o *2* para NO.",
    nextStep: 0,
  };
}

function handleDiasRecoleccion(respuesta: string, state: ConversationState): FlowResponse {
  const dias = extraerDias(respuesta);

  if (dias.length === 0 && !respuesta.includes("no s")) {
    return {
      reply:
        "No pude identificar los días. ¿Podés decirme los días de la semana? " +
        "(ej: lunes, miércoles y viernes)",
      nextStep: 1,
    };
  }

  const direccionActual = state.data.direccion || "tu domicilio actual";

  return {
    reply:
      `Perfecto, quedó registrado: *${dias.length > 0 ? dias.join(", ") : "a confirmar"}*.\n\n` +
      `Tu dirección registrada es: *${direccionActual}*\n` +
      `¿Es correcta? Respondé *1* para SÍ o escribí la dirección correcta.`,
    nextStep: 2,
    data: { diasRecoleccion: dias.join(", ") },
  };
}

function handleConfirmacionDireccion(respuesta: string, state: ConversationState): FlowResponse {
  const confirma = ["si", "sí", "1", "sep", "sip", "correcto", "correcta"].some((a) =>
    respuesta.includes(a),
  );

  const direccionFinal = confirma ? state.data.direccion : respuesta;

  return {
    reply:
      "¡Listo! Tus datos quedaron actualizados. 📋\n\n" +
      "A partir del *13 de abril* vas a tener un nuevo recolector asignado. " +
      "Te vamos a avisar quién es y los días exactos de recolección.\n\n" +
      "Si tenés alguna duda o reclamo, escribinos por acá. ¡Gracias! 😊",
    endFlow: true,
    data: { direccion: direccionFinal },
  };
}

function extraerDias(texto: string): string[] {
  const diasSemana: Record<string, string> = {
    lun: "Lunes",
    mar: "Martes",
    mie: "Miércoles",
    mié: "Miércoles",
    jue: "Jueves",
    vie: "Viernes",
    sab: "Sábado",
    sáb: "Sábado",
    dom: "Domingo",
  };

  const encontrados: string[] = [];
  const lower = texto.toLowerCase();

  for (const [abrev, nombre] of Object.entries(diasSemana)) {
    if (lower.includes(abrev)) {
      encontrados.push(nombre);
    }
  }

  return encontrados;
}
