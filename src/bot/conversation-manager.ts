import { ConversationState, FlowType, FlowResponse, InteractiveMessage, detectFlow, getFlowByName, isAdminPhone } from "./flows";
import type { MediaInfo } from "./webhook";
import { db } from "../database";
import { conversationStates, difusionEnvios, mensajesLog } from "../database/schema";
import { eq, and, desc } from "drizzle-orm";
import { logger } from "../config/logger";
import { lookupRolPorTelefono } from "../services/contacto-donante";
import { procesarMensajeIA, type Intencion, type RespuestaIA } from "../services/clasificador-ia";

const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutos sin interacción = reset

// ── Cache en memoria (evita leer DB en cada mensaje) ────
const conversationCache = new Map<string, ConversationState>();
const CACHE_MAX_SIZE = 500; // Cap para evitar memory leak con muchos usuarios simultáneos

// ── Leer estado ─────────────────────────────────────────
// Info sobre sesiones expiradas para poder dar contexto al usuario
let lastExpiredFlow: Map<string, { flow: string; step: number; ts: number }> = new Map();

// Limpieza periódica de Maps de sesión
setInterval(() => {
  const now = Date.now();
  const cutoff7d = now - 7 * 24 * 60 * 60 * 1000;
  let cleaned = 0;
  for (const [phone, info] of lastExpiredFlow) {
    if (info.ts < cutoff7d) { lastExpiredFlow.delete(phone); cleaned++; }
  }
  // Si el cache creció demasiado, eliminar las entradas más viejas
  if (conversationCache.size > CACHE_MAX_SIZE) {
    const sorted = [...conversationCache.entries()]
      .sort((a, b) => a[1].lastInteraction.getTime() - b[1].lastInteraction.getTime());
    const toRemove = sorted.slice(0, conversationCache.size - CACHE_MAX_SIZE);
    for (const [phone] of toRemove) { conversationCache.delete(phone); cleaned++; }
  }
  if (cleaned > 0) logger.debug({ cleaned }, "Limpieza de cache de conversaciones completada");
}, 6 * 60 * 60 * 1000); // Cada 6 horas

async function getConversation(phone: string): Promise<ConversationState | null> {
  // Buscar en cache primero
  const cached = conversationCache.get(phone);
  if (cached) {
    if (Date.now() - cached.lastInteraction.getTime() > TIMEOUT_MS) {
      // Guardar info del flow expirado para contexto
      if (cached.currentFlow) {
        lastExpiredFlow.set(phone, { flow: cached.currentFlow, step: cached.step, ts: Date.now() });
      }
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
    if (state.currentFlow) {
      lastExpiredFlow.set(phone, { flow: state.currentFlow, step: state.step, ts: Date.now() });
    }
    await endConversation(phone);
    return null;
  }

  conversationCache.set(phone, state);
  return state;
}

/** Recuperar info de sesión expirada (para dar contexto al reanudar) */
export function getExpiredFlowInfo(phone: string): { flow: string; step: number } | null {
  const info = lastExpiredFlow.get(phone);
  if (info) {
    lastExpiredFlow.delete(phone); // Consumir
    return info;
  }
  return null;
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

// ── Menú principal donante (interactivo con botones) ────
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

// ── Menú principal como texto (fallback) ────────────────
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

// ── Arrancar un flow y devolver su primer mensaje ───────
async function iniciarFlow(
  phone: string,
  flow: FlowType,
): Promise<{ state: ConversationState; reply: string; interactive?: InteractiveMessage; notify?: FlowResponse["notify"] }> {
  const state = await startConversation(phone, flow);
  const flowHandler = getFlowByName(flow);
  if (!flowHandler) {
    const menu = getMenuPrincipalInteractive(phone);
    return { state, reply: menu.reply, interactive: menu.interactive };
  }

  const response = await flowHandler.handle(state, "", undefined);
  if (response.data) state.data = { ...state.data, ...response.data };
  if (response.nextStep !== undefined) {
    state.step = response.nextStep;
    await updateConversation(phone, state);
  }
  return { state, reply: response.reply, interactive: response.interactive, notify: response.notify };
}

// ── Procesar mensaje entrante ───────────────────────────
export async function handleIncomingMessage(
  phone: string,
  message: string,
  mediaInfo?: MediaInfo,
): Promise<{
  reply: string;
  interactive?: InteractiveMessage;
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
      // Menú de chofer deshabilitado hasta nueva orden
      return {
        reply:
          "Hola 👋 El sistema para choferes todavía no está habilitado.\n\n" +
          "Cuando esté listo te avisamos. ¡Gracias!",
      };
    }

    if (rol === "peon") {
      // Menú de peón deshabilitado hasta nueva orden
      return {
        reply:
          "Hola 👋 El sistema para el personal de recolección todavía no está habilitado.\n\n" +
          "Cuando esté listo te avisamos. ¡Gracias!",
      };
    }

    if (rol === "visitadora") {
      const { reply, interactive, notify } = await iniciarFlow(phone, "visitadora");
      return { reply, interactive, notify };
    }

    if (rol === "admin") {
      const { reply, interactive, notify } = await iniciarFlow(phone, "admin");
      return { reply, interactive, notify };
    }

    // 3. Para donantes (conocidas o desconocidas): detectar keyword primero
    const detectedFlow = detectFlow(message, phone);
    if (detectedFlow) {
      state = await startConversation(phone, detectedFlow.name);
    } else {
      // Caso especial prioritario: confirmar difusión
      // Acepta: "1", ",1", "1 recibido", ",1 Recibido el mensaje 👍", "Confirmar recepción", etc.
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

          logger.info({ phone }, "Confirmación de difusión registrada (sin sesión activa)");
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

      if (rol === "desconocido") {
        const { reply, notify } = await iniciarFlow(phone, "nueva_donante");
        return { reply, notify };
      }

      // ── Asistente IA: responde directamente con contexto de la donante ──
      return await procesarConIA(phone, message);
    }
  }

  // ── Menú numérico o por botón (donante con sesión en donante_menu) ──
  if (!state.currentFlow) {
    const option = message.trim().toLowerCase();
    if (option === "1" || option === "tengo un reclamo") state.currentFlow = "reclamo";
    else if (option === "2" || option === "dar un aviso") state.currentFlow = "aviso";
    else if (option === "3" || option === "otra consulta") state.currentFlow = "consulta_general";
    else if ((option === "4" || option === "panel de admin") && isAdminPhone(phone)) state.currentFlow = "admin";
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
      return { reply: response.reply, interactive: response.interactive, notify: response.notify };
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
        const menu = getMenuPrincipalInteractive(phone);
        return { reply: menu.reply, interactive: menu.interactive, notify: response.notify, flowData };
      }
    } else if (response.nextStep !== undefined) {
      state.step = response.nextStep;
      await updateConversation(phone, state);
    }

    logger.debug(
      { phone, flow: state.currentFlow, step: state.step },
      "Mensaje procesado",
    );

    return { reply: response.reply, interactive: response.interactive, notify: response.notify, flowData };
  } catch (err) {
    logger.error({ phone, err }, "Error procesando mensaje");
    await endConversation(phone);
    return { reply: "Disculpá, hubo un error. ¿Podés intentar de nuevo?" };
  }
}

// ── Detección de confirmación de difusión (flexible) ─────
/**
 * Acepta múltiples formas en que las donantes confirman la difusión:
 * "1", ",1", ".1", "1.", "1 recibido", ",1 Recibido el mensaje 👍",
 * "recibido", "confirmo", "Confirmar recepción", "si recibido", etc.
 */
export function esConfirmacionDifusion(message: string): boolean {
  const clean = message.trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Contiene un "1" suelto (puede tener coma/punto antes/después)
  if (/[,.\s]*1[,.\s]*/g.test(clean) && clean.length < 60) {
    // Verificar que no sea parte de otra intención (ej: "1 reclamo")
    const sinPuntuacion = clean.replace(/[^a-z0-9\s]/g, "").trim();
    if (sinPuntuacion === "1") return true;
    if (/^1\s+(recibido|recibí|recibi|ok|si|listo|gracias|dale|bueno|bien|confirmado|confirmo|mensaje|el mensaje|recibido el mensaje)/.test(sinPuntuacion)) return true;
  }

  // Frases directas de confirmación
  const confirmaciones = [
    "confirmar recepcion", "confirmar recepción", "confirmo recepcion",
    "recibido", "recibi", "recibí", "recibido el mensaje",
    "si recibido", "si recibi", "si recibí",
    "confirmado", "confirmo", "entendido",
    "ok recibido", "dale recibido", "si lo recibi",
  ];
  return confirmaciones.some((c) => clean.includes(c));
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

// ── Procesar mensaje con IA conversacional ──────────────
async function procesarConIA(
  phone: string,
  message: string,
): Promise<{
  reply: string;
  interactive?: InteractiveMessage;
  notify?: FlowResponse["notify"];
  flowData?: { flowName: string; data: Record<string, any> };
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

  const resultado = await procesarMensajeIA(phone, message, historial);
  logger.info({
    phone,
    intencion: resultado.intencion,
    urgencia: resultado.urgencia,
    mensaje: message.slice(0, 60),
  }, "Mensaje procesado por asistente IA");

  // Construir notificaciones según la intención
  let notify: FlowResponse["notify"] | undefined;
  let flowData: { flowName: string; data: Record<string, any> } | undefined;

  switch (resultado.intencion) {
    case "reclamo":
      notify = {
        target: resultado.urgencia === "alta" ? "admin" : "chofer",
        message:
          `📋 *Nuevo reclamo${resultado.urgencia === "alta" ? " URGENTE" : ""}*\n\n` +
          `📱 Donante: ${phone}\n` +
          `Tipo: ${resultado.datosExtraidos?.tipoReclamo || "general"}\n` +
          `Urgencia: ${resultado.urgencia || "media"}\n` +
          `💬 Mensaje: "${message}"\n` +
          `${resultado.datosExtraidos?.descripcion ? `Detalle: ${resultado.datosExtraidos.descripcion}` : ""}\n\n` +
          `_Reclamo guardado automáticamente por IA_`,
      };
      flowData = {
        flowName: "reclamo",
        data: {
          tipoReclamo: resultado.datosExtraidos?.tipoReclamo || "otro",
          detalleReclamo: resultado.datosExtraidos?.descripcion || message,
          urgencia: resultado.urgencia,
          procesadoPorIA: true,
        },
      };
      break;

    case "aviso":
      notify = {
        target: "chofer",
        message:
          `📢 *Aviso de donante*\n\n` +
          `📱 Donante: ${phone}\n` +
          `Tipo: ${resultado.datosExtraidos?.tipoAviso || "general"}\n` +
          `💬 Mensaje: "${message}"\n` +
          `${resultado.datosExtraidos?.fechaFin ? `Vuelta estimada: ${resultado.datosExtraidos.fechaFin}` : ""}\n\n` +
          `_Aviso registrado automáticamente por IA_`,
      };
      break;

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

    case "consulta":
      // Consultas que la IA no pudo resolver → notificar admin
      if (resultado.respuesta.includes("te respondemos") || resultado.respuesta.includes("voy a consultar")) {
        notify = {
          target: "admin",
          message:
            `❓ *Consulta de donante*\n\n` +
            `📱 Donante: ${phone}\n` +
            `💬 "${message}"\n\n` +
            `La IA no pudo resolver esta consulta. Requiere respuesta manual.`,
        };
      }
      break;

    case "confirmar_difusion":
      notify = {
        target: "admin",
        message: `✅ Donante ${phone} confirmó recepción del mensaje de difusión.`,
      };
      break;
  }

  // Si la IA devolvió respuesta vacía (agradecimiento/irrelevante), no responder
  if (!resultado.respuesta) {
    return { reply: "", notify };
  }

  // Para saludos y menu_opcion, mostrar menú interactivo junto con la respuesta de la IA
  if (resultado.intencion === "saludo" || resultado.intencion === "menu_opcion") {
    const menu = getMenuPrincipalInteractive(phone);
    return {
      reply: resultado.respuesta,
      interactive: menu.interactive,
      notify,
    };
  }

  return {
    reply: resultado.respuesta,
    notify,
    flowData,
  };
}
