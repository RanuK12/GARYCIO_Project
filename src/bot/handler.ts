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
import type { MediaInfo } from "./webhook";

// ── Anti-loop: cooldown y max interactions por sesión ──
// Cooldown bajo (30s) para evitar spam rápido sin bloquear donantes legítimas
const COOLDOWN_MS = 30 * 1000; // 30 segundos entre respuestas al mismo número
const MAX_INTERACTIONS_PER_SESSION = 10; // Máximo de respuestas en ventana de 30 min

const lastResponseTime = new Map<string, number>();
const interactionCount = new Map<string, { count: number; windowStart: number }>();

// Limpieza periódica de Maps para evitar memory leaks con muchos números únicos
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
  if (cleaned > 0) logger.debug({ cleaned }, "Limpieza de Maps anti-spam completada");
}, 60 * 60 * 1000); // Cada hora

// Mensajes que no requieren respuesta (se ignoran silenciosamente)
// NOTA: NO incluir saludos (hola, buen día, etc.) — las donantes esperan respuesta cuando saludan
const MENSAJES_IGNORADOS = new Set([
  "ok", "okey", "oki", "dale", "bueno", "bien", "listo", "perfecto",
  "gracias", "gracia", "muchas gracias", "mil gracias",
  "jaja", "jajaja", "jajajaja", "jeje", "jejeje",
  "si", "sí", "no", "ya",
  "👍", "👌", "🙏", "❤️", "😊", "😂", "🤣", "👋", "✅", "🙌",
]);

function esMensajeIgnorado(text: string): boolean {
  const clean = text.trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Mensaje corto que está en la lista de ignorados
  if (MENSAJES_IGNORADOS.has(clean)) return true;
  // Solo emojis (1-3 emojis sin texto)
  if (/^[\p{Emoji_Presentation}\p{Emoji}\uFE0F\u200D]{1,6}$/u.test(clean)) return true;
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
  // Reset window if 30 min passed
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

// Determinar si el resultado es un reclamo/escalación que NO debe marcarse como leído
function esEscalacion(result: { notify?: FlowResponse["notify"]; flowData?: { flowName: string } }): boolean {
  if (result.flowData?.flowName === "reclamo") return true;
  if (result.notify?.target === "admin") return true;
  return false;
}

/**
 * Procesa un mensaje entrante de principio a fin:
 * 1. Adquiere lock por usuario (evita race conditions)
 * 2. Checks anti-loop (cooldown, max interactions, mensajes ignorados)
 * 3. Procesa el mensaje con el conversation manager
 * 4. Envía la respuesta
 * 5. Procesa notificaciones (chofer, admin, visitadora)
 * 6. Loguea en DB
 */
export async function processIncomingMessage(
  phone: string,
  text: string,
  messageId?: string,
  mediaInfo?: MediaInfo,
): Promise<void> {
  await withUserLock(phone, async () => {
    // Log del mensaje entrante (siempre, incluso si se ignora)
    logMessage(phone, "entrante", text, true).catch(() => {});

    // Auto-registrar contacto del donante
    registrarContactoDonante(phone, text).catch((err) => {
      logger.error({ phone, err }, "Error registrando contacto de donante");
    });

    // ── Anti-loop: solo los admins están exentos de todos los límites ──
    const esAdmin = isAdminPhone(phone);
    const esConfirmacion = esConfirmacionDifusion(text);

    if (!esAdmin) {
      // Ignorar mensajes triviales silenciosamente (excepto si es confirmación de difusión)
      if (!esConfirmacion && esMensajeIgnorado(text)) {
        logger.debug({ phone, text }, "Mensaje ignorado (trivial)");
        if (messageId) markAsRead(messageId).catch(() => {});
        return;
      }

      // Cooldown: aplica a TODOS los no-admins, incluyendo confirmaciones de difusión.
      // Excepción: si ya hubo una confirmación de difusión procesada para este número
      // hoy, no tiene sentido bloquearla — pero el cooldown de 30s es suficientemente
      // corto para no molestar y evita el spam de "1" repetido.
      if (checkCooldown(phone)) {
        logger.debug({ phone, esConfirmacion }, "Cooldown activo — ignorando mensaje");
        if (messageId) markAsRead(messageId).catch(() => {});
        return;
      }

      // Max interactions: si ya respondimos demasiadas veces en 30 min, notificar admin
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

    // Verificar si es respuesta a encuesta (SI/NO)
    const esEncuesta = await procesarRespuestaEncuesta(phone, text).catch(() => false);
    if (esEncuesta) {
      await sendMessage(phone, "✅ ¡Gracias por tu respuesta! Fue registrada correctamente.").catch(() => {});
      logMessage(phone, "saliente", "Respuesta de encuesta registrada", true).catch(() => {});
      recordInteraction(phone);
      if (messageId) markAsRead(messageId).catch(() => {});
      return;
    }

    // Procesar (pasar mediaInfo para flujos que aceptan imágenes)
    const result = await handleIncomingMessage(phone, text, mediaInfo);

    // Si no hay respuesta (clasificador decidió ignorar), no enviar nada
    if (!result.reply && !result.interactive) {
      logger.debug({ phone }, "Sin respuesta (mensaje ignorado por clasificador)");
      if (messageId) markAsRead(messageId).catch(() => {});
      return;
    }

    // Enviar respuesta (texto plano o mensaje interactivo)
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

    // Marcar como leído — EXCEPTO reclamos/escalaciones (para que queden visibles en el teléfono)
    if (messageId) {
      if (esEscalacion(result)) {
        logger.info({ phone }, "Reclamo/escalación — NO se marca como leído");
      } else {
        markAsRead(messageId).catch(() => {});
      }
    }

    // Procesar notificaciones
    if (result.notify) {
      await processNotification(phone, result.notify);
    }

    // Persistir datos de flujo completado (reclamos, incidentes)
    if (result.flowData) {
      await saveFlowData(phone, result.flowData).catch((err) => {
        logger.error({ phone, err }, "Error guardando datos de flujo");
      });
    }
  });
}

// ── Notificaciones ──────────────────────────────────────
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
          logger.info(
            { donante: senderPhone, chofer: chofer.nombre },
            "Notificación enviada al chofer",
          );
        } else {
          // Fallback: enviar al admin si no hay chofer asignado
          await sendMessage(
            env.CEO_PHONE,
            `⚠️ Sin chofer asignado para ${senderPhone}\n\n${notify.message}`,
          );
        }
        break;
      }

      case "visitadora": {
        const visitadora = await findVisitadoraForDonante(senderPhone);
        if (visitadora) {
          await sendMessage(visitadora.telefono, notify.message);
          logger.info(
            { donante: senderPhone, visitadora: visitadora.nombre },
            "Notificación enviada a visitadora",
          );
        } else {
          await sendMessage(
            env.CEO_PHONE,
            `⚠️ Sin visitadora asignada para ${senderPhone}\n\n${notify.message}`,
          );
        }
        break;
      }
    }
  } catch (err) {
    logger.error({ senderPhone, target: notify.target, err }, "Error procesando notificación");
  }
}

async function findChoferForDonante(
  phone: string,
): Promise<{ nombre: string; telefono: string } | null> {
  // Buscar la zona del donante
  const donanteResult = await db
    .select({ zonaId: donantes.zonaId })
    .from(donantes)
    .where(eq(donantes.telefono, phone))
    .limit(1);

  if (donanteResult.length === 0 || !donanteResult[0].zonaId) return null;

  // Buscar el chofer de esa zona
  const choferResult = await db
    .select({
      nombre: choferes.nombre,
      telefono: choferes.telefono,
    })
    .from(zonaChoferes)
    .innerJoin(choferes, eq(zonaChoferes.choferId, choferes.id))
    .where(
      and(
        eq(zonaChoferes.zonaId, donanteResult[0].zonaId),
        eq(zonaChoferes.activo, true),
      ),
    )
    .limit(1);

  return choferResult.length > 0 ? choferResult[0] : null;
}

async function findVisitadoraForDonante(
  phone: string,
): Promise<{ nombre: string; telefono: string } | null> {
  // Buscar si hay un reclamo escalado a visitadora para este donante
  const donanteResult = await db
    .select({ id: donantes.id, zonaId: donantes.zonaId })
    .from(donantes)
    .where(eq(donantes.telefono, phone))
    .limit(1);

  if (donanteResult.length === 0) return null;

  // Buscar visitadora asignada al reclamo más reciente
  const reclamoResult = await db
    .select({ visitadoraId: reclamos.visitadoraId })
    .from(reclamos)
    .where(
      and(
        eq(reclamos.donanteId, donanteResult[0].id),
        isNotNull(reclamos.visitadoraId),
      ),
    )
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

  // Fallback: buscar cualquier visitadora activa
  const anyVisitadora = await db
    .select({ nombre: visitadoras.nombre, telefono: visitadoras.telefono })
    .from(visitadoras)
    .where(eq(visitadoras.activa, true))
    .limit(1);

  return anyVisitadora.length > 0 ? anyVisitadora[0] : null;
}

// ── Persistencia de datos de flujo ──────────────────────
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

  // Auto-contactar donante cuando el chofer reporta una baja
  if (flowName === "chofer" && data.bajaAutoContactar && data.bajaDonante) {
    await contactarDonanteParaBaja(data.bajaDonante, data.bajaMotivo, data.codigoChofer);
  }
}

// ── Logging de mensajes ─────────────────────────────────
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

// ── Auto-contactar donante por baja reportada por chofer ──
async function contactarDonanteParaBaja(
  bajaDonante: string,
  bajaMotivo: string,
  codigoChofer: string,
): Promise<void> {
  try {
    // Buscar la donante por nombre (coincidencia parcial)
    const nombreBusqueda = bajaDonante.split(",")[0].trim(); // tomar el nombre antes de la dirección
    const resultados = await db
      .select({ id: donantes.id, nombre: donantes.nombre, telefono: donantes.telefono })
      .from(donantes)
      .where(ilike(donantes.nombre, `%${nombreBusqueda}%`))
      .limit(3);

    if (resultados.length === 0) {
      logger.warn({ bajaDonante }, "No se encontró donante para auto-contacto de baja");
      await sendMessage(
        env.CEO_PHONE,
        `⚠️ *No se pudo auto-contactar a la donante*\n\n` +
        `Datos del chofer: ${bajaDonante}\n` +
        `No se encontró en la base de datos. Contactar manualmente.`,
      );
      return;
    }

    // Tomar la primera coincidencia
    const donante = resultados[0];

    // Guardar reporte de baja en DB
    await db.insert(reportesBaja).values({
      donanteId: donante.id,
      donanteNombre: bajaDonante,
      reportadoPor: "chofer",
      reportadoPorNombre: `Chofer #${codigoChofer}`,
      motivo: bajaMotivo,
      contactadaDonante: true,
    });

    // Enviar mensaje a la donante preguntando qué pasó
    await sendMessage(
      donante.telefono,
      `Hola ${donante.nombre.split(" ")[0]}, te escribimos de parte del laboratorio. 💙\n\n` +
      `Nuestro recolector nos informó que ya no estarías participando de la donación.\n\n` +
      `Queríamos saber qué pasó y si hay algo en lo que podamos ayudarte.\n\n` +
      `¿Podrías contarnos brevemente el motivo? Tu respuesta es muy importante para nosotros.`,
    );

    logger.info(
      { donante: donante.nombre, telefono: donante.telefono, chofer: codigoChofer },
      "Auto-contacto de baja enviado a donante",
    );
  } catch (err) {
    logger.error({ bajaDonante, err }, "Error en auto-contacto de baja");
  }
}
