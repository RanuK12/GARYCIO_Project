import { Router, Request, Response } from "express";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { processIncomingMessage } from "./handler";

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
          if (!value?.messages) continue;

          for (const message of value.messages) {
            const phone = message.from;
            const text = extractTextFromMessage(message);
            const messageId = message.id;

            if (!phone || !text) continue;

            logger.info(
              { phone, text: text.slice(0, 80), messageId },
              "Mensaje recibido via webhook",
            );

            // Procesar asincrónicamente (no bloquear la respuesta)
            processIncomingMessage(phone, text, messageId).catch((err) => {
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
