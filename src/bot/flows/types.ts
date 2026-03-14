export interface ConversationState {
  phone: string;
  currentFlow: FlowType | null;
  step: number;
  data: Record<string, any>;
  lastInteraction: Date;
}

export type FlowType =
  | "contacto_inicial"
  | "reclamo"
  | "aviso"
  | "consulta_general"
  | "nueva_donante"
  | "chofer"
  | "reporte";

export interface FlowHandler {
  name: FlowType;
  keyword: string[];
  handle(state: ConversationState, message: string): Promise<FlowResponse>;
}

export interface FlowResponse {
  reply: string;
  nextStep?: number;
  endFlow?: boolean;
  data?: Record<string, any>;
  notify?: {
    target: "chofer" | "visitadora" | "admin";
    targetId?: number;
    message: string;
  };
}
