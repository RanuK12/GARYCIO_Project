import { FlowHandler, ConversationState, FlowResponse } from "./types";

/**
 * Flow de avisos de donantes.
 * Tipos: vacaciones, enfermedad, medicación
 *
 * Secuencia:
 * 0 - Menú de tipo de aviso (SIEMPRE se muestra, no se saltea)
 * 1 - Fecha de vuelta
 * 2 - Confirmación → notifica al chofer
 *
 * Post-flow (manejado por scheduler):
 * - El día de vuelta: recordatorio al chofer de que vuelve a donar
 */
export const avisoFlow: FlowHandler = {
  name: "aviso",
  keyword: ["aviso", "vacaciones", "ausencia", "enfermedad", "medicacion", "medicación"],

  async handle(state: ConversationState, message: string): Promise<FlowResponse> {
    const respuesta = message.trim();

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

// ── Paso 0: Elegir motivo ────────────────────────────────
function handleTipoAviso(respuesta: string): FlowResponse {
  const MENU_AVISO =
    "¿Por qué motivo nos querés avisar?\n\n" +
    "*1* - Me voy de vacaciones 🏖️\n" +
    "*2* - Estoy enferma, no puedo donar 🤒\n" +
    "*3* - Estoy tomando medicación 💊\n" +
    "*4* - Otro motivo\n\n" +
    "Respondé con el número correspondiente.";

  const map: Record<string, string> = {
    "1": "vacaciones",
    "2": "enfermedad",
    "3": "medicacion",
    "4": "otro",
  };

  const tipo = map[respuesta.trim()];

  if (!tipo) {
    return {
      reply: MENU_AVISO,
      nextStep: 0,
    };
  }

  const labels: Record<string, string> = {
    vacaciones: "vacaciones 🏖️",
    enfermedad: "enfermedad 🤒",
    medicacion: "toma de medicación 💊",
    otro: "otro motivo",
  };

  return {
    reply:
      `Registramos tu aviso por: *${labels[tipo]}*.\n\n` +
      "¿Cuándo calculás que volvés a donar?\n\n" +
      "Podés escribir:\n" +
      "• Una fecha: *15/04*, *el lunes*, *en 2 semanas*\n" +
      "• Cantidad de días: *3 días*, *una semana*\n" +
      "• Si no sabés: *no sé*",
    nextStep: 1,
    data: { tipoAviso: tipo },
  };
}

// ── Paso 1: Fecha de vuelta ─────────────────────────────
function handleFechaVuelta(respuesta: string, state: ConversationState): FlowResponse {
  const lower = respuesta.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const noSabe = ["no s", "no se", "ni idea", "no tengo", "no sabe"].some((n) => lower.includes(n));
  const fechaParseada = noSabe ? null : parsearFecha(lower, respuesta);

  const mensajeVuelta = fechaParseada
    ? `Te esperamos de vuelta el *${fechaParseada}*. Ese día le vamos a avisar a tu recolector para que retome el paso.`
    : "Cuando sepas cuándo vas a estar disponible, avisanos por acá y lo coordinamos con el recolector.";

  const tipo = state.data.tipoAviso || "general";

  return {
    reply:
      `¡Listo! Tu aviso quedó registrado. 📝\n\n` +
      `${mensajeVuelta}\n\n` +
      getTipoPorMotivo(tipo),
    endFlow: true,
    data: { fechaVuelta: fechaParseada },
    notify: {
      target: "chofer",
      message: formatNotificacionChofer(state, fechaParseada),
    },
  };
}

function getTipoPorMotivo(tipo: string): string {
  switch (tipo) {
    case "enfermedad":
      return "¡Que te mejores pronto! 💪";
    case "vacaciones":
      return "¡Que disfrutes las vacaciones! 🌞";
    case "medicacion":
      return "Cuando termines el tratamiento, avisanos y retomamos. 😊";
    default:
      return "Ante cualquier duda, escribinos por acá. ¡Hasta pronto!";
  }
}

function formatNotificacionChofer(state: ConversationState, fechaVuelta: string | null): string {
  const tipo = state.data.tipoAviso || "general";
  const labels: Record<string, string> = {
    vacaciones: "Vacaciones",
    enfermedad: "Enfermedad",
    medicacion: "Medicación",
    otro: "Otro motivo",
  };

  return (
    `📢 *Aviso de donante*\n\n` +
    `Donante: ${state.phone}\n` +
    `Motivo: ${labels[tipo] || tipo}\n` +
    `Vuelta estimada: ${fechaVuelta || "Sin fecha definida"}\n\n` +
    `⚠️ No pasar a recolectar hasta nuevo aviso.`
  );
}

// ── Parser de fechas completo ────────────────────────────
/**
 * Parsea múltiples formatos de fecha/duración en español:
 * - "15/04", "15-04", "15/04/2025"
 * - "3 días", "una semana", "2 semanas"
 * - "el lunes", "el jueves"
 * - "en una semana", "en 10 días"
 * - "hasta el 20", "hasta el viernes"
 */
function parsearFecha(lower: string, original: string): string | null {
  // Formato DD/MM o DD/MM/YYYY o DD-MM
  const regexFecha = /(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/;
  const matchFecha = original.match(regexFecha);
  if (matchFecha) {
    const dia = matchFecha[1].padStart(2, "0");
    const mes = matchFecha[2].padStart(2, "0");
    const anio = matchFecha[3]
      ? matchFecha[3].length === 2
        ? `20${matchFecha[3]}`
        : matchFecha[3]
      : new Date().getFullYear().toString();
    return `${dia}/${mes}/${anio}`;
  }

  // "N días" o "N dia"
  const regexDias = /(\d+)\s*d[ií]a/i;
  const matchDias = lower.match(regexDias);
  if (matchDias) {
    const dias = parseInt(matchDias[1], 10);
    const fecha = new Date();
    fecha.setDate(fecha.getDate() + dias);
    return fecha.toLocaleDateString("es-AR");
  }

  // "una semana", "1 semana", "2 semanas", "una quincena"
  const regexSemanas = /(\d+|una?|dos|tres|cuatro)\s*semana/i;
  const matchSemanas = lower.match(regexSemanas);
  if (matchSemanas) {
    const num = parsearNumeroEspanol(matchSemanas[1]);
    const fecha = new Date();
    fecha.setDate(fecha.getDate() + num * 7);
    return fecha.toLocaleDateString("es-AR");
  }

  // "una quincena" / "quince días"
  if (lower.includes("quincena") || /quince\s*d[ií]a/.test(lower)) {
    const fecha = new Date();
    fecha.setDate(fecha.getDate() + 15);
    return fecha.toLocaleDateString("es-AR");
  }

  // "un mes" / "1 mes"
  const regexMes = /(\d+|un?o?a?)\s*mes/i;
  const matchMes = lower.match(regexMes);
  if (matchMes) {
    const num = parsearNumeroEspanol(matchMes[1]);
    const fecha = new Date();
    fecha.setMonth(fecha.getMonth() + num);
    return fecha.toLocaleDateString("es-AR");
  }

  // Día de la semana: "el lunes", "el viernes", "lunes que viene"
  const diasSemana: Record<string, number> = {
    lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 0,
  };
  for (const [nombre, num] of Object.entries(diasSemana)) {
    if (lower.includes(nombre)) {
      const hoy = new Date();
      const hoyDia = hoy.getDay();
      let diff = num - hoyDia;
      if (diff <= 0) diff += 7; // próximo de esa semana
      hoy.setDate(hoy.getDate() + diff);
      return hoy.toLocaleDateString("es-AR");
    }
  }

  return null;
}

function parsearNumeroEspanol(texto: string): number {
  const mapa: Record<string, number> = {
    un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  };
  const n = parseInt(texto, 10);
  if (!isNaN(n)) return n;
  return mapa[texto.toLowerCase()] || 1;
}
