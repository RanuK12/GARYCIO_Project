import { ConversationState, FlowType, FlowResponse, detectFlow, getFlowByName, isAdminPhone } from "./flows";
import type { MediaInfo } from "./webhook";
import { db } from "../database";
import { conversationStates, difusionEnvios } from "../database/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../config/logger";
import { lookupRolPorTelefono } from "../services/contacto-donante";

const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutos sin interacción = reset

// ── Cache en memoria (evita leer DB en cada mensaje) ────
const conversationCache = new Map<string, ConversationState>();

// ── Leer estado ─────────────────────────────────────────
async function getConversation(phone: string): Promise<ConversationState | null> {
  // Buscar en cache primero
  const cached = conversationCache.get(phone);
  if (cached) {
    if (Date.now() - cached.lastInteraction.getTime() > TIMEOUT_MS) {
      await endConversation(phone);
      return null;
    }
    return cached;
  }

  // Buscar en DB
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

// ── Crear estado nuevo ──────────────────────────────────
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

// ── Actualizar estado ───────────────────────────────────
async function updateConversation(phone: string, updates: Partial<ConversationState>): Promise<void> {
  const state = conversationCache.get(phone);
  if (!state) return;

  Object.assign(state, updates, { lastInteraction: new Date() });

  await db
    .update(conversationStates)
    .set({
      currentFlow: state.currentFlow,
      step: state.step,
      data: state.data,
      lastInteraction: new Date(),
    })
    .where(eq(conversationStates.phone, phone));
}

// ── Finalizar conversación ──────────────────────────────
async function endConversation(phone: string): Promise<void> {
  conversationCache.delete(phone);
  await db.delete(conversationStates).where(eq(conversationStates.phone, phone));
}

// ── Menú principal donante ───────────────────────────────
function getMenuPrincipal(phone: string): string {
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

// ── Arrancar un flow y devolver su primer mensaje ───────
async function iniciarFlow(
  phone: string,
  flow: FlowType,
): Promise<{ state: ConversationState; reply: string; notify?: FlowResponse["notify"] }> {
  const state = await startConversation(phone, flow);
  const flowHandler = getFlowByName(flow);
  if (!flowHandler) return { state, reply: getMenuPrincipal(phone) };

  const response = await flowHandler.handle(state, "", undefined);
  if (response.data) state.data = { ...state.data, ...response.data };
  if (response.nextStep !== undefined) {
    state.step = response.nextStep;
    await updateConversation(phone, state);
  }
  return { state, reply: response.reply, notify: response.notify };
}

// ── Procesar mensaje entrante ───────────────────────────
export async function handleIncomingMessage(
  phone: string,
  message: string,
  mediaInfo?: MediaInfo,
): Promise<{
  reply: string;
  notify?: FlowResponse["notify"];
  flowData?: { flowName: string; data: Record<string, any> };
}> {
  let state = await getConversation(phone);

  // ── "Hablar con una persona" — escape global ────────────
  if (detectarHablarConPersona(message)) {
    if (state) await endConversation(phone);
    logger.info({ phone, message }, "Donante pidió hablar con persona — derivando");
    return {
      reply:
        "Entendemos que necesitás hablar con alguien. 🙋\n\n" +
        "Tu mensaje fue derivado a nuestro equipo. Una persona se va a comunicar con vos a la brevedad.\n\n" +
        "Mientras tanto, si necesitás algo más podés escribirnos de nuevo.",
      notify: {
        target: "admin",
        message:
          `🙋 *SOLICITUD DE ATENCIÓN HUMANA*\n\n` +
          `📱 Teléfono: ${phone}\n` +
          `💬 Mensaje: "${message}"\n\n` +
          `⚠️ La persona pidió hablar con alguien. Requiere contacto manual.`,
      },
    };
  }

  // ── Sin sesión activa: routing por rol ─────────────────
  if (!state) {
    // 1. Detectar intención de baja (solo para donantes)
    const bajaIntent = detectarIntenciónBaja(message);
    if (bajaIntent) {
      logger.info({ phone, message }, "Donante expresó intención de baja — derivando a atención personalizada");
      return {
        reply:
          "Lamentamos que quieras dejar de participar. 💙\n\n" +
          "Tu mensaje fue recibido y una persona de nuestro equipo se va a comunicar con vos a la brevedad para acompañarte.\n\n" +
          "Si en algún momento querés retomar, siempre vas a poder escribirnos. ¡Gracias por haber donado!",
        notify: {
          target: "admin",
          message:
            `🚨 *ATENCIÓN PERSONALIZADA REQUERIDA*\n\n` +
            `📱 Donante: ${phone}\n` +
            `💬 Mensaje: "${message}"\n` +
            `📋 Motivo detectado: Intención de baja/abandono\n\n` +
            `⚠️ Requiere contacto manual a la brevedad.`,
        },
      };
    }

    // 2. Lookup de rol en DB → routing directo para personal operativo
    const rol = await lookupRolPorTelefono(phone);
    logger.debug({ phone, rol }, "Rol detectado por teléfono");

    if (rol === "chofer") {
      const { reply, notify } = await iniciarFlow(phone, "chofer");
      return { reply, notify };
    }

    if (rol === "peon") {
      const { reply, notify } = await iniciarFlow(phone, "peon");
      return { reply, notify };
    }

    if (rol === "visitadora") {
      const { reply, notify } = await iniciarFlow(phone, "visitadora");
      return { reply, notify };
    }

    if (rol === "admin") {
      const { reply, notify } = await iniciarFlow(phone, "admin");
      return { reply, notify };
    }

    // 3. Para donantes (conocidas o desconocidas): detectar keyword primero
    const detectedFlow = detectFlow(message, phone);
    if (detectedFlow) {
      state = await startConversation(phone, detectedFlow.name);
    } else if (rol === "desconocido") {
      // Número totalmente nuevo → flow de registro
      const { reply, notify } = await iniciarFlow(phone, "nueva_donante");
      return { reply, notify };
    } else {
      // Donante conocida sin keyword
      // Caso especial: si envía "1" y tiene difusion_envios pendiente → confirmar difusión
      if (message.trim() === "1") {
        const phoneSinPlus = phone.startsWith("+") ? phone.slice(1) : phone;
        const phoneConPlus = phone.startsWith("+") ? phone : `+${phone}`;
        const pendiente = await db
          .select({ id: difusionEnvios.id })
          .from(difusionEnvios)
          .where(and(eq(difusionEnvios.confirmado, false), eq(difusionEnvios.telefono, phone)))
          .limit(1)
          .then(async (rows) => {
            if (rows.length > 0) return rows;
            // Intentar con el otro formato de teléfono
            return db
              .select({ id: difusionEnvios.id })
              .from(difusionEnvios)
              .where(and(eq(difusionEnvios.confirmado, false), eq(difusionEnvios.telefono, phone.startsWith("+") ? phoneSinPlus : phoneConPlus)))
              .limit(1);
          });

        if (pendiente.length > 0) {
          await db
            .update(difusionEnvios)
            .set({ confirmado: true, fechaConfirmacion: new Date() })
            .where(eq(difusionEnvios.id, pendiente[0].id));

          logger.info({ phone }, "Confirmación de difusión registrada (sin sesión activa)");
          return {
            reply:
              "✅ *Recepción confirmada*\n\n" +
              "¡Gracias por confirmar! Te esperamos en los días indicados.\n" +
              "Recordá tener el bidón listo antes del horario indicado.\n\n" +
              "Si necesitás algo más, escribinos por acá. ¡Buen día!",
            notify: {
              target: "admin",
              message: `✅ Donante ${phone} confirmó recepción del mensaje de difusión.`,
            },
          };
        }
      }
      // → menú principal
      return { reply: getMenuPrincipal(phone) };
    }
  }

  // ── Menú numérico (donante con sesión en donante_menu) ──
  if (!state.currentFlow) {
    const option = message.trim();
    if (option === "1") state.currentFlow = "reclamo";
    else if (option === "2") state.currentFlow = "aviso";
    else if (option === "3") state.currentFlow = "consulta_general";
    else if (option === "4" && isAdminPhone(phone)) state.currentFlow = "admin";
    else state.currentFlow = "consulta_general";

    state.step = 0;
    await updateConversation(phone, state);

    // Mostrar el sub-menú del flow en vez de pasar el número al handler
    const flowHandler = getFlowByName(state.currentFlow);
    if (flowHandler) {
      const response = await flowHandler.handle(state, "", undefined);
      if (response.data) {
        state.data = { ...state.data, ...response.data };
      }
      if (response.nextStep !== undefined) {
        state.step = response.nextStep;
        await updateConversation(phone, state);
      }
      return { reply: response.reply, notify: response.notify };
    }
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

    // Capturar datos del flujo antes de finalizar
    const flowData = (response.endFlow || response.notify)
      ? { flowName: state.currentFlow!, data: { ...state.data } }
      : undefined;

    if (response.endFlow) {
      const prevFlow = state.currentFlow;
      await endConversation(phone);

      // Si el mensaje original es una keyword de otro flow, re-detectar
      // para que el usuario no tenga que escribirlo dos veces
      const redetected = detectFlow(message, phone);
      if (redetected && redetected.name !== prevFlow) {
        const newState = await startConversation(phone, redetected.name);
        const newResponse = await redetected.handle(newState, "", undefined);
        if (newResponse.data) {
          newState.data = { ...newState.data, ...newResponse.data };
        }
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

      // Reply vacío → mostrar menú principal directamente
      if (!response.reply) {
        return { reply: getMenuPrincipal(phone), notify: response.notify, flowData };
      }
    } else if (response.nextStep !== undefined) {
      state.step = response.nextStep;
      await updateConversation(phone, state);
    }

    logger.debug(
      { phone, flow: state.currentFlow, step: state.step },
      "Mensaje procesado",
    );

    return { reply: response.reply, notify: response.notify, flowData };
  } catch (err) {
    logger.error({ phone, err }, "Error procesando mensaje");
    await endConversation(phone);
    return { reply: "Disculpá, hubo un error. ¿Podés intentar de nuevo?" };
  }
}

// ── Detección de intención de baja ──────────────────────
/**
 * Detecta si una donante está expresando intención de darse de baja
 * o necesita atención personalizada urgente.
 * Se llama ANTES de mostrar el menú principal para interceptar estos casos.
 */
function detectarIntenciónBaja(message: string): boolean {
  const lower = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const FRASES_BAJA = [
    "me quiero bajar",
    "quiero darme de baja",
    "quiero dejar de donar",
    "ya no quiero donar",
    "no quiero donar mas",
    "no voy a donar mas",
    "deme de baja",
    "dame de baja",
    "quiero salir",
    "quiero cancelar",
    "no quiero participar",
    "quiero que me den de baja",
    "dejen de venir",
    "no pasen mas",
    "no pasen por mi casa",
    "ya no participo",
  ];

  return FRASES_BAJA.some((frase) => lower.includes(frase));
}

// ── Detección de "hablar con una persona" ───────────────
// Solo se activa con frases MUY explícitas (no palabras sueltas como "persona")
function detectarHablarConPersona(message: string): boolean {
  const lower = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const FRASES = [
    "hablar con una persona",
    "hablar con alguien",
    "quiero hablar con alguien",
    "necesito hablar con alguien",
    "quiero un humano",
    "necesito atencion humana",
    "quiero hablar con una persona",
  ];

  return FRASES.some((frase) => lower.includes(frase));
}
