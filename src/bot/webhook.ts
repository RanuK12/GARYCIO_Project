import { Router, Request, Response } from "express";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { processIncomingMessage } from "./handler";
import { sendMessage } from "./client";

/**
 * Router de Express para el webhook de WhatsApp Cloud API.
 *
 * GET  /webhook → Verificación del webhook (Meta envía challenge)
 * POST /webhook → Recepción de mensajes entrantes
 */
export function createWebhookRouter(): Router {
  const router = Router();

  // ── Verificación del webhook ──────────────────────────
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

  // ── Recepción de mensajes ─────────────────────────────
  router.post("/webhook", (req: Request, res: Response) => {
    // Responder 200 inmediatamente (WhatsApp requiere respuesta rápida)
    res.sendStatus(200);

    try {
      const body = req.body;

      if (body.object !== "whatsapp_business_account") return;

      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field !== "messages") continue;

          const value = change.value;

          // ── Statuses de mensajes salientes (sent, delivered, read, failed) ──
          if (value?.statuses) {
            for (const status of value.statuses) {
              if (status.status === "failed") {
                logger.error(
                  {
                    phone: status.recipient_id,
                    messageId: status.id,
                    status: status.status,
                    errors: status.errors,
                  },
                  "WhatsApp delivery FAILED",
                );
              } else {
                logger.info(
                  {
                    phone: status.recipient_id,
                    messageId: status.id,
                    status: status.status,
                  },
                  "WhatsApp delivery status",
                );
              }
            }
          }

          if (!value?.messages) continue;

          for (const message of value.messages) {
            const phone = message.from;
            const messageId = message.id;

            // Reactions → ignorar silenciosamente (no merecen respuesta)
            if (message.type === "reaction") {
              continue;
            }

            // Audio/video/sticker/location → responder amablemente pidiendo texto
            if (isUnsupportedMediaType(message.type)) {
              logger.debug({ phone, type: message.type }, "Media no soportado — pidiendo texto");
              respondUnsupportedMedia(phone, message.type).catch(() => {});
              continue;
            }

            // Extraer datos de imagen si es mensaje de imagen
            const mediaInfo = extractMediaFromMessage(message);
            const text = mediaInfo ? (mediaInfo.caption || "__IMAGEN__") : extractTextFromMessage(message);

            if (!phone || !text) continue;

            logger.info(
              { phone, text: text.slice(0, 80), messageId, hasMedia: !!mediaInfo },
              "Mensaje recibido via webhook",
            );

            // Procesar asincrónicamente (no bloquear la respuesta)
            processIncomingMessage(phone, text, messageId, mediaInfo || undefined).catch((err) => {
              logger.error({ phone, err }, "Error procesando mensaje entrante");
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

/** Datos de media adjunta (imagen, documento) */
export interface MediaInfo {
  mediaId: string;
  mimeType: string;
  caption: string | null;
  type: "image" | "document";
}

/**
 * Extrae datos de media si el mensaje es imagen o documento.
 */
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

/**
 * Extrae el texto del mensaje según su tipo.
 * Soporta: text, interactive (buttons/lists), button (quick reply).
 */
function extractTextFromMessage(message: any): string | null {
  switch (message.type) {
    case "text":
      return message.text?.body || null;

    case "interactive":
      // Respuesta de botones o listas
      if (message.interactive?.type === "button_reply") {
        return message.interactive.button_reply.title || message.interactive.button_reply.id;
      }
      if (message.interactive?.type === "list_reply") {
        return message.interactive.list_reply.title || message.interactive.list_reply.id;
      }
      return null;

    case "button":
      // Quick reply buttons
      return message.button?.text || message.button?.payload || null;

    default:
      return null;
  }
}

/**
 * Tipos de media que no procesamos pero queremos dar feedback.
 */
function isUnsupportedMediaType(type: string): boolean {
  return ["sticker", "audio", "video", "location", "contacts", "order", "unsupported"].includes(type);
}

// Cooldown para evitar spam de respuestas a media no soportado (1 por número cada 10 min)
const unsupportedMediaCooldown = new Map<string, number>();

async function respondUnsupportedMedia(phone: string, type: string): Promise<void> {
  const now = Date.now();
  const last = unsupportedMediaCooldown.get(phone);
  if (last && now - last < 10 * 60 * 1000) return; // 10 min cooldown
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
