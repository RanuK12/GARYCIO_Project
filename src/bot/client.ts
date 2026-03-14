import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  WASocket,
  proto,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import * as qrcode from "qrcode-terminal";
import { logger } from "../config/logger";
import { env } from "../config/env";
import path from "path";
import fs from "fs";

let sock: WASocket | null = null;

const AUTH_DIR = path.join(process.cwd(), "auth_info", env.BOT_SESSION_NAME);

export async function initBot(): Promise<WASocket> {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: logger.child({ module: "baileys" }) as any,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      logger.info("Escaneá el QR con WhatsApp:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;

      if (reason === DisconnectReason.loggedOut) {
        logger.warn("Bot deslogueado. Eliminá la carpeta auth_info y volvé a escanear.");
        return;
      }

      logger.info(`Conexión cerrada (razón: ${reason}). Reconectando...`);
      initBot();
    }

    if (connection === "open") {
      logger.info("Bot de WhatsApp conectado correctamente");
    }
  });

  return sock;
}

export function getSocket(): WASocket {
  if (!sock) throw new Error("El bot no fue inicializado. Llamá a initBot() primero.");
  return sock;
}

export async function sendMessage(
  phone: string,
  message: string,
): Promise<proto.WebMessageInfo | undefined> {
  const socket = getSocket();
  const jid = formatPhoneToJid(phone);

  try {
    const result = await socket.sendMessage(jid, { text: message });
    logger.debug({ phone, preview: message.slice(0, 50) }, "Mensaje enviado");
    return result;
  } catch (err) {
    logger.error({ phone, err }, "Error al enviar mensaje");
    throw err;
  }
}

export async function sendBulkMessages(
  recipients: Array<{ phone: string; message: string }>,
  delayMs = 3000,
): Promise<{ sent: number; failed: number; errors: Array<{ phone: string; error: string }> }> {
  const results = { sent: 0, failed: 0, errors: [] as Array<{ phone: string; error: string }> };

  for (const { phone, message } of recipients) {
    try {
      await sendMessage(phone, message);
      results.sent++;
    } catch (err) {
      results.failed++;
      results.errors.push({ phone, error: (err as Error).message });
    }

    await sleep(delayMs);
  }

  logger.info(
    { sent: results.sent, failed: results.failed },
    "Envío masivo completado",
  );

  return results;
}

/**
 * Envía un documento/archivo por WhatsApp.
 */
export async function sendDocument(
  phone: string,
  filePath: string,
  fileName: string,
  caption?: string,
): Promise<proto.WebMessageInfo | undefined> {
  const socket = getSocket();
  const jid = formatPhoneToJid(phone);

  try {
    const fileBuffer = fs.readFileSync(filePath);
    const mimeType = filePath.endsWith(".pdf")
      ? "application/pdf"
      : "application/octet-stream";

    const result = await socket.sendMessage(jid, {
      document: fileBuffer,
      mimetype: mimeType,
      fileName,
      caption,
    });

    logger.debug({ phone, fileName }, "Documento enviado");
    return result;
  } catch (err) {
    logger.error({ phone, fileName, err }, "Error al enviar documento");
    throw err;
  }
}

function formatPhoneToJid(phone: string): string {
  const cleaned = phone.replace(/[\s\-\+\(\)]/g, "");
  const withCountry = cleaned.startsWith("54") ? cleaned : `54${cleaned}`;
  return `${withCountry}@s.whatsapp.net`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
