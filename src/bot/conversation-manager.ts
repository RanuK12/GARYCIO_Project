/**
 * Conversation Manager — State Machine Persistente
 *
 * Principios:
 * 1. El estado es la fuente de verdad. Si existe, nunca se muestra bienvenida de nuevo.
 * 2. Cache en memoria = acelerador. DB = fuente de verdad.
 * 3. updateConversation SIEMPRE escribe en DB, incluso si no está en cache.
 * 4. La IA no reemplaza al estado; si la IA muestra un menú, se persiste el estado.
 */

import { ConversationState, FlowType, FlowResponse, InteractiveMessage, detectFlow, getFlowByName, isAdminPhone } from "./flows";
import type { MediaInfo } from "./webhook";
import { db } from "../database";
import { conversationStates, difusionEnvios, mensajesLog, donantes } from "../database/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { logger } from "../config/logger";
import { lookupRolPorTelefono } from "../services/contacto-donante";
import { classifyIntent, type ClassifierResult } from "../services/clasificador-ia";
import { isHumanEscalated, escalateToHuman } from "../services/human-escalation";
import { detectEscalationTrigger } from "../services/escalation-triggers";
import { procesarConsultaDonante } from "../services/consulta-donante";
import { generarRespuestaContextual } from "../services/respuesta-ia-contextual";

const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutos sin interacción = reset

// ── Cache en memoria (acelerador, NO fuente de verdad) ──
const conversationCache = new Map<string, ConversationState>();
const CACHE_MAX_SIZE = 2000;

// Limpieza periódica
setInterval(() => {
  const now = Date.now();
  const cutoff7d = now - 7 * 24 * 60 * 60 * 1000;
  const cutoff2h = now - 2 * 60 * 60 * 1000;
  let cleaned = 0;

  for (const [phone, state] of conversationCache) {
    if (now - state.lastInteraction.getTime() > cutoff7d) {
      conversationCache.delete(phone);
      cleaned++;
    }
  }

  if (conversationCache.size > CACHE_MAX_SIZE) {
    const sorted = [...conversationCache.entries()]
      .sort((a, b) => a[1].lastInteraction.getTime() - b[1].lastInteraction.getTime());
    const toRemove = sorted.slice(0, conversationCache.size - CACHE_MAX_SIZE);
    for (const [phone] of toRemove) {
      conversationCache.delete(phone);
      cleaned++;
    }
  }

  // Limpiar frustration counters viejos (2h sin actividad → reset)
  for (const [phone, data] of frustrationCounter) {
    if (now - data.lastSeen > cutoff2h) {
      frustrationCounter.delete(phone);
      cleaned++;
    }
  }

  if (cleaned > 0) logger.debug({ cleaned }, "Cache de conversaciones limpiada");
}, 60 * 60 * 1000);

// ── Contador de frustración progresiva ──
// Trackea mensajes frustrados/enojados por teléfono.
// 1er mensaje angry → IA responde empáticamente (sin escalar)
// 2do mensaje angry → IA responde + notifica admin como alerta
// 3er+ mensaje angry → hard escalate a humano (la persona está insistente)
// Se resetea después de 2h sin mensajes frustrados o cuando admin resuelve.
const frustrationCounter = new Map<string, { count: number; lastSeen: number }>();
const FRUSTRATION_ESCALATE_THRESHOLD = 3; // Al 3er mensaje frustrado, escalar
const FRUSTRATION_HARD_LIMIT = 500;

function trackFrustration(phone: string, sentiment: string | undefined, needsHuman: boolean): number {
  if (!needsHuman && sentiment !== "angry" && sentiment !== "frustrated") {
    // Mensaje tranquilo → resetear contador (la donante se calmó)
    frustrationCounter.delete(phone);
    return 0;
  }

  const now = Date.now();
  const current = frustrationCounter.get(phone);

  // Si pasaron más de 2 horas, resetear
  if (current && now - current.lastSeen > 2 * 60 * 60 * 1000) {
    frustrationCounter.delete(phone);
  }

  // Hard limit de entries
  if (!frustrationCounter.has(phone) && frustrationCounter.size >= FRUSTRATION_HARD_LIMIT) {
    const oldest = [...frustrationCounter.entries()]
      .sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0];
    if (oldest) frustrationCounter.delete(oldest[0]);
  }

  const data = frustrationCounter.get(phone) || { count: 0, lastSeen: now };
  data.count++;
  data.lastSeen = now;
  frustrationCounter.set(phone, data);

  return data.count;
}

// ── Leer estado (DB es fuente de verdad, cache es acelerador) ──
async function getConversation(phone: string): Promise<ConversationState | null> {
  // 1. Cache hit válido
  const cached = conversationCache.get(phone);
  if (cached) {
    if (Date.now() - cached.lastInteraction.getTime() > TIMEOUT_MS) {
      await endConversation(phone);
      return null;
    }
    return cached;
  }

  // 2. Leer de DB
  const rows = await db
    .select()
    .from(conversationStates)
    .where(eq(conversationStates.phone, phone))
    .limit(1);

  if (rows.length === 0) return null;

  const row = rows[0];
  const state: ConversationState = {
    phone,
    currentFlow: row.currentFlow as FlowType | null,
    step: row.step ?? 0,
    data: (row.data as Record<string, any>) || {},
    lastInteraction: row.lastInteraction ?? new Date(),
  };

  if (Date.now() - state.lastInteraction.getTime() > TIMEOUT_MS) {
    await endConversation(phone);
    return null;
  }

  conversationCache.set(phone, state);
  return state;
}

// ── Crear o reemplazar estado ──
async function startConversation(phone: string, flow: FlowType): Promise<ConversationState> {
  const state: ConversationState = {
    phone,
    currentFlow: flow,
    step: 0,
    data: {},
    lastInteraction: new Date(),
  };

  await db
    .insert(conversationStates)
    .values({
      phone,
      currentFlow: flow,
      step: 0,
      data: {},
      lastInteraction: new Date(),
    })
    .onConflictDoUpdate({
      target: conversationStates.phone,
      set: {
        currentFlow: flow,
        step: 0,
        data: {},
        lastInteraction: new Date(),
      },
    });

  conversationCache.set(phone, state);
  return state;
}

// ── Actualizar estado (SIEMPRE escribe en DB, con o sin cache) ──
async function updateConversation(phone: string, updates: Partial<ConversationState>): Promise<void> {
  const state = conversationCache.get(phone);
  const now = new Date();

  if (state) {
    Object.assign(state, updates, { lastInteraction: now });
  }

  // Upsert en DB para garantizar persistencia
  await db
    .insert(conversationStates)
    .values({
      phone,
      currentFlow: updates.currentFlow ?? state?.currentFlow ?? null,
      step: updates.step ?? state?.step ?? 0,
      data: updates.data ?? state?.data ?? {},
      lastInteraction: now,
    })
    .onConflictDoUpdate({
      target: conversationStates.phone,
      set: {
        currentFlow: updates.currentFlow ?? state?.currentFlow ?? null,
        step: updates.step ?? state?.step ?? 0,
        data: updates.data ?? state?.data ?? {},
        lastInteraction: now,
      },
    });

  // Re-hidratar cache si no estaba
  if (!state) {
    conversationCache.set(phone, {
      phone,
      currentFlow: (updates.currentFlow ?? null) as FlowType | null,
      step: updates.step ?? 0,
      data: (updates.data ?? {}) as Record<string, any>,
      lastInteraction: now,
    });
  }
}

// ── Finalizar conversación ──
async function endConversation(phone: string): Promise<void> {
  conversationCache.delete(phone);
  await db.delete(conversationStates).where(eq(conversationStates.phone, phone));
}

// ── Menús ──
function getMenuPrincipalInteractive(phone: string): { reply: string; interactive: InteractiveMessage } {
  if (isAdminPhone(phone)) {
    return {
      reply: "",
      interactive: {
        type: "list",
        body: "¡Hola! 👋 Soy el asistente de GARYCIO.\n¿Qué querés hacer?",
        buttonText: "Ver opciones",
        sections: [{
          rows: [
            { id: "1", title: "Tengo un reclamo" },
            { id: "2", title: "Dar un aviso", description: "Vacaciones, enfermedad, etc." },
            { id: "3", title: "Otra consulta" },
            { id: "4", title: "Panel de admin" },
          ],
        }],
      },
    };
  }
  return {
    reply: "",
    interactive: {
      type: "buttons",
      body: "¡Hola! 👋 Soy el asistente de GARYCIO.\n¿En qué te puedo ayudar?",
      buttons: [
        { id: "1", title: "Tengo un reclamo" },
        { id: "2", title: "Dar un aviso" },
        { id: "3", title: "Otra consulta" },
      ],
    },
  };
}

function getMenuPrincipalTexto(phone: string): string {
  if (isAdminPhone(phone)) {
    return (
      "¡Hola! 👋 Soy el asistente de GARYCIO.\n\n" +
      "¿Qué querés hacer?\n\n" +
      "*1* - Tengo un reclamo\n" +
      "*2* - Quiero dar un aviso (suspender donación, enfermedad, etc.)\n" +
      "*3* - Otro motivo\n" +
      "*4* - Panel de administración"
    );
  }
  return (
    "¡Hola! 👋 Soy el asistente de GARYCIO.\n\n" +
    "¿En qué te puedo ayudar?\n\n" +
    "*1* - Tengo un reclamo\n" +
    "*2* - Quiero dar un aviso (suspender donación, enfermedad, etc.)\n" +
    "*3* - Otro motivo"
  );
}

// ── Arrancar un flow ──
async function iniciarFlow(
  phone: string,
  flow: FlowType,
  initialMessage: string = "",
): Promise<{ state: ConversationState; reply: string; interactive?: InteractiveMessage; notify?: FlowResponse["notify"] }> {
  const state = await startConversation(phone, flow);
  const flowHandler = getFlowByName(flow);
  if (!flowHandler) {
    const menu = getMenuPrincipalInteractive(phone);
    return { state, reply: menu.reply, interactive: menu.interactive };
  }

  const response = await flowHandler.handle(state, initialMessage, undefined);
  if (response.data) state.data = { ...state.data, ...response.data };
  if (response.nextStep !== undefined) {
    state.step = response.nextStep;
    await updateConversation(phone, state);
  }
  return { state, reply: response.reply, interactive: response.interactive, notify: response.notify };
}

// ── Procesar mensaje entrante (API pública) ──
export async function handleIncomingMessage(
  phone: string,
  message: string,
  mediaInfo?: MediaInfo,
): Promise<{
  reply: string;
  interactive?: InteractiveMessage;
  notify?: FlowResponse["notify"];
  flowData?: { flowName: string; data: Record<string, any> };
  needsHuman?: boolean;
}> {
  // 1. Verificar escalación humana activa
  if (await isHumanEscalated(phone)) {
    logger.info({ phone }, "Usuario escalado — mensaje derivado a humano (silencio al usuario)");
    // NO enviar nada al usuario — ya recibió mensaje de escalación.
    // Solo notificar al admin para que vea los mensajes nuevos.
    return {
      reply: "",
      notify: {
        target: "admin",
        message: `🙋 *Mensaje de usuario escalado*\n\n📱 ${phone}\n💬 "${message.slice(0, 200)}"`,
      },
      needsHuman: true,
    };
  }

  // P2.1 — Frases gatillo de escalación inmediata (legal, financiero, urgencia,
  // frustración larga, disconformidad grave, amenaza de baja). Saltean la IA.
  const trigger = detectEscalationTrigger(message);
  if (trigger) {
    await escalateToHuman(phone, "user_request", {
      lastMessage: message,
      intent: `trigger:${trigger.category}:${trigger.matched}`,
    }, false);
    return {
      reply:
        "Tu caso ya fue derivado a nuestro equipo. Te van a contactar a la brevedad. No es necesario que sigas escribiendo, ya tenemos tu mensaje.",
      notify: {
        target: "admin",
        message:
          `🚨 *ESCALACIÓN AUTOMÁTICA (${trigger.category})*\n\n` +
          `📱 ${phone}\n` +
          `💬 "${message.slice(0, 200)}"\n\n` +
          `Patrón detectado: "${trigger.matched}".\n` +
          `Requiere contacto humano inmediato.`,
      },
      needsHuman: true,
    };
  }

  let state = await getConversation(phone);

  // 2. Escape global: hablar con persona
  if (detectarHablarConPersona(message)) {
    if (state) await endConversation(phone);
    await escalateToHuman(phone, "user_request", { lastMessage: message }, false);
    return {
      reply:
        "Tu caso ya fue derivado a nuestro equipo. Te van a contactar a la brevedad. No es necesario que sigas escribiendo, ya tenemos tu mensaje.",
      notify: {
        target: "admin",
        message:
          `🙋 *SOLICITUD DE ATENCIÓN HUMANA*\n\n` +
          `📱 Teléfono: ${phone}\n` +
          `💬 Mensaje: "${message}"\n\n` +
          `⚠️ La persona pidió hablar con alguien. Requiere contacto manual.`,
      },
      needsHuman: true,
    };
  }

  // 3. Sin sesión activa
  if (!state) {
    // 3a. Detectar intención de baja
    if (detectarIntenciónBaja(message)) {
      await escalateToHuman(phone, "user_request", { lastMessage: message, intent: "baja" }, false);
      return {
        reply:
          "Lamentamos que quieras dejar de participar. 💙\n\n" +
          "Tu caso ya fue derivado a nuestro equipo. Te van a contactar a la brevedad. No es necesario que sigas escribiendo, ya tenemos tu mensaje.",
        notify: {
          target: "admin",
          message:
            `🚨 *ATENCIÓN PERSONALIZADA REQUERIDA*\n\n` +
            `📱 Donante: ${phone}\n` +
            `💬 Mensaje: "${message}"\n` +
            `📋 Motivo detectado: Intención de baja/abandono\n\n` +
            `⚠️ Requiere contacto manual a la brevedad.`,
        },
        needsHuman: true,
      };
    }

    // 3b. Lookup de rol
    const { rol, estado: donorEstado } = await lookupRolPorTelefono(phone);
    logger.debug({ phone, rol, donorEstado }, "Rol detectado por teléfono");

    if (rol === "chofer") {
      return {
        reply: "Hola 👋 El sistema para choferes todavía no está habilitado.\n\nCuando esté listo te avisamos. ¡Gracias!",
      };
    }
    if (rol === "peon") {
      return {
        reply: "Hola 👋 El sistema para el personal de recolección todavía no está habilitado.\n\nCuando esté listo te avisamos. ¡Gracias!",
      };
    }
    if (rol === "visitadora") {
      const { reply, interactive, notify } = await iniciarFlow(phone, "visitadora", message);
      return { reply, interactive, notify };
    }
    if (rol === "admin") {
      const { reply, interactive, notify } = await iniciarFlow(phone, "admin", message);
      return { reply, interactive, notify };
    }

    // Contacto auto-registrado sin completar datos → continuar registro
    if (rol === "donante" && donorEstado === "nueva") {
      const { reply, notify } = await iniciarFlow(phone, "nueva_donante", message);
      return { reply, notify };
    }

    // Donante existente con datos completos → NUNCA re-registrar
    if (rol === "donante" && donorEstado && donorEstado !== "nueva") {
      const donanteExistente = await db
        .select({ nombre: donantes.nombre, direccion: donantes.direccion })
        .from(donantes)
        .where(eq(donantes.telefono, phone))
        .limit(1);

      if (donanteExistente.length > 0 && donanteExistente[0].nombre && donanteExistente[0].direccion) {
        logger.info({ phone, estado: donorEstado, nombre: donanteExistente[0].nombre }, "Donante con datos completos — evitando re-registro");
        // No iniciar nueva_donante; continuar con clasificación IA normal
      }
    }

    // 3c. Para donantes: detectar keyword
    const detectedFlow = detectFlow(message, phone);
    if (detectedFlow) {
      // Crear sesión y pasar mensaje vacío al flow para que muestre su menú inicial
      state = await startConversation(phone, detectedFlow.name);
      const flowHandler = getFlowByName(detectedFlow.name);
      if (flowHandler) {
        const response = await flowHandler.handle(state, "", undefined);
        if (response.data) state.data = { ...state.data, ...response.data };
        if (response.nextStep !== undefined) {
          state.step = response.nextStep;
          await updateConversation(phone, state);
        }
        return { reply: response.reply, interactive: response.interactive, notify: response.notify };
      }
    }

    // 3d. Confirmar difusión
    if (esConfirmacionDifusion(message)) {
      const phoneSinPlus = phone.startsWith("+") ? phone.slice(1) : phone;
      const phoneConPlus = phone.startsWith("+") ? phone : `+${phone}`;
      let pendiente = await db
        .select({ id: difusionEnvios.id })
        .from(difusionEnvios)
        .where(and(eq(difusionEnvios.confirmado, false), eq(difusionEnvios.telefono, phoneSinPlus)))
        .limit(1);
      if (pendiente.length === 0) {
        pendiente = await db
          .select({ id: difusionEnvios.id })
          .from(difusionEnvios)
          .where(and(eq(difusionEnvios.confirmado, false), eq(difusionEnvios.telefono, phoneConPlus)))
          .limit(1);
      }
      if (pendiente.length > 0) {
        await db
          .update(difusionEnvios)
          .set({ confirmado: true, fechaConfirmacion: new Date() })
          .where(eq(difusionEnvios.id, pendiente[0].id));
        logger.info({ phone }, "Confirmación de difusión registrada");
        const menu = getMenuPrincipalInteractive(phone);
        return {
          reply: "✅ *Recepción confirmada* ¡Gracias! Te esperamos en los días indicados.\nRecordá tener el bidón listo antes del horario indicado.",
          interactive: menu.interactive,
          notify: {
            target: "admin",
            message: `✅ Donante ${phone} confirmó recepción del mensaje de difusión.`,
          },
        };
      }
    }

    // 3e. Número desconocido → registro
    if (rol === "desconocido") {
      const { reply, notify } = await iniciarFlow(phone, "nueva_donante", message);
      return { reply, notify };
    }

    // 3f. Donante conocida sin sesión → clasificar con IA y responder contextualmente
    const resultado = await procesarConIA(phone, message);

    // Solo crear contacto_inicial para donantes NUEVOS o desconocidos que saludan
    // Donantes con datos completos reciben respuesta IA directa (sin flow rígido)
    const esSaludoOMenu = resultado.intent === "saludo" || resultado.intent === "menu_opcion";
    if (esSaludoOMenu && (!donorEstado || donorEstado === "nueva")) {
      await startConversation(phone, "contacto_inicial");
    }

    // ── Frustración progresiva ──
    // Trackear si la donante está frustrada/enojada/insistente.
    // 1er mensaje → IA responde empáticamente
    // 2do mensaje → IA responde + alerta al admin
    // 3er+ mensaje → hard escalate (la persona está insistente, necesita humano)
    const frustLevel = trackFrustration(phone, resultado.sentiment, resultado.needsHuman ?? false);
    const shouldHardEscalate =
      resultado.confidence === "low" ||  // IA no entiende → humano
      frustLevel >= FRUSTRATION_ESCALATE_THRESHOLD;  // Insistente/enojada 3+ veces → humano

    if (shouldHardEscalate) {
      const reason: Parameters<typeof escalateToHuman>[1] =
        resultado.confidence === "low" ? "ia_fail" : "frustration";
      await escalateToHuman(phone, reason, {
        lastMessage: message,
        intent: resultado.intent,
      }, false);
      logger.warn(
        { phone, frustLevel, confidence: resultado.confidence },
        "Hard escalation: frustración acumulada o IA no puede resolver",
      );
      resultado.reply = "Tu caso ya fue derivado a nuestro equipo. Te van a contactar a la brevedad. No es necesario que sigas escribiendo, ya tenemos tu mensaje.";
    } else if (frustLevel > 0) {
      // Frustrada pero no insistente todavía → IA responde + log
      logger.info(
        { phone, frustLevel, intent: resultado.intent, sentiment: resultado.sentiment },
        "Donante frustrada — IA responde, monitoreando insistencia",
      );
    }

    // Construir notificación según nivel de frustración
    let notifyPayload = resultado.notify;
    if (frustLevel >= 2 || shouldHardEscalate) {
      // Nivel 2+: alertar al admin
      const urgencyEmoji = shouldHardEscalate ? "🚨" : "⚠️";
      const urgencyLabel = shouldHardEscalate ? "ESCALADA A HUMANO" : "ATENCIÓN REQUERIDA";
      notifyPayload = {
        target: "admin" as const,
        message:
          `${urgencyEmoji} *${urgencyLabel}*\n\n` +
          `📱 ${phone}\n` +
          `😤 Frustración: ${frustLevel}/${FRUSTRATION_ESCALATE_THRESHOLD}\n` +
          `🎯 Intent: ${resultado.intent}\n` +
          `💬 "${message.slice(0, 150)}"\n` +
          `🤖 Respuesta IA: "${(resultado.reply || "").slice(0, 100)}"\n\n` +
          (shouldHardEscalate
            ? "La donante fue derivada a humano por insistencia."
            : "La IA está respondiendo, pero la donante necesita atención."),
      };
    } else if (frustLevel === 1) {
      // Primer enojo: solo supervisión silenciosa (el admin ve en el dashboard)
      notifyPayload = {
        target: "admin" as const,
        message:
          `👀 *Supervisión IA*\n\n` +
          `📱 ${phone}\n` +
          `🎯 Intent: ${resultado.intent} | Sentiment: ${resultado.sentiment || "unknown"}\n` +
          `💬 "${message.slice(0, 150)}"\n` +
          `🤖 Respuesta: "${(resultado.reply || "").slice(0, 80)}"\n\n` +
          `Primer mensaje frustrado. IA respondió.`,
      };
    }

    return {
      reply: resultado.reply,
      interactive: resultado.interactive,
      notify: notifyPayload,
      flowData: resultado.flowData,
      // Solo marcar needsHuman si realmente se hard-escaló
      needsHuman: shouldHardEscalate,
    };
  }

  // 4. Con sesión activa pero sin flow (estado zombie)
  if (!state.currentFlow) {
    const option = message.trim().toLowerCase();
    let targetFlow: FlowType | null = null;
    if (option === "1" || option === "tengo un reclamo") targetFlow = "reclamo";
    else if (option === "2" || option === "dar un aviso") targetFlow = "aviso";
    else if (option === "3" || option === "otra consulta") targetFlow = "consulta_general";
    else if ((option === "4" || option === "panel de admin") && isAdminPhone(phone)) targetFlow = "admin";

    if (targetFlow) {
      state.currentFlow = targetFlow;
      state.step = 0;
      await updateConversation(phone, state);
      const flowHandler = getFlowByName(targetFlow);
      if (flowHandler) {
        const response = await flowHandler.handle(state, "", undefined);
        if (response.data) state.data = { ...state.data, ...response.data };
        if (response.nextStep !== undefined) {
          state.step = response.nextStep;
          await updateConversation(phone, state);
        }
        return { reply: response.reply, interactive: response.interactive, notify: response.notify };
      }
    }
  }

  // 5. Procesar dentro del flow activo
  if (!state.currentFlow) {
    await endConversation(phone);
    return { reply: "Hubo un error interno. Por favor escribí de nuevo." };
  }
  const flowHandler = getFlowByName(state.currentFlow);
  if (!flowHandler) {
    await endConversation(phone);
    return { reply: "Hubo un error interno. Por favor escribí de nuevo." };
  }

  try {
    const response = await flowHandler.handle(state, message, mediaInfo);

    if (response.data) {
      state.data = { ...state.data, ...response.data };
    }

    const flowData = (response.endFlow || response.notify)
      ? { flowName: state.currentFlow!, data: { ...state.data } }
      : undefined;

    if (response.endFlow) {
      const prevFlow = state.currentFlow;
      await endConversation(phone);

      // Re-detectar si el mensaje es keyword de otro flow
      const redetected = detectFlow(message, phone);
      if (redetected && redetected.name !== prevFlow) {
        const newState = await startConversation(phone, redetected.name);
        const newResponse = await redetected.handle(newState, "", undefined);
        if (newResponse.data) newState.data = { ...newState.data, ...newResponse.data };
        if (newResponse.nextStep !== undefined) {
          newState.step = newResponse.nextStep;
          await updateConversation(phone, newState);
        }
        const prefix = response.reply ? response.reply + "\n\n" : "";
        return {
          reply: prefix + newResponse.reply,
          notify: response.notify || newResponse.notify,
          flowData,
        };
      }

      if (!response.reply) {
        const menu = getMenuPrincipalInteractive(phone);
        return { reply: menu.reply, interactive: menu.interactive, notify: response.notify, flowData };
      }
    } else if (response.nextStep !== undefined) {
      state.step = response.nextStep;
      await updateConversation(phone, state);
    }

    logger.debug({ phone, flow: state.currentFlow, step: state.step }, "Mensaje procesado");
    return { reply: response.reply, interactive: response.interactive, notify: response.notify, flowData };
  } catch (err) {
    logger.error({ phone, err }, "Error procesando mensaje en flow");
    await endConversation(phone);
    return { reply: "Disculpá, hubo un error. ¿Podés intentar de nuevo?" };
  }
}

// ── Procesar con IA (solo para usuarios sin sesión activa) ──
async function procesarConIA(
  phone: string,
  message: string,
): Promise<{
  reply: string;
  interactive?: InteractiveMessage;
  notify?: FlowResponse["notify"];
  flowData?: { flowName: string; data: Record<string, any> };
  intent: string;
  needsHuman: boolean;
  confidence: "high" | "medium" | "low";
  sentiment?: string;
}> {
  // Obtener historial para contexto
  let historial: string[] | undefined;
  try {
    const rows = await db
      .select({ contenido: mensajesLog.contenido, direccion: mensajesLog.direccion })
      .from(mensajesLog)
      .where(eq(mensajesLog.telefono, phone))
      .orderBy(desc(mensajesLog.id))
      .limit(6);

    historial = rows
      .reverse()
      .map((m) => `${m.direccion === "entrante" ? "Donante" : "Bot"}: ${m.contenido}`)
      .slice(0, 5);
  } catch { /* sin historial */ }

  const result = await classifyIntent(message, { historial, timeoutMs: 8000 });

  logger.info(
    { phone, intent: result.intent, needsHuman: result.needsHuman, sentiment: result.sentiment, confidence: result.confidence },
    "Mensaje clasificado por IA",
  );

  // ── Detección de mensajes mixtos: si dice "gracias" PERO tiene una solicitud real,
  //    forzar a consulta para no quedar en silencio ──
  let effectiveIntent = result.intent;
  if (result.intent === "agradecimiento" || result.intent === "irrelevante") {
    const lowerMsg = message.toLowerCase();
    const verbosSolicitud = ["retiren", "pasen", "traigan", "lleven", "vayan", "dejen", "traer", "llevar", "retirar", "pasar"];
    const tieneSolicitud = verbosSolicitud.some((v) => lowerMsg.includes(v));
    if (tieneSolicitud) {
      logger.info({ phone, originalIntent: result.intent }, "Mensaje mixto detectado (agradecimiento + solicitud) → forzado a consulta");
      effectiveIntent = "consulta";
    }
  }

  // Templates fallback solo para intents que NO necesitan IA contextual
  const templatesFallback: Record<string, { text: string; showMenu?: boolean }> = {
    confirmar_difusion: { text: "Recepción confirmada. Te esperamos en los días indicados. Recordá tener el bidón listo.", showMenu: true },
    baja: { text: "Lamentamos que quieras dejar de participar. Una persona de nuestro equipo se va a comunicar con vos.", showMenu: false },
    hablar_persona: { text: "Tu mensaje fue derivado a nuestro equipo. Una persona se va a comunicar con vos a la brevedad.", showMenu: false },
    irrelevante: { text: "", showMenu: false },
    menu_opcion: { text: "", showMenu: true },
    multiple_issues: { text: "Veo que tenés varias cosas para contarnos. Te derivamos con un representante para que te ayude en todo.", showMenu: false },
  };

  // Intenciones que deben resolverse con IA contextual (80% del tráfico)
  const INTENTS_IA_CONTEXTUAL = new Set(["saludo", "agradecimiento", "aviso", "reclamo"]);

  let reply: string;
  let interactive: InteractiveMessage | undefined;
  let notify: FlowResponse["notify"] | undefined;
  let flowData: { flowName: string; data: Record<string, any> } | undefined;

  if (INTENTS_IA_CONTEXTUAL.has(effectiveIntent)) {
    // ── Respuesta IA contextual: usa datos DB + templates + training examples ──
    try {
      reply = await generarRespuestaContextual({
        phone,
        message,
        intent: effectiveIntent,
        historial,
      });
      logger.info({ phone, intent: effectiveIntent }, "Respuesta generada por IA contextual");
    } catch (err) {
      logger.error({ err, phone, intent: effectiveIntent }, "Error en IA contextual, usando fallback");
      reply = templatesFallback[effectiveIntent]?.text || "Recibimos tu mensaje. Te respondemos a la brevedad.";
    }
  } else {
    // ── Templates para intents no conversacionales ──
    const tpl = templatesFallback[effectiveIntent];
    reply = tpl?.text || "Recibimos tu mensaje. Te respondemos a la brevedad.";
  }

  // Mostrar menú para saludo y menu_opcion
  const showMenu = effectiveIntent === "saludo" || effectiveIntent === "menu_opcion" || effectiveIntent === "confirmar_difusion";

  if (showMenu) {
    const menu = getMenuPrincipalInteractive(phone);
    interactive = menu.interactive;
  }

  // Whitelist de valores válidos para entidades (evita data contamination)
  const VALID_TIPO_RECLAMO = new Set(["no_pasaron", "falta_bidon", "bidon_sucio", "pelela", "regalo", "otro"]);
  const VALID_TIPO_AVISO = new Set(["vacaciones", "enfermedad", "mudanza", "cambio_direccion", "cambio_telefono", "general"]);

  // Notificaciones según intención
  switch (result.intent) {
    case "reclamo": {
      let tipo = result.entities.find((e) => e.type === "tipoReclamo")?.value || "otro";
      if (!VALID_TIPO_RECLAMO.has(tipo)) {
        logger.warn({ tipo, phone }, "tipoReclamo inválido de IA — forzando a 'otro'");
        tipo = "otro";
      }
      notify = {
        target: result.sentiment === "angry" ? "admin" : "chofer",
        message:
          `📋 *Nuevo reclamo${result.sentiment === "angry" ? " URGENTE" : ""}*\n\n` +
          `📱 Donante: ${phone}\n` +
          `Tipo: ${tipo}\n` +
          `Sentimiento: ${result.sentiment}\n` +
          `💬 Mensaje: "${message}"`,
      };
      flowData = { flowName: "reclamo", data: { tipoReclamo: tipo, detalleReclamo: message, sentiment: result.sentiment } };
      break;
    }
    case "aviso": {
      let tipoAviso = result.entities.find((e) => e.type === "tipoAviso")?.value || "general";
      if (!VALID_TIPO_AVISO.has(tipoAviso)) {
        logger.warn({ tipoAviso, phone }, "tipoAviso inválido de IA — forzando a 'general'");
        tipoAviso = "general";
      }
      notify = {
        target: "chofer",
        message:
          `📢 *Aviso de donante*\n\n` +
          `📱 Donante: ${phone}\n` +
          `Tipo: ${tipoAviso}\n` +
          `💬 Mensaje: "${message}"`,
      };
      break;
    }
    case "baja":
      notify = {
        target: "admin",
        message:
          `🚨 *INTENCIÓN DE BAJA*\n\n` +
          `📱 Donante: ${phone}\n` +
          `💬 Mensaje: "${message}"\n\n` +
          `⚠️ Requiere contacto manual a la brevedad.`,
      };
      break;
    case "hablar_persona":
      notify = {
        target: "admin",
        message:
          `🙋 *SOLICITUD DE ATENCIÓN HUMANA*\n\n` +
          `📱 Teléfono: ${phone}\n` +
          `💬 Mensaje: "${message}"\n\n` +
          `⚠️ Requiere contacto manual.`,
      };
      break;
    case "consulta": {
      // Primero: servicio inteligente con datos reales de la DB
      const consultaResult = await procesarConsultaDonante(phone, message);
      if (consultaResult.resuelta) {
        reply = consultaResult.reply;
      } else {
        // Fallback: IA contextual cuando la DB no tiene datos suficientes
        try {
          reply = await generarRespuestaContextual({
            phone, message, intent: "consulta", historial,
          });
        } catch {
          reply = consultaResult.reply; // usar lo que devolvió procesarConsultaDonante
        }
      }
      if (consultaResult.notify) {
        notify = consultaResult.notify;
      }
      // Si baja confianza + no resuelta → notificar al admin
      if (result.confidence === "low" && !consultaResult.resuelta) {
        notify = {
          target: "admin",
          message:
            `❓ *Consulta de donante (baja confianza IA + no resuelta por bot)*\n\n` +
            `📱 Donante: ${phone}\n` +
            `💬 "${message}"\n\n` +
            `Tipo detectado: ${consultaResult.tipo}\n` +
            `La IA no pudo clasificar con confianza y el bot no pudo resolver con datos. Requiere respuesta manual.`,
        };
      }
      break;
    }
    case "confirmar_difusion":
      notify = {
        target: "admin",
        message: `✅ Donante ${phone} confirmó recepción del mensaje de difusión.`,
      };
      break;
  }

  return { reply, interactive, notify, flowData, intent: result.intent, needsHuman: result.needsHuman, confidence: result.confidence, sentiment: result.sentiment };
}

// ── Helpers de detección ──

export function esConfirmacionDifusion(message: string): boolean {
  const clean = message
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (/[,\.\s]*1[,\.\s]*/g.test(clean) && clean.length < 60) {
    const sinPuntuacion = clean.replace(/[^a-z0-9\s]/g, "").trim();
    if (sinPuntuacion === "1") return true;
    if (/^1\s+(recibido|recibí|recibi|ok|si|listo|gracias|dale|bueno|bien|confirmado|confirmo|mensaje|el mensaje|recibido el mensaje)/.test(sinPuntuacion))
      return true;
  }

  const confirmaciones = [
    "confirmar recepcion", "confirmar recepción", "confirmo recepcion",
    "recibido", "recibi", "recibí", "recibido el mensaje",
    "si recibido", "si recibi", "si recibí",
    "confirmado", "confirmo", "entendido",
    "ok recibido", "dale recibido", "si lo recibi",
  ];
  return confirmaciones.some((c) => clean.includes(c));
}

function detectarIntenciónBaja(message: string): boolean {
  const lower = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const FRASES_BAJA = [
    "me quiero bajar", "quiero darme de baja", "quiero dejar de donar",
    "ya no quiero donar", "no quiero donar mas", "no voy a donar mas",
    "deme de baja", "dame de baja", "quiero salir", "quiero cancelar",
    "no quiero participar", "quiero que me den de baja",
    "dejen de venir", "no pasen mas", "no pasen por mi casa", "ya no participo",
  ];
  return FRASES_BAJA.some((frase) => lower.includes(frase));
}

function detectarHablarConPersona(message: string): boolean {
  const lower = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const FRASES = [
    "hablar con una persona", "hablar con alguien",
    "quiero hablar con alguien", "necesito hablar con alguien",
    "quiero un humano", "necesito atencion humana", "quiero hablar con una persona",
  ];
  return FRASES.some((frase) => lower.includes(frase));
}

// ── P0.9 — Reset al arrancar el bot ──────────────────────
/**
 * Política acordada con el dueño: cuando el bot enciende, descarta TODOS
 * los flows en curso. Las donantes que estaban a mitad de un menú vuelven
 * a empezar desde 0 con su próximo mensaje.
 *
 * - Limpia cache en memoria
 * - Borra `conversation_states` (NO toca `human_escalations` ni `mensajes_log`)
 *
 * Llamar UNA vez en `index.ts` justo antes de aceptar tráfico.
 */
export async function resetConversationalStateOnStart(): Promise<void> {
  const prevCacheSize = conversationCache.size;
  conversationCache.clear();
  const deleted = await db.delete(conversationStates);
  const rowCount = (deleted as { rowCount?: number }).rowCount ?? 0;
  logger.warn(
    { deletedFlows: rowCount, cachedFlows: prevCacheSize },
    "P0.9 — Estado conversacional reseteado al arrancar. Bot olvida flows previos.",
  );

  // P0.13 — Pre-pausa de teléfonos con humano interviniendo recientemente.
  // Mientras el bot estuvo apagado, un humano pudo haber respondido en
  // 360 Inbox o en WhatsApp Business App. Si vemos que el ÚLTIMO mensaje
  // de una donante en las últimas 24h fue saliente (=alguien le escribió
  // desde nuestro número), pausamos al bot para ese phone por 4h. Así
  // evitamos que el bot reabra una conversación que un humano cerró.
  try {
    const { pauseBotForPhone } = await import("../services/bot-takeover");
    const rows = await db.execute<{ telefono: string; direccion_msg: string }>(sql`
      SELECT DISTINCT ON (telefono) telefono, direccion_msg
      FROM mensajes_log
      WHERE created_at > NOW() - INTERVAL '24 hours'
        AND telefono IS NOT NULL
      ORDER BY telefono, created_at DESC
    `);
    let pausados = 0;
    for (const r of rows.rows ?? []) {
      if (r.direccion_msg === "saliente") {
        pauseBotForPhone(r.telefono, "humano-respondio-pre-boot");
        pausados++;
      }
    }
    logger.warn(
      { pausados },
      "P0.13 — Phones con humano respondiendo en últimas 24h: bot pausado para esos números",
    );
  } catch (err) {
    logger.error({ err }, "Error pre-pausando teléfonos con humano reciente (no bloquea start)");
  }
}
