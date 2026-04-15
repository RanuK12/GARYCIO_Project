import { FlowHandler, ConversationState, FlowResponse } from "./types";
import { db } from "../../database";
import { donantes } from "../../database/schema";
import { eq } from "drizzle-orm";
import { logger } from "../../config/logger";
import { env } from "../../config/env";

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
        return await handleNombre(respuesta, state);
      case 1:
        return handleDireccion(respuesta, state);
      case 2:
        return await handleConfirmacion(respuesta, state);
      default:
        return { reply: "¡Gracias por sumarte!", endFlow: true };
    }
  },
};

async function handleNombre(respuesta: string, state: ConversationState): Promise<FlowResponse> {
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

  // Detectar si es una pregunta en vez de un nombre
  if (esPregunta(respuesta)) {
    return {
      reply:
        "No hay requisitos especiales para registrarte. 😊\n\n" +
        "Solo necesitamos tu *nombre completo* y tu *dirección* para que el recolector sepa dónde pasar.\n\n" +
        "Empecemos: ¿cuál es tu *nombre completo*?",
      nextStep: 0,
    };
  }

  // Detectar si dice que ya es donante
  if (esDonantExistente(respuesta)) {
    return {
      reply:
        "¡Disculpá! Si ya sos donante puede que tu número haya cambiado en nuestro sistema. 🙏\n\n" +
        "Le avisamos a nuestro equipo para que verifiquen tus datos y te contacten.",
      endFlow: true,
      notify: {
        target: "admin",
        message:
          `⚠️ *Donante dice que ya existe*\n\n` +
          `📱 Teléfono: ${state.phone}\n` +
          `💬 Mensaje: "${respuesta}"\n\n` +
          `El sistema no la encontró pero dice que ya es donante. Verificar manualmente.`,
      },
    };
  }

  // Detectar si parece una dirección en vez de un nombre (tiene números)
  if (/\d{2,}/.test(respuesta) && respuesta.length > 10) {
    return {
      reply:
        "Eso parece una dirección. 📍\n\n" +
        "Primero necesitamos tu *nombre completo* y después te pedimos la dirección.\n\n" +
        "¿Cuál es tu nombre?",
      nextStep: 0,
    };
  }

  // Si el mensaje es largo (>25 chars) o tiene muchas palabras (>4), probablemente NO es un nombre
  // → Usar IA para interpretar si está disponible, o derivar a admin
  if (respuesta.length > 25 || respuesta.split(/\s+/).length > 4) {
    if (env.AI_CLASSIFIER_ENABLED && env.OPENAI_API_KEY) {
      return await interpretarConIA(respuesta, state);
    }
    // Sin IA: derivar a admin
    return {
      reply:
        "Parece que tu mensaje tiene más información de la que necesitamos en este paso. 😊\n\n" +
        "Le pasamos tu mensaje a nuestro equipo para que te ayuden mejor.\n\n" +
        "Si querés registrarte como donante, escribinos tu *nombre completo* solamente.",
      nextStep: 0,
      notify: {
        target: "admin",
        message:
          `❓ *Mensaje complejo de número desconocido*\n\n` +
          `📱 Teléfono: ${state.phone}\n` +
          `💬 Mensaje: "${respuesta}"\n\n` +
          `El bot no pudo interpretar. Requiere atención manual.`,
      },
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

/**
 * Usa IA para interpretar mensajes complejos de números desconocidos.
 * Ejemplo: "Soi donate cha keria desierte keesta vin" → detecta que ya es donante
 */
async function interpretarConIA(mensaje: string, state: ConversationState): Promise<FlowResponse> {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Sos un clasificador de mensajes de WhatsApp para GARYCIO (empresa de recolección de reciclables).
Un número DESCONOCIDO (no registrado) escribió el siguiente mensaje. Necesitás determinar qué quiere decir.

Las personas a menudo escriben con MUCHOS errores de ortografía (ej: "quier0 suscrivirme", "soi donate", "keria desirte").

Respondé SOLO con JSON:
{
  "tipo": "ya_es_donante" | "quiere_registrarse" | "pregunta" | "reclamo" | "otro",
  "interpretacion": "lo que la persona quiere decir en español correcto",
  "nombre_detectado": "nombre si lo mencionó, null si no"
}`,
          },
          { role: "user", content: `Mensaje: "${mensaje}"` },
        ],
        max_tokens: 150,
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) throw new Error(`OpenAI error: ${response.status}`);

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    const parsed = JSON.parse(data.choices[0].message.content);

    logger.info({ phone: state.phone, parsed, mensaje: mensaje.slice(0, 60) }, "IA interpretó mensaje de número desconocido");

    if (parsed.tipo === "ya_es_donante") {
      return {
        reply:
          "¡Disculpá! Si ya sos donante puede que tu número haya cambiado en nuestro sistema. 🙏\n\n" +
          "Le avisamos a nuestro equipo para que verifiquen tus datos y te contacten.",
        endFlow: true,
        notify: {
          target: "admin",
          message:
            `⚠️ *Donante dice que ya existe (detectado por IA)*\n\n` +
            `📱 Teléfono: ${state.phone}\n` +
            `💬 Mensaje original: "${mensaje}"\n` +
            `🤖 Interpretación IA: "${parsed.interpretacion}"\n\n` +
            `El sistema no la encontró pero dice que ya es donante. Verificar manualmente.`,
        },
      };
    }

    if (parsed.tipo === "reclamo") {
      return {
        reply:
          "Tomamos nota de tu mensaje. Le avisamos al equipo para que se comuniquen con vos. 🙏",
        endFlow: true,
        notify: {
          target: "admin",
          message:
            `📋 *Reclamo de número desconocido*\n\n` +
            `📱 Teléfono: ${state.phone}\n` +
            `💬 Mensaje: "${mensaje}"\n` +
            `🤖 Interpretación: "${parsed.interpretacion}"\n\n` +
            `Número no registrado. Verificar si es donante existente.`,
        },
      };
    }

    if (parsed.tipo === "pregunta") {
      return {
        reply:
          "No hay requisitos especiales para registrarte. 😊\n\n" +
          "Solo necesitamos tu *nombre completo* y tu *dirección* para que el recolector sepa dónde pasar.\n\n" +
          "¿Cuál es tu *nombre completo*?",
        nextStep: 0,
      };
    }

    if (parsed.tipo === "quiere_registrarse" && parsed.nombre_detectado) {
      return {
        reply:
          `Perfecto, *${parsed.nombre_detectado}*. 👋\n\n` +
          "¿Cuál es tu *dirección completa*? (calle, número, piso si aplica, localidad)",
        nextStep: 1,
        data: { nombre: parsed.nombre_detectado },
      };
    }

    // "otro" → derivar a admin
    return {
      reply:
        "Recibimos tu mensaje. Le pasamos la info a nuestro equipo para que te ayuden. 🙏\n\n" +
        "Si querés registrarte como donante, escribinos tu *nombre completo*.",
      nextStep: 0,
      notify: {
        target: "admin",
        message:
          `❓ *Mensaje complejo de número desconocido*\n\n` +
          `📱 Teléfono: ${state.phone}\n` +
          `💬 Mensaje: "${mensaje}"\n` +
          `🤖 Interpretación: "${parsed.interpretacion}"\n\n` +
          `Requiere atención manual.`,
      },
    };
  } catch (err) {
    logger.error({ err, phone: state.phone }, "Error usando IA para interpretar mensaje");
    // Fallback: derivar a admin
    return {
      reply:
        "Recibimos tu mensaje. Le pasamos la info a nuestro equipo. 🙏\n\n" +
        "Si querés registrarte, escribinos solo tu *nombre completo*.",
      nextStep: 0,
      notify: {
        target: "admin",
        message:
          `❓ *Mensaje de número desconocido no interpretado*\n\n` +
          `📱 Teléfono: ${state.phone}\n` +
          `💬 "${mensaje}"\n\n` +
          `Requiere atención manual.`,
      },
    };
  }
}

function esPregunta(texto: string): boolean {
  const lower = texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Contiene signo de pregunta
  if (texto.includes("?")) return true;
  // Frases interrogativas comunes
  const preguntas = [
    "que requisitos", "q requisitos", "como hago", "como me registro",
    "que necesito", "q necesito", "que tengo que", "q tengo q",
    "como funciona", "que hay que hacer", "como es",
    "me gustaria saber", "me gustaria q", "quiero saber",
    "cuales son", "donde", "cuando",
  ];
  return preguntas.some((p) => lower.includes(p));
}

function esDonantExistente(texto: string): boolean {
  const lower = texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const frases = [
    "ya soy donante", "ya dono", "ya estoy registrad",
    "ya participo", "soy donante hace", "ya soy donanate",
    "ya soi donante", "yo ya soy donante", "ya estoy anotad",
    // Variantes con mala ortografía (casos reales)
    "soi donate", "soi donante", "soy donate", "soi donanate",
    "ya soi donate", "ya soy donant", "ya doi", "yo dono",
    "yo ya dono", "ya doi hace", "soy donant",
    "ya estoi anotad", "ya stoy anotad", "ya toy registrad",
    "keria desirte", "keria decirte", "keria desierte",
    "yo dona", "ya dona hace",
  ];
  if (frases.some((f) => lower.includes(f))) return true;

  // Patrón: alguna forma de "soy/soi" + "donan/donat/donate" en la misma oración
  if (/\b(soy|soi|zoi)\b.*\b(donan|donat|donate|donant)/i.test(lower)) return true;

  return false;
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
