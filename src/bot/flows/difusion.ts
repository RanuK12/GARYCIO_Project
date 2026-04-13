import { FlowHandler, ConversationState, FlowResponse, InteractiveMessage } from "./types";
import { db } from "../../database";
import { difusionEnvios } from "../../database/schema";
import { eq } from "drizzle-orm";

/**
 * Flow de difusión (broadcast).
 * Se activa automáticamente cuando se envía un mensaje masivo de asignación de días.
 * La donante recibe el mensaje y puede:
 *   1 → Confirmar recepción (se registra en difusion_envios)
 *   2 → Ir al menú de donantes para hacer otra consulta
 *
 * Steps:
 * 0 - Esperando respuesta (1 o 2)
 */
const MENU_PRINCIPAL_INTERACTIVE: InteractiveMessage = {
  type: "buttons",
  body: "¿En qué más te podemos ayudar?",
  buttons: [
    { id: "1", title: "Tengo un reclamo" },
    { id: "2", title: "Dar un aviso" },
    { id: "3", title: "Otra consulta" },
  ],
};

export const difusionFlow: FlowHandler = {
  name: "difusion",
  keyword: [],

  async handle(state: ConversationState, message: string): Promise<FlowResponse> {
    const respuesta = message.trim();

    switch (state.step) {
      case 0:
        return handleRespuestaDifusion(respuesta, state);
      default:
        return { reply: "¡Gracias! Cualquier cosa estamos por acá.", endFlow: true };
    }
  },
};

async function handleRespuestaDifusion(respuesta: string, state: ConversationState): Promise<FlowResponse> {
  if (respuesta === "1") {
    // Normalizar teléfono: algunos llegan con + y otros sin él
    const phoneExacto = state.phone;
    const phoneSinPlus = state.phone.startsWith("+") ? state.phone.slice(1) : state.phone;
    const phoneConPlus = state.phone.startsWith("+") ? state.phone : `+${state.phone}`;

    const updated = await db
      .update(difusionEnvios)
      .set({ confirmado: true, fechaConfirmacion: new Date() })
      .where(eq(difusionEnvios.telefono, phoneExacto))
      .returning({ telefono: difusionEnvios.telefono });

    if (updated.length === 0) {
      await db
        .update(difusionEnvios)
        .set({ confirmado: true, fechaConfirmacion: new Date() })
        .where(eq(difusionEnvios.telefono, phoneSinPlus.length > phoneExacto.length ? phoneSinPlus : phoneConPlus));
    }

    return {
      reply: "✅ *Recepción confirmada* ¡Gracias! Te esperamos en los días indicados.\nRecordá tener el bidón listo antes del horario indicado.",
      interactive: MENU_PRINCIPAL_INTERACTIVE,
      endFlow: true,
      data: { confirmado: true },
      notify: {
        target: "admin",
        message: `✅ Donante ${state.phone} confirmó recepción del mensaje de difusión.`,
      },
    };
  }

  if (respuesta === "2") {
    return {
      reply: "",
      interactive: MENU_PRINCIPAL_INTERACTIVE,
      endFlow: true,
    };
  }

  // No entendió → mostrar botones de confirmación
  return {
    reply: "No entendí tu respuesta.",
    interactive: {
      type: "buttons",
      body: "¿Qué querés hacer?",
      buttons: [
        { id: "1", title: "Confirmar recepción" },
        { id: "2", title: "Otra consulta" },
      ],
    },
    nextStep: 0,
  };
}
