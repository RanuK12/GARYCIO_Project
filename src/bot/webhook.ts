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
import { sendMessage } from "./client";
import { markAsProcessed } from "../services/dedup";
import { normalizePhone } from "../utils/phone";

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

          if (!value?.messages) continue;

          for (const message of value.messages) {
            const phone = normalizePhone(message.from);
            const messageId = message.id;

            if (message.type === "reaction") {
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

            // Procesar asincrónicamente (no bloquear la respuesta 200)
            processIncomingMessage(phone, text, messageId, mediaInfo || undefined).catch((err) => {
              logger.error({ phone, messageId, err }, "Error procesando mensaje entrante");
              // Marcar como error en dedup para auditoría
              markAsProcessed(messageId, phone, "error").catch(() => {});
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
        return message.interactive.list_reply.title || message.interactive.list_reply.id;
      }
      return null;
    case "button":
      return message.button?.text || message.button?.payload || null;
    default:
      return null;
  }
}

function isUnsupportedMediaType(type: string): boolean {
  return ["sticker", "audio", "video", "location", "contacts", "order", "unsupported"].includes(type);
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
