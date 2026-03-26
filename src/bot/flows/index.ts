import { FlowHandler, FlowType } from "./types";
import { contactoInicialFlow } from "./contacto-inicial";
import { reclamoFlow } from "./reclamo";
import { avisoFlow } from "./aviso";
import { nuevaDonanteFlow } from "./nueva-donante";
import { consultaGeneralFlow } from "./consulta-general";
import { choferFlow } from "./chofer";
import { peonFlow } from "./peon";
import { reporteFlow } from "./reporte";

export { contactoInicialFlow } from "./contacto-inicial";
export { reclamoFlow } from "./reclamo";
export { avisoFlow } from "./aviso";
export { nuevaDonanteFlow } from "./nueva-donante";
export { consultaGeneralFlow } from "./consulta-general";
export { choferFlow } from "./chofer";
export { peonFlow } from "./peon";
export { reporteFlow } from "./reporte";
export type { ConversationState, FlowType, FlowHandler, FlowResponse } from "./types";

const flows: FlowHandler[] = [
  reporteFlow,
  choferFlow,
  peonFlow,
  reclamoFlow,
  avisoFlow,
  nuevaDonanteFlow,
  consultaGeneralFlow,
];

export function detectFlow(message: string): FlowHandler | null {
  const lower = message.toLowerCase();

  for (const flow of flows) {
    if (flow.keyword.some((kw) => lower.includes(kw))) {
      return flow;
    }
  }

  return null;
}

export function getFlowByName(name: FlowType): FlowHandler | null {
  const map: Record<FlowType, FlowHandler> = {
    contacto_inicial: contactoInicialFlow,
    reclamo: reclamoFlow,
    aviso: avisoFlow,
    consulta_general: consultaGeneralFlow,
    nueva_donante: nuevaDonanteFlow,
    chofer: choferFlow,
    peon: peonFlow,
    reporte: reporteFlow,
  };
  return map[name] || null;
}
