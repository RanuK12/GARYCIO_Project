import { FlowHandler, ConversationState, FlowResponse } from "./types";
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
    // Intentamos con el formato exacto y también sin el + inicial
    const phoneExacto = state.phone;
    const phoneSinPlus = state.phone.startsWith("+") ? state.phone.slice(1) : state.phone;
    const phoneConPlus = state.phone.startsWith("+") ? state.phone : `+${state.phone}`;

    // Actualizar por cualquiera de los formatos posibles
    const updated = await db
      .update(difusionEnvios)
      .set({ confirmado: true, fechaConfirmacion: new Date() })
      .where(eq(difusionEnvios.telefono, phoneExacto))
      .returning({ telefono: difusionEnvios.telefono });

    if (updated.length === 0) {
      // Intentar sin/con el + si no encontró
      await db
        .update(difusionEnvios)
        .set({ confirmado: true, fechaConfirmacion: new Date() })
        .where(eq(difusionEnvios.telefono, phoneSinPlus.length > phoneExacto.length ? phoneSinPlus : phoneConPlus));
    }

    return {
      reply:
        "✅ *Recepción confirmada*\n\n" +
        "¡Gracias por confirmar! Te esperamos en los días indicados.\n" +
        "Recordá tener el bidón listo antes del horario indicado.\n\n" +
        "Si necesitás algo más, escribinos por acá. ¡Buen día!",
      endFlow: true,
      data: { confirmado: true },
      notify: {
        target: "admin",
        message:
          `✅ Donante ${state.phone} confirmó recepción del mensaje de difusión.`,
      },
    };
  }

  if (respuesta === "2") {
    return {
      reply:
        "¿En qué te podemos ayudar?\n\n" +
        "*1* - Tengo un reclamo\n" +
        "*2* - Quiero dar un aviso (suspender donación, enfermedad, etc.)\n" +
        "*3* - Otro motivo\n\n" +
        "Escribí *persona* en cualquier momento para hablar con alguien del equipo.",
      endFlow: true,
    };
  }

  return {
    reply:
      "No entendí tu respuesta.\n\n" +
      "Apretá *1* para confirmar recepción del mensaje.\n" +
      "Apretá *2* si tenés alguna otra consulta.",
    nextStep: 0,
  };
}
