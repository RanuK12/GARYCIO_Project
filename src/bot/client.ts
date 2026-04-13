import { env } from "../config/env";
import { logger } from "../config/logger";
import fs from "fs";

// Soporte para Meta Cloud API directa o 360dialog como proveedor
// Meta:      https://graph.facebook.com/v22.0/{phone_number_id}  — Authorization: Bearer TOKEN
// 360dialog: https://waba-v2.360dialog.io                        — Authorization: D360-API-KEY
const is360 = env.WHATSAPP_PROVIDER === "360dialog";
const API_BASE = is360
  ? "https://waba-v2.360dialog.io"
  : `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}`;

// ── Test mode whitelist ─────────────────────────────────
const TEST_WHITELIST: ReadonlySet<string> = new Set(
  env.TEST_PHONES ? env.TEST_PHONES.split(",").map((p) => p.trim()).filter(Boolean) : [],
);

function assertTestWhitelist(phone: string): void {
  if (!env.TEST_MODE) return;

  const cleaned = phone.replace(/[\s\-\+\(\)]/g, "");
  if (!TEST_WHITELIST.has(cleaned)) {
    const msg = `TEST_MODE: bloqueado envío a ${cleaned} (no está en whitelist: ${[...TEST_WHITELIST].join(", ")})`;
    logger.warn(msg);
    throw new Error(msg);
  }
}

// ── Rate limiter simple ─────────────────────────────────
let lastSendTime = 0;
const MIN_SEND_INTERVAL = Math.ceil(1000 / env.SEND_RATE_PER_SECOND);

async function rateLimitWait(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastSendTime;
  if (elapsed < MIN_SEND_INTERVAL) {
    await new Promise((r) => setTimeout(r, MIN_SEND_INTERVAL - elapsed));
  }
  lastSendTime = Date.now();
}

// ── Llamada genérica a la API de WhatsApp ───────────────
async function callWhatsAppAPI(
  endpoint: string,
  body: Record<string, any>,
): Promise<any> {
  const url = `${API_BASE}${endpoint}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(is360
      ? { "D360-API-KEY": env.WHATSAPP_TOKEN }
      : { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` }),
  };

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as Record<string, any>;

  if (!response.ok) {
    const errorMsg = data?.error?.message || JSON.stringify(data);
    const errorCode = data?.error?.code || response.status;
    throw new WhatsAppAPIError(String(errorMsg), Number(errorCode), response.status);
  }

  return data;
}

// ── Error tipado de WhatsApp API ────────────────────────
export class WhatsAppAPIError extends Error {
  constructor(
    message: string,
    public code: number,
    public httpStatus: number,
  ) {
    super(message);
    this.name = "WhatsAppAPIError";
  }

  /** Errores que NO tienen sentido reintentar (número inválido, template no existe, etc.) */
  get isPermanent(): boolean {
    // 131030 = recipient not on WhatsApp
    // 132000 = template not found
    // 131026 = message not deliverable
    return [131030, 132000, 131026, 100].includes(this.code);
  }
}

// ── Envío de mensaje de texto ───────────────────────────
export async function sendMessage(
  phone: string,
  message: string,
  retries = 0,
): Promise<any> {
  const to = formatPhone(phone);
  assertTestWhitelist(to);
  await rateLimitWait();

  try {
    const result = await callWhatsAppAPI("/messages", {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: message },
    });

    logger.debug({ phone: to, preview: message.slice(0, 50) }, "Mensaje enviado");
    return result;
  } catch (err) {
    // No reintentar errores permanentes
    if (err instanceof WhatsAppAPIError && err.isPermanent) {
      logger.error({ phone: to, code: err.code, err: err.message }, "Error permanente, no se reintenta");
      throw err;
    }

    if (retries < env.MAX_RETRIES) {
      const delay = Math.pow(2, retries) * 1000 + Math.random() * 500;
      logger.warn(
        { phone: to, retry: retries + 1, maxRetries: env.MAX_RETRIES, delay: Math.round(delay) },
        "Reintentando envío",
      );
      await new Promise((r) => setTimeout(r, delay));
      return sendMessage(phone, message, retries + 1);
    }

    logger.error({ phone: to, err }, "Error al enviar mensaje (reintentos agotados)");
    throw err;
  }
}

// ── Envío de mensaje template (marketing/utility) ───────
export async function sendTemplate(
  phone: string,
  templateName: string,
  languageCode = "es_AR",
  components?: Array<{
    type: "body" | "header";
    parameters: Array<{ type: "text"; text: string; parameter_name?: string }>;
  }>,
): Promise<any> {
  const to = formatPhone(phone);
  assertTestWhitelist(to);
  await rateLimitWait();

  const template: Record<string, any> = {
    name: templateName,
    language: { code: languageCode },
  };

  if (components && components.length > 0) {
    template.components = components;
  }

  try {
    const result = await callWhatsAppAPI("/messages", {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template,
    });

    logger.debug({ phone: to, template: templateName }, "Template enviado");
    return result;
  } catch (err) {
    logger.error({ phone: to, template: templateName, err }, "Error al enviar template");
    throw err;
  }
}

// ── Envío de documento ──────────────────────────────────
export async function sendDocument(
  phone: string,
  filePath: string,
  fileName: string,
  caption?: string,
): Promise<any> {
  const to = formatPhone(phone);
  assertTestWhitelist(to);

  try {
    // Paso 1: subir el archivo a la API de Media
    const mediaId = await uploadMedia(filePath, fileName);

    // Paso 2: enviar el documento con el media ID
    await rateLimitWait();
    const result = await callWhatsAppAPI("/messages", {
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: {
        id: mediaId,
        filename: fileName,
        ...(caption && { caption }),
      },
    });

    logger.debug({ phone: to, fileName }, "Documento enviado");
    return result;
  } catch (err) {
    logger.error({ phone: to, fileName, err }, "Error al enviar documento");
    throw err;
  }
}

async function uploadMedia(filePath: string, fileName: string): Promise<string> {
  const url = `${API_BASE}/media`;
  const fileBuffer = fs.readFileSync(filePath);
  const mimeType = filePath.endsWith(".pdf") ? "application/pdf" : "application/octet-stream";

  const formData = new FormData();
  formData.append("messaging_product", "whatsapp");
  formData.append("file", new Blob([fileBuffer], { type: mimeType }), fileName);
  formData.append("type", mimeType);

  const response = await fetch(url, {
    method: "POST",
    headers: is360
      ? { "D360-API-KEY": env.WHATSAPP_TOKEN }
      : { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` },
    body: formData,
  });

  const data = (await response.json()) as Record<string, any>;

  if (!response.ok) {
    throw new Error(`Error subiendo media: ${data?.error?.message || JSON.stringify(data)}`);
  }

  return data.id as string;
}

// ── Descarga de media (imágenes, documentos) ────────────

/**
 * Obtiene la URL de descarga de un media object de WhatsApp.
 * Paso 1: GET /media_id → retorna url
 * Paso 2: GET url con Authorization → retorna el archivo binario
 */
export async function getMediaUrl(mediaId: string): Promise<string> {
  const url = is360
    ? `https://waba-v2.360dialog.io/media/${mediaId}`
    : `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${mediaId}`;

  const response = await fetch(url, {
    headers: is360
      ? { "D360-API-KEY": env.WHATSAPP_TOKEN }
      : { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` },
  });

  const data = (await response.json()) as Record<string, any>;

  if (!response.ok) {
    throw new Error(`Error obteniendo media URL: ${data?.error?.message || JSON.stringify(data)}`);
  }

  return data.url as string;
}

/**
 * Descarga un archivo de media de WhatsApp y lo retorna como Buffer.
 */
export async function downloadMedia(mediaId: string): Promise<{
  buffer: Buffer;
  mimeType: string;
}> {
  const mediaUrl = await getMediaUrl(mediaId);

  const response = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` },
  });

  if (!response.ok) {
    throw new Error(`Error descargando media: HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const arrayBuffer = await response.arrayBuffer();

  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType: contentType,
  };
}

// ── Marcar mensaje como leído ───────────────────────────
export async function markAsRead(messageId: string): Promise<void> {
  try {
    await callWhatsAppAPI("/messages", {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    });
  } catch (err) {
    // No es crítico si falla
    logger.debug({ messageId, err }, "No se pudo marcar como leído");
  }
}

// ── Envío masivo (usa el rate limiter interno) ──────────
export async function sendBulkMessages(
  recipients: Array<{ phone: string; message: string }>,
  delayMs = 50,
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

    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  logger.info(
    { sent: results.sent, failed: results.failed },
    "Envío masivo completado",
  );

  return results;
}

// ── Utilidades ──────────────────────────────────────────
/**
 * Formatea un número de teléfono para la API de WhatsApp.
 * Si ya tiene código de país (>10 dígitos o empieza con código conocido), lo deja.
 * Si parece argentino sin prefijo, agrega 54.
 */
function formatPhone(phone: string): string {
  const cleaned = phone.replace(/[\s\-\+\(\)]/g, "");

  // Ya tiene código de país (Argentina 54, Italia 39, etc.)
  if (cleaned.length > 10) return cleaned;

  // Número argentino sin prefijo internacional
  return `54${cleaned}`;
}
