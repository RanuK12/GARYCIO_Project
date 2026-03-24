import { ConversationState, FlowType } from "../src/bot/flows/types";

/**
 * Crea un ConversationState para tests.
 */
export function createState(
    flow: FlowType,
    step = 0,
    data: Record<string, any> = {},
    phone = "5411999999",
): ConversationState {
    return {
        phone,
        currentFlow: flow,
        step,
        data,
        lastInteraction: new Date(),
    };
}
