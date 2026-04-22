import { FlowHandler, FlowType } from "./types";
import { contactoInicialFlow } from "./contacto-inicial";
import { reclamoFlow } from "./reclamo";
import { avisoFlow } from "./aviso";
import { nuevaDonanteFlow } from "./nueva-donante";
import { consultaGeneralFlow } from "./consulta-general";
import { choferFlow } from "./chofer";
import { peonFlow } from "./peon";
import { reporteFlow } from "./reporte";
import { adminFlow } from "./admin";
import { visitadoraFlow } from "./visitadora";
import { difusionFlow } from "./difusion";
import { env } from "../../config/env";
import { normalizePhone } from "../../utils/phone";

export { contactoInicialFlow } from "./contacto-inicial";
export { reclamoFlow } from "./reclamo";
export { avisoFlow } from "./aviso";
export { nuevaDonanteFlow } from "./nueva-donante";
export { consultaGeneralFlow } from "./consulta-general";
export { choferFlow } from "./chofer";
export { peonFlow } from "./peon";
export { reporteFlow } from "./reporte";
export { adminFlow } from "./admin";
export { visitadoraFlow } from "./visitadora";
export { difusionFlow } from "./difusion";
export type { ConversationState, FlowType, FlowHandler, FlowResponse, InteractiveMessage } from "./types";

const flows: FlowHandler[] = [
  adminFlow,
  reporteFlow,
  choferFlow,
  peonFlow,
  visitadoraFlow,
  reclamoFlow,
  avisoFlow,
  nuevaDonanteFlow,
  consultaGeneralFlow,
];

/**
 * Verifica si un número de teléfono es un admin autorizado.
 */
export function isAdminPhone(phone: string): boolean {
  const normalized = normalizePhone(phone);
  const adminPhones = (env.ADMIN_PHONES || "").split(",").map((p) => normalizePhone(p.trim())).filter(Boolean);
  return adminPhones.includes(normalized) || normalized === normalizePhone(env.CEO_PHONE || "");
}

/**
 * Detecta el flow basándose en el mensaje.
 * El flow admin requiere verificación de teléfono, se hace en el conversation-manager.
 */
export function detectFlow(message: string, phone?: string): FlowHandler | null {
  const lower = message.toLowerCase();

  for (const flow of flows) {
    if (flow.keyword.some((kw) => lower.includes(kw))) {
      // El flow admin solo se detecta si el phone es admin autorizado
      if (flow.name === "admin") {
        if (!phone || !isAdminPhone(phone)) {
          continue; // Saltear admin, seguir buscando otros flows
        }
      }
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
    admin: adminFlow,
    visitadora: visitadoraFlow,
    difusion: difusionFlow,
  };
  return map[name] || null;
}
