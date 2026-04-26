/**
 * Message Handler — Failsafe + Human Escalation + Timeouts
 *
 * Flujo:
 * 1. Deduplicación por messageId (evita loops por reintentos de webhook)
 * 2. Verificar escalación humana activa
 * 3. Adquirir lock por usuario
 * 4. Anti-loop: cooldown basado en messageId (no en respuesta)
 * 5. Procesar mensaje con timeout global (25s, antes del límite de Meta de ~20-30s)
 * 6. try/catch global: cualquier error no capturado → escalación humana
 * 7. Enviar respuesta
 * 8. Notificaciones
 * 9. Persistir flow data
 */

import { handleIncomingMessage, esConfirmacionDifusion } from "./conversation-manager";
import { sendMessage, markAsRead, sendInteractiveButtons, sendInteractiveList } from "./client";
import { withUserLock } from "./queue";
import { db } from "../database";
import {
  donantes,
  choferes,
  visitadoras,
  zonaChoferes,
  reclamos,
  mensajesLog,
  reportesBaja,
} from "../database/schema";
import { eq, and, isNotNull, desc, ilike } from "drizzle-orm";
import { env } from "../config/env";
import { logger } from "../config/logger";
import type { FlowResponse } from "./flows";
import { isAdminPhone } from "./flows";
import { addToDeadLetterQueue } from "../services/dead-letter-queue";
import { guardarReclamo, guardarIncidente } from "../services/reportes-ceo";
import { procesarRespuestaEncuesta } from "../services/encuesta-regalo";
import { registrarContactoDonante } from "../services/contacto-donante";
import { isDuplicate, markAsProcessed } from "../services/dedup";
import { escalateToHuman } from "../services/human-escalation";
import { isPausedFor, getPauseMessage, isWhitelisted } from "../services/bot-control";
import { isBotPaused } from "../services/bot-takeover";
import { normalizePhone } from "../utils/phone";
import type { MediaInfo } from "./webhook";

// ── Timeouts y límites ──
const PROCESS_TIMEOUT_MS = 25_000; // 25s máximo por mensaje (Meta timeout ≈ 20s)
const COOLDOWN_MS = 10 * 1000; // 10s entre respuestas al mismo número (antes 30s, silenciaba a donantes legítimas)
const MAX_INTERACTIONS_PER_SESSION = 12; // Máximo de respuestas en ventana de 30 min

const lastResponseTime = new Map<string, number>();
const interactionCount = new Map<string, { count: number; windowStart: number }>();
const incomingCount = new Map<string, { count: number; windowStart: number }>();
const MAX_INCOMING_PER_WINDOW = 20; // Máximo de mensajes entrantes en 30 min

// Limpieza periódica de Maps anti-spam
setInterval(() => {
  const now = Date.now();
  const cutoff24h = now - 24 * 60 * 60 * 1000;
  const cutoff30m = now - 30 * 60 * 1000;
  let cleaned = 0;
  for (const [phone, ts] of lastResponseTime) {
    if (ts < cutoff24h) { lastResponseTime.delete(phone); cleaned++; }
  }
  for (const [phone, data] of interactionCount) {
    if (data.windowStart < cutoff30m) { interactionCount.delete(phone); cleaned++; }
  }
  for (const [phone, data] of incomingCount) {
    if (data.windowStart < cutoff30m) { incomingCount.delete(phone); cleaned++; }
  }
  if (cleaned > 0) logger.debug({ cleaned }, "Limpieza anti-spam completada");
}, 60 * 60 * 1000);

// Mensajes que no requieren respuesta
const MENSAJES_IGNORADOS = new Set([
  "ok", "okey", "oki", "dale", "bueno", "bien", "listo", "perfecto",
  "gracias", "gracia", "muchas gracias", "mil gracias",
  "jaja", "jajaja", "jajajaja", "jeje", "jejeje",
  "si", "sí", "no", "ya",
  "👍", "👌", "🙏", "❤️", "😊", "😂", "🤣", "👋", "✅", "🙌",
]);

// Patrones de spam de redes sociales (TikTok, YouTube, Instagram, etc.)
const SPAM_REDES_SOCIALES = [
  /tiktok\.com/i,
  /vm\.tiktok\.com/i,
  /youtube\.com\/watch/i,
  /youtu\.be/i,
  /instagram\.com\/reel/i,
  /fb\.watch/i,
  /facebook\.com\/watch/i,
  /x\.com\/\w+\/status/i,
  /twitter\.com\/\w+\/status/i,
];

function esSpamRedesSociales(text: string): boolean {
  return SPAM_REDES_SOCIALES.some((pat) => pat.test(text));
}

function esMensajeIgnorado(text: string): boolean {
  const clean = text.trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Ignorar mensajes vacíos o solo espacios/puntuación
  if (!clean || /^[\s\p{P}]*$/u.test(clean)) return true;
  if (MENSAJES_IGNORADOS.has(clean)) return true;
  // Ignorar secuencias de emojis (cualquier cantidad razonable, hasta 20)
  if (/^[\p{Emoji_Presentation}\p{Emoji}\uFE0F\u200D\s]{1,20}$/u.test(clean) && /\p{Emoji}/u.test(clean)) return true;
  return false;
}

function checkCooldown(phone: string): boolean {
  const last = lastResponseTime.get(phone);
  if (!last) return false;
  return Date.now() - last < COOLDOWN_MS;
}

function checkMaxInteractions(phone: string): boolean {
  const data = interactionCount.get(phone);
  if (!data) return false;
  if (Date.now() - data.windowStart > 30 * 60 * 1000) {
    interactionCount.delete(phone);
    return false;
  }
  return data.count >= MAX_INTERACTIONS_PER_SESSION;
}

function recordInteraction(phone: string): void {
  lastResponseTime.set(phone, Date.now());
  const data = interactionCount.get(phone);
  if (!data || Date.now() - data.windowStart > 30 * 60 * 1000) {
    interactionCount.set(phone, { count: 1, windowStart: Date.now() });
  } else {
    data.count++;
  }
}

function esEscalacion(result: { notify?: FlowResponse["notify"]; flowData?: { flowName: string } }): boolean {
  if (result.flowData?.flowName === "reclamo") return true;
  if (result.notify?.target === "admin") return true;
  return false;
}

// ── Wrapper con timeout ──
async function withTimeout<T>(promise: Promise<T>, ms: number, context: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${context}`)), ms),
    ),
  ]);
}

/**
 * Procesa un mensaje entrante de principio a fin.
 */
export async function processIncomingMessage(
  rawPhone: string,
  text: string,
  messageId?: string,
  mediaInfo?: MediaInfo,
): Promise<void> {
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    logger.warn({ rawPhone }, "Teléfono inválido después de normalizar");
    return;
  }

  // ── 0a. Modo PAUSA: responder mantenimiento a no-admins ──
  if (isPausedFor(phone)) {
    logger.warn({ phone }, "Bot en PAUSA — mensaje rechazado");
    await sendMessage(phone, getPauseMessage()).catch(() => {});
    if (messageId) markAsRead(messageId).catch(() => {});
    return;
  }

  // ── P0.10: si un humano (agente en 360 Inbox) intervino recientemente,
  //    el bot se calla por 30 min para no pisar la conversación.
  //    Detectado pasivamente vía webhook statuses (messageId desconocido).
  if (isBotPaused(phone)) {
    logger.info(
      { phone, text: text.slice(0, 60) },
      "Bot pausado por intervención humana — ignorando inbound",
    );
    if (messageId) markAsRead(messageId).catch(() => {});
    return;
  }

  // ── 0b. Whitelist progresiva ──
  const whitelisted = await isWhitelisted(phone);
  if (!whitelisted) {
    logger.warn({ phone }, "Número fuera de whitelist progresiva — ignorado");
    if (messageId) markAsRead(messageId).catch(() => {});
    return;
  }

  // ── 0c. Anti-spam: rechazar mensajes entrantes excesivos ANTES de procesar ──
  // También descartar enlaces de redes sociales (TikTok, YouTube, etc.)
  if (!isAdminPhone(phone)) {
    if (text && esSpamRedesSociales(text)) {
      logger.info({ phone, text: text.slice(0, 60) }, "Spam de redes sociales detectado — mensaje ignorado");
      if (messageId) markAsRead(messageId).catch(() => {});
      return;
    }

    const incData = incomingCount.get(phone);
    if (incData && Date.now() - incData.windowStart < 30 * 60 * 1000) {
      incData.count++;
      if (incData.count > MAX_INCOMING_PER_WINDOW) {
        logger.warn({ phone, count: incData.count }, "Spam detectado — mensaje ignorado");
        if (messageId) markAsRead(messageId).catch(() => {});
        return;
      }
    } else {
      incomingCount.set(phone, { count: 1, windowStart: Date.now() });
    }
  }

  // ── 1. Deduplicación por messageId ──
  if (messageId) {
    const dup = await isDuplicate(messageId);
    if (dup) {
      logger.warn({ phone, messageId, text: text.slice(0, 60) }, "Mensaje duplicado ignorado");
      markAsRead(messageId).catch(() => {});
      return;
    }
    await markAsProcessed(messageId, phone, "ok");
  }

  await withUserLock(phone, async () => {
    // Log del mensaje entrante
    logMessage(phone, "entrante", text, true).catch(() => {});

    // Auto-registrar contacto
    registrarContactoDonante(phone, text).catch((err) => {
      logger.error({ phone, err }, "Error registrando contacto de donante");
    });

    const esAdmin = isAdminPhone(phone);
    const esConfirmacion = esConfirmacionDifusion(text);

    // Anti-loop para no-admins
    if (!esAdmin) {
      if (!esConfirmacion && esMensajeIgnorado(text)) {
        logger.debug({ phone, text }, "Mensaje ignorado (trivial)");
        if (messageId) markAsRead(messageId).catch(() => {});
        return;
      }

      if (checkCooldown(phone)) {
        logger.info({ phone, esConfirmacion }, "Cooldown activo (10s) — ignorando mensaje");
        if (messageId) markAsRead(messageId).catch(() => {});
        return;
      }

      if (checkMaxInteractions(phone)) {
        logger.warn({ phone }, "Max interactions alcanzado — notificando admin");
        if (messageId) markAsRead(messageId).catch(() => {});
        await sendMessage(
          env.CEO_PHONE,
          `⚠️ *Donante con muchos mensajes*\n📱 ${phone}\n💬 Último: "${text.slice(0, 100)}"\n\nSuperó el límite de ${MAX_INTERACTIONS_PER_SESSION} interacciones. Posible loop o necesita atención manual.`,
        ).catch(() => {});
        return;
      }
    }

    // Verificar si es respuesta a encuesta
    const esEncuesta = await procesarRespuestaEncuesta(phone, text).catch(() => false);
    if (esEncuesta) {
      await sendMessage(phone, "✅ ¡Gracias por tu respuesta! Fue registrada correctamente.").catch(() => {});
      logMessage(phone, "saliente", "Respuesta de encuesta registrada", true).catch(() => {});
      recordInteraction(phone);
      if (messageId) markAsRead(messageId).catch(() => {});
      return;
    }

    // ── 2. Procesar con timeout global + try/catch ──
    let result: Awaited<ReturnType<typeof handleIncomingMessage>>;
    try {
      result = await withTimeout(
        handleIncomingMessage(phone, text, mediaInfo),
        PROCESS_TIMEOUT_MS,
        `procesamiento mensaje ${phone}`,
      );
    } catch (err) {
      logger.error({ phone, err, text: text.slice(0, 100) }, "Error o timeout procesando mensaje");

      // Failsafe: escalar a humano (envía mensaje al usuario y notifica al CEO)
      await escalateToHuman(phone, "system_error", {
        lastMessage: text,
        error: (err as Error).message,
      });

      // Notificar al admin del error por separado (solo CEO, no duplicar mensaje al usuario)
      await sendMessage(
        env.CEO_PHONE,
        `🚨 *ERROR CRÍTICO EN BOT*\n\n📱 ${phone}\n💬 "${text.slice(0, 100)}"\n❌ Error: ${(err as Error).message}\n\nEl usuario fue escalado a humano automáticamente.`,
      ).catch(() => {});

      if (messageId) markAsRead(messageId).catch(() => {});
      return;
    }

    // Si no hay respuesta
    // Nota: string vacío "" es diferente de undefined/null. Un template con "" puede
    // ser un bug, pero NO es "sin respuesta". Solo ignoramos si es realmente undefined/null
    // y no hay interactive.
    const hasReply = result.reply !== undefined && result.reply !== null;
    if (!hasReply && !result.interactive) {
      logger.debug({ phone }, "Sin respuesta (ignorado por clasificador)");
      if (messageId) markAsRead(messageId).catch(() => {});
      return;
    }

    // Fallback de cortesía: si el reply es string vacío pero hay una intención,
    // enviar al menos un mensaje amable para no dejar a la donante en silencio.
    if (hasReply && result.reply.trim() === "") {
      result.reply = "Recibimos tu mensaje. Te respondemos a la brevedad. 😊";
    }

    // Si fue escalado a humano, enviar reply y notificaciones pero NO registrar interacción
    if (result.needsHuman) {
      // Enviar reply contextual al usuario (ej: "Entendemos que necesitás hablar con alguien...")
      try {
        if (result.interactive) {
          if (result.reply) await sendMessage(phone, result.reply);
          const iv = result.interactive;
          if (iv.type === "buttons") {
            await sendInteractiveButtons(phone, iv.body, iv.buttons);
          } else {
            await sendInteractiveList(phone, iv.body, iv.buttonText, iv.sections);
          }
        } else if (result.reply) {
          await sendMessage(phone, result.reply);
        }
      } catch (err) {
        logger.error({ phone, err }, "Error enviando reply de escalación");
      }

      // Notificaciones a CEO/chofer (reclamos, bajas, hablar_persona)
      if (result.notify) {
        await processNotification(phone, result.notify);
      }

      // Persistir datos de flujo (reclamos, incidentes)
      if (result.flowData) {
        await saveFlowData(phone, result.flowData).catch((err) => {
          logger.error({ phone, err }, "Error guardando datos de flujo en escalación");
        });
      }

      if (messageId) markAsRead(messageId).catch(() => {});
      return;
    }

    // ── 3. Enviar respuesta ──
    try {
      if (result.interactive) {
        if (result.reply) {
          await sendMessage(phone, result.reply);
        }
        const iv = result.interactive;
        if (iv.type === "buttons") {
          await sendInteractiveButtons(phone, iv.body, iv.buttons);
        } else {
          await sendInteractiveList(phone, iv.body, iv.buttonText, iv.sections);
        }
        logMessage(phone, "saliente", result.interactive.body, true).catch(() => {});
      } else {
        await sendMessage(phone, result.reply);
        logMessage(phone, "saliente", result.reply, true).catch(() => {});
      }
    } catch (err) {
      logger.error({ phone, err }, "Error al enviar respuesta");
      const contenido = result.interactive?.body || result.reply;
      logMessage(phone, "saliente", contenido, false).catch(() => {});
      addToDeadLetterQueue({
        telefono: phone,
        tipo: "texto",
        contenido,
        errorMessage: (err as Error).message,
      }).catch(() => {});
    }

    // Registrar interacción para cooldown
    recordInteraction(phone);

    // Marcar como leído (excepto escalaciones)
    if (messageId) {
      if (esEscalacion(result)) {
        logger.info({ phone }, "Reclamo/escalación — NO se marca como leído");
      } else {
        markAsRead(messageId).catch(() => {});
      }
    }

    // Notificaciones
    if (result.notify) {
      await processNotification(phone, result.notify);
    }

    // Persistir datos de flujo
    if (result.flowData) {
      await saveFlowData(phone, result.flowData).catch((err) => {
        logger.error({ phone, err }, "Error guardando datos de flujo");
      });
    }
  });
}

// ── Notificaciones ──
async function processNotification(
  senderPhone: string,
  notify: NonNullable<FlowResponse["notify"]>,
): Promise<void> {
  try {
    switch (notify.target) {
      case "admin":
        await sendMessage(env.CEO_PHONE, notify.message);
        break;
      case "chofer": {
        const chofer = await findChoferForDonante(senderPhone);
        if (chofer) {
          await sendMessage(chofer.telefono, notify.message);
          logger.info({ donante: senderPhone, chofer: chofer.nombre }, "Notificación enviada al chofer");
        } else {
          await sendMessage(env.CEO_PHONE, `⚠️ Sin chofer asignado para ${senderPhone}\n\n${notify.message}`);
        }
        break;
      }
      case "visitadora": {
        const visitadora = await findVisitadoraForDonante(senderPhone);
        if (visitadora) {
          await sendMessage(visitadora.telefono, notify.message);
          logger.info({ donante: senderPhone, visitadora: visitadora.nombre }, "Notificación enviada a visitadora");
        } else {
          await sendMessage(env.CEO_PHONE, `⚠️ Sin visitadora asignada para ${senderPhone}\n\n${notify.message}`);
        }
        break;
      }
    }
  } catch (err) {
    logger.error({ senderPhone, target: notify.target, err }, "Error procesando notificación");
  }
}

async function findChoferForDonante(phone: string): Promise<{ nombre: string; telefono: string } | null> {
  const donanteResult = await db.select({ zonaId: donantes.zonaId }).from(donantes).where(eq(donantes.telefono, phone)).limit(1);
  if (donanteResult.length === 0 || !donanteResult[0].zonaId) return null;

  const choferResult = await db
    .select({ nombre: choferes.nombre, telefono: choferes.telefono })
    .from(zonaChoferes)
    .innerJoin(choferes, eq(zonaChoferes.choferId, choferes.id))
    .where(and(eq(zonaChoferes.zonaId, donanteResult[0].zonaId), eq(zonaChoferes.activo, true)))
    .limit(1);

  return choferResult.length > 0 ? choferResult[0] : null;
}

async function findVisitadoraForDonante(phone: string): Promise<{ nombre: string; telefono: string } | null> {
  const donanteResult = await db.select({ id: donantes.id, zonaId: donantes.zonaId }).from(donantes).where(eq(donantes.telefono, phone)).limit(1);
  if (donanteResult.length === 0) return null;

  const reclamoResult = await db
    .select({ visitadoraId: reclamos.visitadoraId })
    .from(reclamos)
    .where(and(eq(reclamos.donanteId, donanteResult[0].id), isNotNull(reclamos.visitadoraId)))
    .orderBy(desc(reclamos.fechaCreacion))
    .limit(1);

  const visitadoraId = reclamoResult.length > 0 ? reclamoResult[0].visitadoraId : null;

  if (visitadoraId) {
    const result = await db
      .select({ nombre: visitadoras.nombre, telefono: visitadoras.telefono })
      .from(visitadoras)
      .where(and(eq(visitadoras.id, visitadoraId), eq(visitadoras.activa, true)))
      .limit(1);
    if (result.length > 0) return result[0];
  }

  const anyVisitadora = await db
    .select({ nombre: visitadoras.nombre, telefono: visitadoras.telefono })
    .from(visitadoras)
    .where(eq(visitadoras.activa, true))
    .limit(1);

  return anyVisitadora.length > 0 ? anyVisitadora[0] : null;
}

// ── Persistencia de datos de flujo ──
async function saveFlowData(
  phone: string,
  flowData: { flowName: string; data: Record<string, any> },
): Promise<void> {
  const { flowName, data } = flowData;

  if (flowName === "reclamo" && data.tipoReclamo) {
    await guardarReclamo({
      donantePhone: phone,
      tipo: data.tipoReclamo,
      descripcion: data.detalleReclamo || null,
    });
  }

  if (flowName === "chofer" && data.incidenteReportado) {
    await guardarIncidente({
      choferId: data.choferId || 0,
      tipo: data.tipoIncidente || "otro",
      descripcion: data.descripcionIncidente || "Sin descripción",
      gravedad: data.gravedadIncidente || "media",
    });
  }

  if (flowName === "chofer" && data.bajaAutoContactar && data.bajaDonante) {
    await contactarDonanteParaBaja(data.bajaDonante, data.bajaMotivo, data.codigoChofer);
  }
}

// ── Logging ──
async function logMessage(
  phone: string,
  direction: string,
  content: string,
  success: boolean,
): Promise<void> {
  try {
    await db.insert(mensajesLog).values({
      telefono: phone,
      tipo: "conversacion",
      contenido: content.slice(0, 500),
      direccion: direction,
      exitoso: success,
    });
  } catch (err) {
    logger.error({ phone, err }, "Error al loguear mensaje");
  }
}

// ── Auto-contactar donante por baja ──
async function contactarDonanteParaBaja(
  bajaDonante: string,
  bajaMotivo: string,
  codigoChofer: string,
): Promise<void> {
  try {
    const nombreBusqueda = bajaDonante.split(",")[0].trim();
    const resultados = await db
      .select({ id: donantes.id, nombre: donantes.nombre, telefono: donantes.telefono })
      .from(donantes)
      .where(ilike(donantes.nombre, `%${nombreBusqueda}%`))
      .limit(3);

    if (resultados.length === 0) {
      logger.warn({ bajaDonante }, "No se encontró donante para auto-contacto de baja");
      await sendMessage(
        env.CEO_PHONE,
        `⚠️ *No se pudo auto-contactar a la donante*\n\nDatos del chofer: ${bajaDonante}\nNo se encontró en la base de datos. Contactar manualmente.`,
      );
      return;
    }

    const donante = resultados[0];

    await db.insert(reportesBaja).values({
      donanteId: donante.id,
      donanteNombre: bajaDonante,
      reportadoPor: "chofer",
      reportadoPorNombre: `Chofer #${codigoChofer}`,
      motivo: bajaMotivo,
      contactadaDonante: true,
    });

    await sendMessage(
      donante.telefono,
      `Hola ${donante.nombre.split(" ")[0]}, te escribimos de parte del laboratorio. 💙\n\n` +
      `Nuestro recolector nos informó que ya no estarías participando de la donación.\n\n` +
      `Queríamos saber qué pasó y si hay algo en lo que podamos ayudarte.\n\n` +
      `¿Podrías contarnos brevemente el motivo? Tu respuesta es muy importante para nosotros.`,
    );

    logger.info({ donante: donante.nombre, telefono: donante.telefono, chofer: codigoChofer }, "Auto-contacto de baja enviado");
  } catch (err) {
    logger.error({ bajaDonante, err }, "Error en auto-contacto de baja");
  }
}
