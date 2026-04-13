import { FlowHandler, ConversationState, FlowResponse, InteractiveMessage, MediaInfo } from "./types";
import { procesarComprobante } from "../../services/image-processor";
import { logger } from "../../config/logger";
import { db } from "../../database";
import { donantes, reclamos } from "../../database/schema";
import { eq } from "drizzle-orm";

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
        return handleTipoReclamo(respuesta, state);
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

const MENU_RECLAMO_INTERACTIVE: InteractiveMessage = {
  type: "list",
  body: "¿Qué tipo de reclamo querés hacer?",
  buttonText: "Ver opciones",
  sections: [{
    rows: [
      { id: "1", title: "No me dejaron bidón vacío" },
      { id: "2", title: "No pasaron a retirar", description: "No pasaron hoy a retirar el bidón" },
      { id: "3", title: "Bidón sucio" },
      { id: "4", title: "Necesito pelela" },
      { id: "5", title: "Problema con el regalo" },
    ],
  }],
};

const MENU_REGALO_INTERACTIVE: InteractiveMessage = {
  type: "buttons",
  body: "¿Qué pasó con el regalo?",
  buttons: [
    { id: "1", title: "Falta el regalo" },
    { id: "2", title: "El regalo está roto" },
  ],
};

const MENU_CONFIRMACION_INTERACTIVE: InteractiveMessage = {
  type: "buttons",
  body: "¿Hay algo más en lo que te podamos ayudar?",
  buttons: [
    { id: "1", title: "Sí, tengo otra consulta" },
    { id: "2", title: "No, gracias" },
  ],
};

async function handleTipoReclamo(respuesta: string, state: ConversationState): Promise<FlowResponse> {
  const lower = respuesta.toLowerCase();

  // Primer acceso (mensaje vacío desde iniciarFlow) → mostrar lista interactiva
  if (respuesta === "") {
    return {
      reply: "",
      interactive: MENU_RECLAMO_INTERACTIVE,
      nextStep: 0,
    };
  }

  // Opción 0: Volver al menú principal
  if (lower === "0" || lower.includes("volver") || lower.includes("menu principal")) {
    return { reply: "", endFlow: true };
  }

  // Opción 1: No me dejaron bidón vacío
  if (lower === "1" || lower.includes("bidon vacio") || lower.includes("bidón vacío") || lower.includes("no me dejaron")) {
    return {
      reply:
        "Registramos tu reclamo: *no te dejaron bidón vacío*.\n\n" +
        "¿Querés agregar algún detalle? Si no, respondé *no*.",
      nextStep: 2,
      data: { tipoReclamo: "falta_bidon_vacio", labelReclamo: "No dejaron bidón vacío" },
    };
  }

  // Opción 2: No pasaron hoy
  if (lower === "2" || lower.includes("no pasaron") || lower.includes("no retiraron")) {
    return {
      reply:
        "Registramos tu reclamo: *no pasaron hoy a retirar el bidón*.\n\n" +
        "¿Querés agregar algún detalle? Si no, respondé *no*.",
      nextStep: 2,
      data: { tipoReclamo: "no_pasaron", labelReclamo: "No pasaron a retirar" },
    };
  }

  // Opción 3: Bidón sucio
  if (lower === "3" || lower.includes("bidon sucio") || lower.includes("bidón sucio")) {
    const stateConTipo = { ...state, data: { ...state.data, tipoReclamo: "bidon_sucio", labelReclamo: "Bidón sucio" } };
    await guardarReclamoEnDB(stateConTipo, null);
    return {
      reply: "Tomamos nota de tu reclamo por *bidón sucio*. 🧹\n\nElevaremos un reclamo, pronto solucionaremos tu situación.",
      interactive: MENU_CONFIRMACION_INTERACTIVE,
      nextStep: 3,
      data: { tipoReclamo: "bidon_sucio", labelReclamo: "Bidón sucio" },
      notify: {
        target: "admin",
        message:
          `📋 *Reclamo: Bidón sucio*\n\n` +
          `📱 Donante: ${state.phone}\n` +
          `Tipo: bidón sucio\n\n` +
          `_Reclamo guardado en DB_`,
      },
    };
  }

  // Opción 4: Necesito pelela
  if (lower === "4" || lower.includes("pelela")) {
    const stateConTipo = { ...state, data: { ...state.data, tipoReclamo: "pelela", labelReclamo: "Necesita pelela" } };
    await guardarReclamoEnDB(stateConTipo, null);
    return {
      reply: "Tomamos nota de tu pedido de *pelela*. 🪣\n\nNos vamos a comunicar con los recolectores para que te lleven una pelela en la próxima visita.",
      interactive: MENU_CONFIRMACION_INTERACTIVE,
      nextStep: 3,
      data: { tipoReclamo: "pelela", labelReclamo: "Necesita pelela" },
      notify: {
        target: "chofer",
        message:
          `🪣 *Pedido de pelela*\n\n` +
          `📱 Donante: ${state.phone}\n\n` +
          `Llevar pelela en la próxima visita.`,
      },
    };
  }

  // Opción 5: Regalo → sub-menú interactivo
  if (lower === "5" || lower.includes("regalo") || lower.includes("problema con el regalo")) {
    return {
      reply: "",
      interactive: MENU_REGALO_INTERACTIVE,
      nextStep: 1,
      data: { tipoReclamo: "regalo" },
    };
  }

  // No entendió → mostrar lista interactiva de nuevo
  return {
    reply: "",
    interactive: MENU_RECLAMO_INTERACTIVE,
    nextStep: 0,
  };
}

function handleSubMenuRegalo(respuesta: string): FlowResponse {
  const lower = respuesta.toLowerCase();

  if (lower === "0" || lower.includes("volver")) {
    return { reply: "", interactive: MENU_RECLAMO_INTERACTIVE, nextStep: 0 };
  }

  if (lower === "1" || lower.includes("falta el regalo") || lower.includes("no me lo dejaron")) {
    return {
      reply:
        "Registramos tu reclamo: *falta el regalo*.\n\n" +
        "¿Cuál es el regalo que te falta? (describilo brevemente o escribí *no sé*)",
      nextStep: 2,
      data: { subTipoRegalo: "falta", labelReclamo: "Falta regalo" },
    };
  }

  if (lower === "2" || lower.includes("roto") || lower.includes("el regalo está roto")) {
    return {
      reply:
        "Registramos tu reclamo: *regalo roto*.\n\n" +
        "¿Querés agregar algún detalle de qué está roto? Si no, respondé *no*.",
      nextStep: 2,
      data: { subTipoRegalo: "roto", labelReclamo: "Regalo roto" },
    };
  }

  return {
    reply: "",
    interactive: MENU_REGALO_INTERACTIVE,
    nextStep: 1,
  };
}

async function handleDetalleReclamo(respuesta: string, state: ConversationState): Promise<FlowResponse> {
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

  await guardarReclamoEnDB(state, detalle);

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
    reply: `Tu reclamo por *${label}* quedó registrado. ✅\n\nElevaremos un reclamo, pronto solucionaremos tu situación.\nSe lo vamos a informar al recolector de tu zona. En *4 días* te vamos a escribir para saber si se resolvió.`,
    interactive: MENU_CONFIRMACION_INTERACTIVE,
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
  const esAfirmativo = ["si", "sí", "sep", "sip", "1", "sí, tengo otra consulta"].some(
    (a) => lower === a || lower.startsWith(a + ",") || lower.startsWith(a + " "),
  );

  // Sí → volver al menú principal (endFlow sin reply propio; el manager muestra el menú)
  if (esAfirmativo) {
    return { reply: "", endFlow: true };
  }

  // Texto libre con suficiente contexto → escalar
  if (respuesta.trim().length >= 8 && !["no", "nop", "na", "nah", "gracias", "2", "no, gracias"].some((n) => lower === n)) {
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
      reply: "Elevaremos un reclamo, pronto solucionaremos tu situación.\n\nSe lo vamos a informar al recolector de tu zona. En *4 días* te vamos a escribir para saber si se resolvió.",
      interactive: MENU_CONFIRMACION_INTERACTIVE,
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
    reply: "📸 *Foto recibida*\n\nElevaremos un reclamo, pronto solucionaremos tu situación.\nSe lo vamos a informar al recolector de tu zona. En *4 días* te vamos a escribir para saber si se resolvió.",
    interactive: MENU_CONFIRMACION_INTERACTIVE,
    nextStep: 3,
    data: { fotoRegaloRoto: true },
  };
}

// ── Guardar reclamo en DB ──────────────────────────────────────
async function guardarReclamoEnDB(state: ConversationState, detalle: string | null): Promise<void> {
  try {
    const tipo = state.data.tipoReclamo as string;
    // Mapear tipo interno al enum de DB
    const tipoEnum =
      tipo === "regalo" || tipo?.startsWith("regalo") ? "regalo"
      : tipo === "falta_bidon_vacio" ? "falta_bidon"
      : tipo === "no_pasaron" ? "falta_bidon"
      : tipo === "pelela" ? "nueva_pelela"
      : tipo === "bidon_sucio" ? "otro"
      : "otro";

    const donanteRow = await db
      .select({ id: donantes.id })
      .from(donantes)
      .where(eq(donantes.telefono, state.phone))
      .limit(1);

    if (donanteRow.length === 0) {
      logger.warn({ phone: state.phone }, "No se encontró donante para guardar reclamo");
      return;
    }

    await db.insert(reclamos).values({
      donanteId: donanteRow[0].id,
      tipo: tipoEnum as "regalo" | "falta_bidon" | "nueva_pelela" | "otro",
      descripcion: [state.data.labelReclamo, detalle].filter(Boolean).join(" - ") || null,
      estado: "pendiente",
      gravedad: "leve",
    });

    logger.info({ phone: state.phone, tipo: tipoEnum }, "Reclamo guardado en DB");
  } catch (err) {
    logger.error({ phone: state.phone, err }, "Error guardando reclamo en DB");
  }
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
