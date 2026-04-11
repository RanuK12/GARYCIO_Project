import { FlowHandler, ConversationState, FlowResponse } from "./types";
import { db } from "../../database";
import { donantes } from "../../database/schema";
import { eq } from "drizzle-orm";
import { logger } from "../../config/logger";

/**
 * Flow para registrar nuevas donantes.
 *
 * Se activa en dos escenarios:
 *  A) Un número totalmente desconocido escribe por primera vez → el conversation-manager
 *     lo redirige aquí automáticamente.
 *  B) Una donante existente menciona keywords de registro ("quiero donar", etc.)
 *
 * Secuencia:
 * 0 - Bienvenida + pedir nombre completo
 * 1 - Pedir dirección
 * 2 - Confirmar datos → guarda en DB + notifica admin
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
        return await handleConfirmacion(respuesta, state);
      default:
        return { reply: "¡Gracias por sumarte!", endFlow: true };
    }
  },
};

function handleNombre(respuesta: string): FlowResponse {
  // step 0 con mensaje vacío = inicio automático desde conversation-manager
  if (respuesta.length < 3) {
    return {
      reply:
        "¡Hola! 👋 Bienvenida a *GARYCIO*.\n\n" +
        "Parece que es la primera vez que nos escribís. " +
        "¿Querés registrarte como donante?\n\n" +
        "Para empezar, decinos tu *nombre completo*.\n\n" +
        "Si no querés registrarte, escribí *0* para ver el menú de opciones.",
      nextStep: 0,
    };
  }

  if (respuesta === "0") {
    return { reply: "", endFlow: true }; // → menú principal
  }

  return {
    reply:
      `Perfecto, *${respuesta}*. 👋\n\n` +
      "¿Cuál es tu *dirección completa*? (calle, número, piso si aplica, localidad)",
    nextStep: 1,
    data: { nombre: respuesta },
  };
}

function handleDireccion(respuesta: string, state: ConversationState): FlowResponse {
  if (respuesta === "0") {
    return { reply: "", endFlow: true }; // → menú principal
  }

  if (respuesta.length < 5) {
    return {
      reply:
        "Necesitamos una dirección más completa para poder ubicarte. " +
        "¿Cuál es tu dirección? (o escribí *0* para cancelar)",
      nextStep: 1,
    };
  }

  return {
    reply:
      "¡Anotado! 📝\n\n" +
      `Confirmemos tus datos:\n\n` +
      `👤 Nombre: *${state.data.nombre}*\n` +
      `📍 Dirección: *${respuesta}*\n\n` +
      `¿Está todo correcto?\n*1* - Sí, confirmar\n*2* - No, corregir\n*0* - Cancelar`,
    nextStep: 2,
    data: { direccion: respuesta },
  };
}

async function handleConfirmacion(respuesta: string, state: ConversationState): Promise<FlowResponse> {
  if (respuesta === "0") {
    return { reply: "", endFlow: true }; // → menú principal
  }

  const confirma = ["1", "si", "sí", "sep", "sip", "correcto", "dale"].some(
    (a) => respuesta.toLowerCase().includes(a),
  );

  if (!confirma) {
    return {
      reply: "Sin problema, empecemos de nuevo.\n\n¿Cuál es tu *nombre completo*?",
      nextStep: 0,
      data: {},
    };
  }

  // Guardar / actualizar en la tabla donantes
  try {
    const existing = await db
      .select({ id: donantes.id })
      .from(donantes)
      .where(eq(donantes.telefono, state.phone))
      .limit(1);

    if (existing.length > 0) {
      // Ya existe (auto-registrada antes) → actualizar con los datos reales
      await db
        .update(donantes)
        .set({
          nombre: state.data.nombre,
          direccion: state.data.direccion,
          estado: "inactiva",
          donandoActualmente: false,
          notas: `Registrada por autoflow WhatsApp.`,
          updatedAt: new Date(),
        })
        .where(eq(donantes.telefono, state.phone));
    } else {
      // Insertar nueva
      await db.insert(donantes).values({
        nombre: state.data.nombre,
        telefono: state.phone,
        direccion: state.data.direccion,
        estado: "inactiva",
        donandoActualmente: false,
        notas: `Registrada por autoflow WhatsApp.`,
      });
    }

    logger.info({ phone: state.phone, nombre: state.data.nombre }, "Nueva donante registrada vía bot");
  } catch (err) {
    logger.error({ phone: state.phone, err }, "Error guardando nueva donante en DB");
    // No fallar el flow por un error de DB — el admin igual recibe la notificación
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
      target: "admin",
      message:
        `🆕 *Nueva donante registrada (autoflow)*\n\n` +
        `📱 Teléfono: ${state.phone}\n` +
        `👤 Nombre: ${state.data.nombre}\n` +
        `📍 Dirección: ${state.data.direccion}\n\n` +
        `✅ Guardada en DB con estado *inactiva*. Asignar zona y chofer.`,
    },
  };
}
