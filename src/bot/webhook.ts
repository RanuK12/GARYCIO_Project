/**
 * Webhook Router — WhatsApp Cloud API / 360dialog
 *
 * GET  /webhook → Verificación del webhook (Meta envía challenge)
 * POST /webhook → Recepción de mensajes entrantes
 *
 * Mejoras de producción:
 * - Deduplicación por messageId antes de encolar
 * - Respuesta 200 inmediata (no bloquear a Meta)
 * - Procesamiento asíncrono con try/catch aislado
 */

import { Router, Request, Response } from "express";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { processIncomingMessage } from "./handler";
import { sendMessage, markAsReadWithTyping } from "./client";
import { markAsProcessed } from "../services/dedup";
import { normalizePhone } from "../utils/phone";
import { db } from "../database";
import { audioMensajes } from "../database/schema";
import { isWhitelisted } from "../services/bot-control";
import { notifyOutboundSeen } from "../services/bot-takeover";
import { debounceInbound } from "../services/inbound-debounce";

/**
 * Anti-spam de boot: cuando el bot se enciende, 360dialog/Meta reentregan
 * mensajes pendientes que llegaron mientras estaba apagado. Esos mensajes
 * pueden ser de horas atrás y NO deben ser respondidos como si fueran
 * nuevos (pasó eso en producción 25/4, generó spam masivo).
 *
 * Reglas:
 *  1. BOOT_TIMESTAMP_SEC = epoch del arranque del proceso. Mensajes con
 *     timestamp menor a esto se descartan.
 *  2. MAX_AGE_SEC: cualquier mensaje > 5 min viejo (independientemente
 *     del boot) se descarta. Usuario que escribió "hola" hace 2h y nos
 *     llega ahora — no le reabrimos la conversación.
 */
const BOOT_TIMESTAMP_SEC = Math.floor(Date.now() / 1000);
const MAX_INBOUND_AGE_SEC = 5 * 60; // 5 min

function isMessageTooOld(message: any): { tooOld: boolean; reason?: string; ageSec?: number } {
  const tsRaw = message?.timestamp;
  const ts = typeof tsRaw === "string" ? parseInt(tsRaw, 10) : Number(tsRaw);
  if (!Number.isFinite(ts) || ts <= 0) {
    // Sin timestamp válido (caso raro). Default: aceptar para no perder
    // mensajes legítimos por payloads atípicos. Loguea para auditoría.
    return { tooOld: false };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const ageSec = nowSec - ts;
  if (ts < BOOT_TIMESTAMP_SEC) {
    return { tooOld: true, reason: "pre-boot", ageSec };
  }
  if (ageSec > MAX_INBOUND_AGE_SEC) {
    return { tooOld: true, reason: "max-age-exceeded", ageSec };
  }
  return { tooOld: false, ageSec };
}

export function createWebhookRouter(): Router {
  const router = Router();

  // ── Verificación del webhook ──
  router.get("/webhook", (req: Request, res: Response) => {
    const mode = req.query["hub.mode"] as string;
    const token = req.query["hub.verify_token"] as string;
    const challenge = req.query["hub.challenge"] as string;

    if (mode === "subscribe" && token === env.WHATSAPP_VERIFY_TOKEN) {
      logger.info("Webhook verificado correctamente");
      res.status(200).send(challenge);
    } else {
      logger.warn({ mode, token }, "Verificación de webhook fallida");
      res.sendStatus(403);
    }
  });

  // ── Recepción de mensajes ──
  router.post("/webhook", (req: Request, res: Response) => {
    // Responder 200 inmediatamente — WhatsApp requiere respuesta rápida (< 20s)
    res.sendStatus(200);

    try {
      const body = req.body;

      if (body.object !== "whatsapp_business_account") return;

      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field !== "messages") continue;

          const value = change.value;

          // Statuses de mensajes salientes (sent, delivered, read, failed)
          if (value?.statuses) {
            for (const status of value.statuses) {
              // P0.10 — detección pasiva de intervención humana:
              // si el messageId NO fue registrado por el bot al enviar,
              // es un outbound ajeno (agente en dashboard / 360 Inbox)
              // → pausamos el bot para ese teléfono.
              if (status.status === "sent" && status.id && status.recipient_id) {
                notifyOutboundSeen(normalizePhone(status.recipient_id), status.id);
              }
              if (status.status === "failed") {
                logger.error(
                  { phone: status.recipient_id, messageId: status.id, status: status.status, errors: status.errors },
                  "WhatsApp delivery FAILED",
                );
              } else {
                logger.info(
                  { phone: status.recipient_id, messageId: status.id, status: status.status },
                  "WhatsApp delivery status",
                );
              }
            }
          }

          // ── Llamadas de voz/video — ignorar silenciosamente ──
          // WhatsApp envía notificaciones de llamada como un array "calls"
          // separado del array "messages". Las descartamos sin responder.
          if (value?.calls) {
            for (const call of value.calls) {
              logger.info(
                { phone: call.from, callId: call.id, type: call.type },
                "Llamada WhatsApp recibida — ignorada (no soportada)",
              );
            }
          }

          if (!value?.messages) continue;

          for (const message of value.messages) {
            const phone = normalizePhone(message.from);
            const messageId = message.id;

            // ── Filtro de antigüedad: descartar mensajes pre-boot o > 5 min ──
            // Crítico para evitar el spam que pasó al re-arrancar (25/4).
            const ageCheck = isMessageTooOld(message);
            if (ageCheck.tooOld) {
              logger.warn(
                { phone, messageId, reason: ageCheck.reason, ageSec: ageCheck.ageSec },
                "Mensaje viejo o pre-boot — descartado sin procesar",
              );
              if (messageId) markAsProcessed(messageId, phone, "ignored").catch(() => {});
              continue;
            }

            if (message.type === "reaction") {
              continue;
            }

            // Llamadas que lleguen como tipo de mensaje (edge case)
            if (message.type === "call") {
              logger.info({ phone, messageId }, "Llamada como mensaje — ignorada");
              continue;
            }

            if (message.type === "audio") {
              logger.info({ phone, messageId }, "Audio recibido — escalando a humano");
              handleAudioMessage(phone, message.audio, messageId).catch(() => {});
              continue;
            }

            if (isUnsupportedMediaType(message.type)) {
              logger.debug({ phone, type: message.type }, "Media no soportado — pidiendo texto");
              respondUnsupportedMedia(phone, message.type).catch(() => {});
              continue;
            }

            const mediaInfo = extractMediaFromMessage(message);
            const rawText = mediaInfo ? (mediaInfo.caption || "__IMAGEN__") : extractTextFromMessage(message);
            // Ignorar mensajes vacíos, solo espacios o puntuación antes de procesar
            const text = rawText?.trim() || "";
            if (!phone || !text || /^[\s\p{P}]*$/u.test(text)) continue;

            logger.info(
              { phone, text: text.slice(0, 80), messageId, hasMedia: !!mediaInfo },
              "Mensaje recibido via webhook",
            );

            // Verificar capacidad controlada (first-come-first-served).
            // Política de re-launch: las primeras N donantes que escriben
            // toman slot y el bot las maneja. La N+1 y siguientes quedan
            // en SILENCIO TOTAL — ni mensaje de capacidad, ni read receipt,
            // ni typing. Para la donante el chat queda como si no
            // existiéramos (mensaje en gris ✓✓ delivered, sin azul). Eso
            // evita "consumir" su ventana 24h y evita interrumpir si un
            // humano la atiende después.
            isWhitelisted(phone).then((allowed) => {
              if (!allowed) {
                logger.warn({ phone }, "Fuera del cap — silencio total (no read, no typing, no respuesta)");
                if (messageId) markAsProcessed(messageId, phone, "ignored").catch(() => {});
                return;
              }

              // Donante DENTRO del cap — recién acá mostramos lectura
              // + "escribiendo…" para que sepa que la oímos. typing dura
              // ~25s o hasta nuestro próximo outbound, así engancha
              // perfecto con el debounce de 10s.
              if (messageId) {
                markAsReadWithTyping(messageId).catch(() => {});
              }

              // P0.12 — Debounce 10s por teléfono. Si llegan más mensajes
              // del mismo phone dentro de la ventana, se concatenan y se
              // responde una sola vez al final del batch.
              debounceInbound(
                { phone, text, messageId, mediaInfo: mediaInfo || undefined },
                {
                  onFlush: async (batched) =>
                    processIncomingMessage(
                      batched.phone,
                      batched.text,
                      batched.messageId,
                      batched.mediaInfo,
                    ),
                },
              ).catch((err) => {
                logger.error({ phone, messageId, err }, "Error procesando mensaje entrante");
                markAsProcessed(messageId, phone, "error").catch(() => {});
              });
            }).catch((err) => {
              logger.error({ phone, messageId, err }, "Error verificando capacidad");
            });
          }
        }
      }
    } catch (err) {
      logger.error({ err }, "Error parseando webhook payload");
    }
  });

  return router;
}

export interface MediaInfo {
  mediaId: string;
  mimeType: string;
  caption: string | null;
  type: "image" | "document";
}

function extractMediaFromMessage(message: any): MediaInfo | null {
  if (message.type === "image" && message.image?.id) {
    return {
      mediaId: message.image.id,
      mimeType: message.image.mime_type || "image/jpeg",
      caption: message.image.caption || null,
      type: "image",
    };
  }
  if (message.type === "document" && message.document?.id) {
    return {
      mediaId: message.document.id,
      mimeType: message.document.mime_type || "application/octet-stream",
      caption: message.document.caption || null,
      type: "document",
    };
  }
  return null;
}

function extractTextFromMessage(message: any): string | null {
  switch (message.type) {
    case "text":
      return message.text?.body || null;
    case "interactive":
      if (message.interactive?.type === "button_reply") {
        return message.interactive.button_reply.title || message.interactive.button_reply.id;
      }
      if (message.interactive?.type === "list_reply") {
        return message.interactive.list_reply.id || message.interactive.list_reply.title;
      }
      return null;
    case "button":
      return message.button?.text || message.button?.payload || null;
    default:
      return null;
  }
}

function isUnsupportedMediaType(type: string): boolean {
  return ["sticker", "video", "location", "contacts", "order", "unsupported"].includes(type);
}

const unsupportedMediaCooldown = new Map<string, number>();

setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [phone, ts] of unsupportedMediaCooldown) {
    if (ts < cutoff) unsupportedMediaCooldown.delete(phone);
  }
}, 60 * 60 * 1000);

async function respondUnsupportedMedia(phone: string, type: string): Promise<void> {
  const now = Date.now();
  const last = unsupportedMediaCooldown.get(phone);
  if (last && now - last < 10 * 60 * 1000) return;
  unsupportedMediaCooldown.set(phone, now);

  const mensajes: Record<string, string> = {
    audio: "No puedo escuchar audios todavía. ¿Podrías escribir tu mensaje con texto? Así te puedo ayudar mejor.",
    video: "No puedo ver videos todavía. ¿Podrías escribir tu mensaje con texto?",
    sticker: "No puedo interpretar stickers. Si necesitás algo, escribime con texto.",
    location: "Gracias por compartir tu ubicación, pero por ahora solo puedo leer mensajes de texto.",
    contacts: "No puedo procesar contactos. Si necesitás algo, escribime con texto.",
  };

  const msg = mensajes[type] || "No puedo procesar ese tipo de mensaje. Escribime con texto por favor.";

  try {
    await sendMessage(phone, msg);
  } catch {
    // No es crítico
  }
}
// -- Manejo de audios --
async function handleAudioMessage(
  phone: string,
  audio: { id?: string; mime_type?: string },
  messageId?: string,
): Promise<void> {
  try {
    await db.insert(audioMensajes).values({
      telefono: phone,
      mediaId: audio?.id || null,
      mimeType: audio?.mime_type || "audio/ogg",
      atendido: false,
    });
    const respuesta =
      `Disculpe, por el momento no puedo escuchar audios.\n\n` +
      `¿Podria escribir su mensaje por texto? Asi le puedo ayudar mejor.\n\n` +
      `De lo contrario, enseguida la atendera uno de nuestros colegas.`;
    await sendMessage(phone, respuesta);
    await sendMessage(
      env.CEO_PHONE,
      `Audio recibido - requiere atencion manual\n\n` +
      `Donante: ${phone}\n` +
      `Media ID: ${audio?.id || "N/A"}\n\n` +
      `La donante fue notificada de que un colega la atendera.`,
    );
    if (messageId) {
      await markAsProcessed(messageId, phone, "ignored");
    }
  } catch (err) {
    logger.error({ phone, err }, "Error manejando audio de donante");
  }
}
