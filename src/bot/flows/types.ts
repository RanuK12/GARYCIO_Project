import type { MediaInfo as _MediaInfo } from "../webhook";
export type MediaInfo = _MediaInfo;

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
  | "peon"
  | "reporte"
  | "admin"
  | "visitadora"
  | "difusion";

export interface FlowHandler {
  name: FlowType;
  keyword: string[];
  handle(state: ConversationState, message: string, mediaInfo?: MediaInfo): Promise<FlowResponse>;
}

export type InteractiveMessage =
  | {
      type: "buttons";
      body: string;
      buttons: Array<{ id: string; title: string }>;
    }
  | {
      type: "list";
      body: string;
      buttonText: string;
      sections: Array<{
        title?: string;
        rows: Array<{ id: string; title: string; description?: string }>;
      }>;
    };

export interface FlowResponse {
  reply: string;
  interactive?: InteractiveMessage;
  nextStep?: number;
  endFlow?: boolean;
  data?: Record<string, any>;
  notify?: {
    target: "chofer" | "visitadora" | "admin" | "peon";
    targetId?: number;
    message: string;
  };
}
