import { FlowHandler, ConversationState, FlowResponse } from "./types";

/**
 * Flow de avisos de donantes.
 * Tipos: vacaciones, enfermedad, medicación
 *
 * Secuencia:
 * 0 - Menú de tipo de aviso
 * 1 - Fecha de vuelta (si aplica)
 * 2 - Confirmación → notifica al chofer
 *
 * Post-flow (manejado por scheduler):
 * - El día de vuelta: recordatorio al chofer de que vuelve a donar
 */
export const avisoFlow: FlowHandler = {
  name: "aviso",
  keyword: ["aviso", "vacaciones", "ausencia", "enfermedad", "medicacion", "medicación"],

  async handle(state: ConversationState, message: string): Promise<FlowResponse> {
    const respuesta = message.trim().toLowerCase();

    switch (state.step) {
      case 0:
        return handleTipoAviso(respuesta);
      case 1:
        return handleFechaVuelta(respuesta, state);
      default:
        return { reply: "¡Registrado! Te deseamos lo mejor.", endFlow: true };
    }
  },
};

function handleTipoAviso(respuesta: string): FlowResponse {
  const tipos: Record<string, string> = {
    "1": "vacaciones",
    "2": "enfermedad",
    "3": "medicacion",
    vacaciones: "vacaciones",
    enferm: "enfermedad",
    medic: "medicacion",
  };

  let tipo: string | undefined;
  for (const [key, value] of Object.entries(tipos)) {
    if (respuesta.includes(key) || respuesta === key) {
      tipo = value;
      break;
    }
  }

  if (!tipo) {
    return {
      reply:
        "¿Qué tipo de aviso querés darnos?\n\n" +
        "*1* - Me voy de vacaciones\n" +
        "*2* - Estoy enferma / no puedo donar\n" +
        "*3* - Estoy tomando medicación\n\n" +
        "Respondé con el número correspondiente.",
      nextStep: 0,
    };
  }

  const labels: Record<string, string> = {
    vacaciones: "vacaciones",
    enfermedad: "enfermedad",
    medicacion: "toma de medicación",
  };

  return {
    reply:
      `Registramos tu aviso por: *${labels[tipo]}*.\n\n` +
      "¿Sabés aproximadamente cuándo volvés a donar?\n" +
      "Respondé con la fecha (ej: *15/04* o *en 2 semanas*) o *no sé* si no tenés certeza.",
    nextStep: 1,
    data: { tipoAviso: tipo },
  };
}

function handleFechaVuelta(respuesta: string, state: ConversationState): FlowResponse {
  const noSabe = ["no s", "no se", "ni idea", "no tengo"].some((n) => respuesta.includes(n));
  const fechaParseada = noSabe ? null : parsearFecha(respuesta);

  const mensajeVuelta = fechaParseada
    ? `Te esperamos de vuelta el *${fechaParseada}*. Ese día le vamos a avisar a tu recolector.`
    : "Cuando sepas la fecha de vuelta, avisanos por acá así lo coordinamos.";

  return {
    reply:
      `¡Listo! Tu aviso quedó registrado. 📝\n\n` +
      `${mensajeVuelta}\n\n` +
      "¡Que te mejores pronto! 💪",
    endFlow: true,
    data: { fechaVuelta: fechaParseada },
    notify: {
      target: "chofer",
      message: formatNotificacionChofer(state, fechaParseada),
    },
  };
}

function formatNotificacionChofer(state: ConversationState, fechaVuelta: string | null): string {
  const tipo = state.data.tipoAviso || "general";

  return (
    `📢 *Aviso de donante*\n\n` +
    `Donante: ${state.phone}\n` +
    `Motivo: ${tipo}\n` +
    `Vuelta estimada: ${fechaVuelta || "Sin fecha definida"}\n\n` +
    `No pasar a recolectar hasta nuevo aviso.`
  );
}

function parsearFecha(texto: string): string | null {
  const regexFecha = /(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/;
  const match = texto.match(regexFecha);

  if (match) {
    const dia = match[1].padStart(2, "0");
    const mes = match[2].padStart(2, "0");
    const anio = match[3] || new Date().getFullYear().toString();
    return `${dia}/${mes}/${anio}`;
  }

  const regexSemanas = /en\s+(\d+)\s+semana/i;
  const matchSemanas = texto.match(regexSemanas);

  if (matchSemanas) {
    const semanas = parseInt(matchSemanas[1], 10);
    const fecha = new Date();
    fecha.setDate(fecha.getDate() + semanas * 7);
    return fecha.toLocaleDateString("es-AR");
  }

  return null;
}
