import { ConversationState, FlowType, FlowResponse, detectFlow, getFlowByName, isAdminPhone } from "./flows";
import type { MediaInfo } from "./webhook";
import { db } from "../database";
import { conversationStates } from "../database/schema";
import { eq } from "drizzle-orm";
import { logger } from "../config/logger";

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

  if (!state) {
    const detectedFlow = detectFlow(message, phone);

    if (!detectedFlow) {
      // Si es admin, mostrar menú con opción de admin
      if (isAdminPhone(phone)) {
        return {
          reply:
            "¡Hola! 👋 Soy el asistente de GARYCIO.\n\n" +
            "¿Qué querés hacer?\n\n" +
            "*1* - Tengo un reclamo\n" +
            "*2* - Quiero dar un aviso (vacaciones/enfermedad)\n" +
            "*3* - Tengo una consulta\n" +
            "*4* - Panel de administración\n\n" +
            "Respondé con el número o escribí directamente tu consulta.",
        };
      }

      return {
        reply:
          "¡Hola! 👋 Soy el asistente de GARYCIO.\n\n" +
          "¿En qué te puedo ayudar?\n\n" +
          "*1* - Tengo un reclamo\n" +
          "*2* - Quiero dar un aviso (vacaciones/enfermedad)\n" +
          "*3* - Tengo una consulta\n\n" +
          "Respondé con el número o escribí directamente tu consulta.",
      };
    }

    state = await startConversation(phone, detectedFlow.name);
  }

  // Menú numérico (si no se detectó flow por keyword)
  if (!state.currentFlow) {
    const option = message.trim();
    if (option === "1") state.currentFlow = "reclamo";
    else if (option === "2") state.currentFlow = "aviso";
    else if (option === "3") state.currentFlow = "consulta_general";
    else if (option === "4" && isAdminPhone(phone)) state.currentFlow = "admin";
    else state.currentFlow = "consulta_general";

    state.step = 0;
    await updateConversation(phone, state);
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
      await endConversation(phone);
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
