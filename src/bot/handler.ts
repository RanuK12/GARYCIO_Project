import { WASocket, proto } from "@whiskeysockets/baileys";
import { handleIncomingMessage } from "./conversation-manager";
import { sendMessage } from "./client";
import { logger } from "../config/logger";

export function registerMessageHandler(sock: WASocket): void {
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const phone = msg.key.remoteJid?.replace("@s.whatsapp.net", "") || "";
      if (!phone || phone.includes("@g.us")) continue;

      const text = extractText(msg);
      if (!text) continue;

      logger.info({ phone, text: text.slice(0, 80) }, "Mensaje recibido");

      try {
        const reply = await handleIncomingMessage(phone, text);
        await sendMessage(phone, reply);
      } catch (err) {
        logger.error({ phone, err }, "Error al responder mensaje");
      }
    }
  });

  logger.info("Handler de mensajes registrado");
}

function extractText(msg: proto.IWebMessageInfo): string | null {
  const m = msg.message;
  if (!m) return null;

  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId ||
    null
  );
}
