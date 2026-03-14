import { ConversationState, FlowType, detectFlow, getFlowByName } from "./flows";
import { logger } from "../config/logger";

const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutos sin interacción = reset

const conversations = new Map<string, ConversationState>();

export function getConversation(phone: string): ConversationState | null {
  const state = conversations.get(phone);

  if (state && Date.now() - state.lastInteraction.getTime() > TIMEOUT_MS) {
    conversations.delete(phone);
    return null;
  }

  return state || null;
}

export function startConversation(phone: string, flow: FlowType): ConversationState {
  const state: ConversationState = {
    phone,
    currentFlow: flow,
    step: 0,
    data: {},
    lastInteraction: new Date(),
  };
  conversations.set(phone, state);
  return state;
}

export function updateConversation(phone: string, updates: Partial<ConversationState>): void {
  const state = conversations.get(phone);
  if (!state) return;

  Object.assign(state, updates, { lastInteraction: new Date() });
}

export function endConversation(phone: string): void {
  conversations.delete(phone);
}

export async function handleIncomingMessage(
  phone: string,
  message: string,
): Promise<string> {
  let state = getConversation(phone);

  if (!state) {
    const detectedFlow = detectFlow(message);

    if (!detectedFlow) {
      return (
        "¡Hola! 👋 Soy el asistente de GARYCIO.\n\n" +
        "¿En qué te puedo ayudar?\n\n" +
        "*1* - Tengo un reclamo\n" +
        "*2* - Quiero dar un aviso (vacaciones/enfermedad)\n" +
        "*3* - Tengo una consulta\n\n" +
        "Respondé con el número o escribí directamente tu consulta."
      );
    }

    state = startConversation(phone, detectedFlow.name);
  }

  if (!state.currentFlow) {
    const option = message.trim();
    if (option === "1") state.currentFlow = "reclamo";
    else if (option === "2") state.currentFlow = "aviso";
    else state.currentFlow = "consulta_general";

    state.step = 0;
    updateConversation(phone, state);
  }

  const flowHandler = getFlowByName(state.currentFlow);
  if (!flowHandler) {
    endConversation(phone);
    return "Hubo un error interno. Por favor escribí de nuevo.";
  }

  try {
    const response = await flowHandler.handle(state, message);

    if (response.data) {
      state.data = { ...state.data, ...response.data };
    }

    if (response.endFlow) {
      endConversation(phone);
    } else if (response.nextStep !== undefined) {
      state.step = response.nextStep;
      updateConversation(phone, state);
    }

    logger.debug(
      { phone, flow: state.currentFlow, step: state.step },
      "Mensaje procesado",
    );

    return response.reply;
  } catch (err) {
    logger.error({ phone, err }, "Error procesando mensaje");
    endConversation(phone);
    return "Disculpá, hubo un error. ¿Podés intentar de nuevo?";
  }
}
