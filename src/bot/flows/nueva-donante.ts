import { FlowHandler, ConversationState, FlowResponse } from "./types";
import { db } from "../../database";
import { donantes } from "../../database/schema";
import { eq } from "drizzle-orm";
import { logger } from "../../config/logger";
import { env } from "../../config/env";
import { detectEscalationTrigger } from "../../services/escalation-triggers";

/**
 * Flow para registrar nuevas donantes.
 *
 * Diseño post-incidente 25/4:
 *  - La IA evalúa CADA mensaje en su contexto (esperando nombre /
 *    dirección / confirmación). No se cae en steps rígidos que
 *    procesan basura como "Pero no trajeron mi regalo" como si fuera
 *    una dirección.
 *  - Detección de cambio de tema: si la donante pasa a hablar de
 *    quejas / reclamos / consultas mid-flow, abandonamos el registro
 *    y derivamos a humano.
 *  - "0" en cualquier paso = cancelar.
 *  - Sin IA disponible: fallback regex con validaciones más estrictas.
 *
 * Steps: 0 nombre → 1 dirección → 2 confirmación → DB + notify admin.
 */
export const nuevaDonanteFlow: FlowHandler = {
  name: "nueva_donante",
  keyword: ["donar", "nueva", "empezar a donar", "quiero donar", "inscribir", "registrar"],

  async handle(state: ConversationState, message: string): Promise<FlowResponse> {
    const respuesta = message.trim();

    // Escape global #1 — "0" cancela en cualquier step.
    if (respuesta === "0") {
      return { reply: "", endFlow: true };
    }

    // Escape global #2 — frase de queja/reclamo/legal/etc detectada por
    // patrones determinísticos. Abandona el flow y deriva a humano sin
    // pasar por IA. Cubre casos como "Pero no trajeron mi regalo".
    const trigger = detectEscalationTrigger(respuesta);
    if (trigger) {
      logger.warn(
        { phone: state.phone, trigger: trigger.category, matched: trigger.matched },
        "nueva-donante: trigger de escalación detectado mid-flow → abandona registro",
      );
      return {
        reply:
          "Tu mensaje fue derivado a un representante de nuestro equipo. 🙏\n\n" +
          "Una persona se va a comunicar con vos a la brevedad para ayudarte.",
        endFlow: true,
        notify: {
          target: "admin",
          message:
            `🚨 *Trigger de escalación durante registro nueva-donante*\n\n` +
            `📱 Teléfono: ${state.phone}\n` +
            `💬 Mensaje: "${respuesta}"\n` +
            `🏷  Categoría: ${trigger.category}\n` +
            `🔍 Patrón: "${trigger.matched}"\n\n` +
            `La donante estaba registrándose pero cambió de tema. ` +
            `Atender manualmente.`,
        },
      };
    }

    switch (state.step) {
      case 0:
        return await handleNombre(respuesta, state);
      case 1:
        return await handleDireccion(respuesta, state);
      case 2:
        return await handleConfirmacion(respuesta, state);
      default:
        return { reply: "¡Gracias por sumarte!", endFlow: true };
    }
  },
};

// ============================================================
// IA contextual — evalúa mensaje según el step actual
// ============================================================

type PasoFlow = "nombre" | "direccion" | "confirmacion";

interface IAResultPaso {
  accion:
    | "continuar"          // dato válido capturado, avanzar
    | "cancelar"           // usuario quiere salir
    | "queja"              // cambio de tema a reclamo
    | "ya_donante"         // dice que ya está registrada
    | "consulta"           // pregunta sobre el sistema/registro
    | "no_entiendo";       // mensaje no clasificable
  valor?: string;          // dato extraído limpio (nombre, dirección, "si"/"no")
  confianza: "alta" | "media" | "baja";
  interpretacion?: string;
}

async function interpretarPasoConIA(
  mensaje: string,
  paso: PasoFlow,
  data: Record<string, any>,
  phone: string,
): Promise<IAResultPaso | null> {
  if (!env.AI_CLASSIFIER_ENABLED || !env.OPENAI_API_KEY) return null;

  const contextoStr = JSON.stringify(data);
  const promptBase = `Sos el clasificador del bot de WhatsApp de GARYCIO (recolección de orina para reciclaje).
Una donante está completando el registro. El paso actual es: "${paso}".
Datos capturados hasta ahora: ${contextoStr}.

REGLAS estrictas:
1. La donante puede escribir con muchos errores de ortografía y prefijos como "Soy X", "Me llamo X", "Mi nombre es X". Tenés que extraer el dato limpio.
2. Si la donante cambia de tema (queja sobre que no le trajeron algo, regalo, baja, etc), accion="queja".
3. Si la donante dice que ya es donante registrada, accion="ya_donante".
4. Si la donante hace una pregunta general (qué tengo que hacer, cuánto cuesta, etc), accion="consulta".
5. Si la donante quiere cancelar/salir, accion="cancelar".
6. Si entendés el dato pero no estás 100% seguro, confianza="media". Si tenés dudas, "baja".
7. Para el paso "nombre": valor = el nombre limpio sin "Soy/Me llamo/etc".
8. Para el paso "direccion": valor = la dirección limpia. Si no parece una dirección (tiene quejas, tiene "regalo", etc), accion="no_entiendo".
9. Para el paso "confirmacion": valor = "si" si confirma, "no" si quiere corregir, sino accion="no_entiendo".

Respondé SOLO con JSON:
{
  "accion": "continuar|cancelar|queja|ya_donante|consulta|no_entiendo",
  "valor": "string o null",
  "confianza": "alta|media|baja",
  "interpretacion": "lo que la donante quiso decir, en una frase"
}`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: promptBase },
          { role: "user", content: `Mensaje de la donante: "${mensaje}"` },
        ],
        max_tokens: 200,
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, "OpenAI no-ok en interpretarPasoConIA");
      return null;
    }

    const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
    const parsed = JSON.parse(data.choices[0].message.content);

    if (!["continuar", "cancelar", "queja", "ya_donante", "consulta", "no_entiendo"].includes(parsed.accion)) {
      logger.warn({ parsed }, "IA devolvió accion inválida — descarta");
      return null;
    }
    if (!["alta", "media", "baja"].includes(parsed.confianza)) {
      parsed.confianza = "baja";
    }

    logger.info(
      { phone, paso, mensaje: mensaje.slice(0, 60), parsed },
      "IA interpretó mensaje del flow nueva-donante",
    );

    return parsed as IAResultPaso;
  } catch (err) {
    logger.error({ err }, "Error llamando OpenAI en interpretarPasoConIA");
    return null;
  }
}

// ============================================================
// Step 0 — Nombre
// ============================================================

async function handleNombre(respuesta: string, state: ConversationState): Promise<FlowResponse> {
  // Mensaje vacío o saludo inicial sin datos = inicio automático
  const esSaludoBasico = /^(hola|buenas|que tal|q tal|buenos dias|buenas tardes|buenas noches)[\s]*$/i.test(respuesta);
  if (respuesta.length < 3 || esSaludoBasico) {
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

  // IA primero — clasifica + extrae nombre limpio
  const ia = await interpretarPasoConIA(respuesta, "nombre", state.data, state.phone);

  if (ia) {
    if (ia.accion === "queja") {
      return derivarPorReclamo(respuesta, state.phone, ia.interpretacion);
    }
    if (ia.accion === "cancelar") {
      return { reply: "", endFlow: true };
    }
    if (ia.accion === "ya_donante") {
      return derivarPorYaDonante(respuesta, state.phone, ia.interpretacion);
    }
    if (ia.accion === "consulta") {
      return aclararQueNecesitamos();
    }
    if (ia.accion === "continuar" && ia.valor && ia.confianza !== "baja") {
      const nombreLimpio = ia.valor.trim();
      if (nombreLimpio.length >= 3) {
        return {
          reply:
            `Perfecto, *${nombreLimpio}*. 👋\n\n` +
            "¿Cuál es tu *dirección completa*? (calle, número, piso si aplica, localidad)",
          nextStep: 1,
          data: { nombre: nombreLimpio },
        };
      }
    }
    // confianza baja o no_entiendo → pedir aclaración
    return pedirNombreOtraVez();
  }

  // Fallback sin IA — regex existente con un parche para prefijos comunes
  return await handleNombreFallback(respuesta, state);
}

function pedirNombreOtraVez(): FlowResponse {
  return {
    reply:
      "Perdón, no te entendí bien. 😊\n\n" +
      "Escribime solo tu *nombre completo* (ejemplo: María Pérez).\n\n" +
      "Si no querés registrarte, escribí *0*.",
    nextStep: 0,
  };
}

function aclararQueNecesitamos(): FlowResponse {
  return {
    reply:
      "Para registrarte como donante solo necesitamos:\n\n" +
      "• Tu *nombre completo*\n" +
      "• Tu *dirección* (para saber dónde pasar a recolectar)\n\n" +
      "¿Cuál es tu *nombre completo*?",
    nextStep: 0,
  };
}

function derivarPorReclamo(respuesta: string, phone: string, interpretacion?: string): FlowResponse {
  return {
    reply:
      "Tu mensaje fue derivado a un representante de nuestro equipo. 🙏\n\n" +
      "Una persona se va a comunicar con vos a la brevedad para ayudarte.",
    endFlow: true,
    notify: {
      target: "admin",
      message:
        `📋 *Reclamo durante registro nueva-donante*\n\n` +
        `📱 Teléfono: ${phone}\n` +
        `💬 Mensaje: "${respuesta}"\n` +
        (interpretacion ? `🤖 Interpretación: "${interpretacion}"\n` : "") +
        `\nLa donante estaba registrándose pero tiene un reclamo. Atender manualmente.`,
    },
  };
}

function derivarPorYaDonante(respuesta: string, phone: string, interpretacion?: string): FlowResponse {
  return {
    reply:
      "¡Disculpá! Si ya sos donante puede que tu número haya cambiado en nuestro sistema. 🙏\n\n" +
      "Le avisamos a nuestro equipo para que verifiquen tus datos y te contacten.",
    endFlow: true,
    notify: {
      target: "admin",
      message:
        `⚠️ *Donante dice que ya está registrada*\n\n` +
        `📱 Teléfono: ${phone}\n` +
        `💬 Mensaje: "${respuesta}"\n` +
        (interpretacion ? `🤖 Interpretación: "${interpretacion}"\n` : "") +
        `\nEl sistema no la encontró por este número. Verificar manualmente.`,
    },
  };
}

async function handleNombreFallback(respuesta: string, state: ConversationState): Promise<FlowResponse> {
  // Limpieza de prefijos comunes — "Me llamo X", "Soy X", "Mi nombre es X"
  const limpio = respuesta
    .replace(/^\s*(me\s+llamo|soy|mi\s+nombre\s+es)\s+/i, "")
    .trim();

  if (limpio.length < 3) return pedirNombreOtraVez();

  // Si parece dirección
  if (/\d{2,}/.test(limpio) && limpio.length > 10) {
    return {
      reply:
        "Eso parece una dirección. 📍\n\n" +
        "Primero necesitamos tu *nombre completo* y después te pedimos la dirección.\n\n" +
        "¿Cuál es tu nombre?",
      nextStep: 0,
    };
  }

  // Sin IA disponible y mensaje muy largo: derivar
  if (limpio.length > 35 || limpio.split(/\s+/).length > 5) {
    return {
      reply:
        "Recibimos tu mensaje. Le pasamos la info a nuestro equipo. 🙏\n\n" +
        "Si querés registrarte, escribinos solo tu *nombre completo*.",
      nextStep: 0,
      notify: {
        target: "admin",
        message:
          `❓ *Mensaje complejo en registro (sin IA)*\n\n` +
          `📱 Teléfono: ${state.phone}\n💬 "${respuesta}"\n\nRequiere atención manual.`,
      },
    };
  }

  return {
    reply:
      `Perfecto, *${limpio}*. 👋\n\n` +
      "¿Cuál es tu *dirección completa*? (calle, número, piso si aplica, localidad)",
    nextStep: 1,
    data: { nombre: limpio },
  };
}

// ============================================================
// Step 1 — Dirección
// ============================================================

async function handleDireccion(respuesta: string, state: ConversationState): Promise<FlowResponse> {
  // IA primero
  const ia = await interpretarPasoConIA(respuesta, "direccion", state.data, state.phone);

  if (ia) {
    if (ia.accion === "queja") return derivarPorReclamo(respuesta, state.phone, ia.interpretacion);
    if (ia.accion === "cancelar") return { reply: "", endFlow: true };
    if (ia.accion === "consulta") {
      return {
        reply:
          "Necesitamos tu *dirección* para que el recolector sepa dónde pasar.\n\n" +
          "Escribí: calle, número, piso si aplica, localidad.\n" +
          "(o *0* para cancelar)",
        nextStep: 1,
      };
    }
    if (ia.accion === "continuar" && ia.valor && ia.confianza !== "baja") {
      const direccionLimpia = ia.valor.trim();
      if (direccionLimpia.length >= 5) {
        return mostrarConfirmacion(state.data.nombre, direccionLimpia);
      }
    }
    // no_entiendo o confianza baja → pedir de nuevo
    return {
      reply:
        "Perdón, no entendí bien la dirección. 😊\n\n" +
        "Escribime calle y número (ejemplo: *Av. San Martín 456, Caballito*).\n\n" +
        "O escribí *0* para cancelar.",
      nextStep: 1,
    };
  }

  // Fallback sin IA
  if (respuesta.length < 5) {
    return {
      reply:
        "Necesitamos una dirección más completa para poder ubicarte. " +
        "¿Cuál es tu dirección? (o escribí *0* para cancelar)",
      nextStep: 1,
    };
  }
  return mostrarConfirmacion(state.data.nombre, respuesta);
}

function mostrarConfirmacion(nombre: string, direccion: string): FlowResponse {
  return {
    reply:
      "¡Anotado! 📝\n\n" +
      `Confirmemos tus datos:\n\n` +
      `👤 Nombre: *${nombre}*\n` +
      `📍 Dirección: *${direccion}*\n\n` +
      `¿Está todo correcto?\n*1* - Sí, confirmar\n*2* - No, corregir\n*0* - Cancelar`,
    nextStep: 2,
    data: { direccion },
  };
}

// ============================================================
// Step 2 — Confirmación
// ============================================================

async function handleConfirmacion(respuesta: string, state: ConversationState): Promise<FlowResponse> {
  // Atajo regex rápido para los casos típicos — evita llamada a IA innecesaria
  const trimmed = respuesta.trim();
  const lower = trimmed.toLowerCase();
  // Confirmación clara: "1", "1 ...", "si", "sí", "dale", "correcto"
  if (
    /^1(\s|$)/.test(trimmed) ||
    /^(si|sí|sep|sip|correcto|dale|ok|listo|confirmar)\b/i.test(trimmed)
  ) {
    return await guardarDonanteEnDB(state);
  }
  // Rechazo claro: "2", "no"
  if (/^2(\s|$)/.test(trimmed) || /^no\b/i.test(trimmed)) {
    return resetearFlow();
  }

  // Caso ambiguo → IA decide
  const ia = await interpretarPasoConIA(respuesta, "confirmacion", state.data, state.phone);
  if (ia) {
    if (ia.accion === "queja") return derivarPorReclamo(respuesta, state.phone, ia.interpretacion);
    if (ia.accion === "cancelar") return { reply: "", endFlow: true };
    if (ia.accion === "continuar" && ia.valor) {
      if (ia.valor === "si") return await guardarDonanteEnDB(state);
      if (ia.valor === "no") return resetearFlow();
    }
  }

  // No interpretable: reshow del menú de confirmación, NO resetear el flow.
  return {
    reply:
      "Perdón, no te entendí. 😊\n\n" +
      `Confirmemos tus datos:\n\n` +
      `👤 Nombre: *${state.data.nombre}*\n` +
      `📍 Dirección: *${state.data.direccion}*\n\n` +
      `Respondé:\n*1* - Sí, confirmar\n*2* - No, corregir\n*0* - Cancelar`,
    nextStep: 2,
  };
}

function resetearFlow(): FlowResponse {
  return {
    reply: "Sin problema, empecemos de nuevo.\n\n¿Cuál es tu *nombre completo*?",
    nextStep: 0,
    data: {},
  };
}

async function guardarDonanteEnDB(state: ConversationState): Promise<FlowResponse> {
  try {
    const existing = await db
      .select({ id: donantes.id })
      .from(donantes)
      .where(eq(donantes.telefono, state.phone))
      .limit(1);

    if (existing.length > 0) {
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
