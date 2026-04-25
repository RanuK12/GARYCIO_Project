import { env } from "../config/env";
import { normalizePhone } from "../utils/phone";
import { logger } from "../config/logger";
import { isConversationWindowOpen } from "../services/whatsapp-window";
import { registerBotSentMessage } from "../services/bot-takeover";
import { recordRateLimitHit, isPhoneRateLimited } from "../services/rate-limit-adaptive";
import fs from "fs";

// ── Límites WhatsApp Cloud API (Meta) ────────────────────
// https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-list-messages
// Buttons: max 3. List: max 10 rows TOTALES (sumando todas las sections).
// row.title 24 / row.description 72 / button.title 20 / interactive body 1024
// text body 4096 / document caption 1024 / filename 240
// Violar => error 100 (permanente). Truncar y avisar es mejor que dropear.
export const WHATSAPP_LIMITS = {
  MAX_BUTTONS: 3,
  MAX_LIST_ROWS: 10,
  MAX_BUTTON_TITLE: 20,
  MAX_ROW_TITLE: 24,
  MAX_ROW_DESCRIPTION: 72,
  MAX_BODY: 1024,
  MAX_TEXT_BODY: 4096,
  MAX_DOC_CAPTION: 1024,
  MAX_DOC_FILENAME: 240,
} as const;

function clampStr(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

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

  const cleaned = normalizePhone(phone);
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

  // P0.10 — para envíos de mensajes, registrar el messageId como enviado
  // por el bot. Así cuando el webhook reciba el status outbound no lo
  // confunda con intervención humana.
  if (endpoint === "/messages") {
    const sentId = (data as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id;
    if (sentId) registerBotSentMessage(sentId);
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
    // 100    = invalid parameter
    // 131047 = re-engagement required (ventana 24h cerrada — P0.2)
    // 131056 = rate limit business/consumer pair (P0.2)
    return [131030, 132000, 131026, 100, 131047, 131056].includes(this.code);
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

  // P1.6 — backoff por phone si vino 131056 reciente: cortocircuito.
  if (retries === 0 && isPhoneRateLimited(to)) {
    const msg = `Rate limit activo para ${to}: backoff por 131056 reciente`;
    logger.warn({ phone: to }, msg);
    throw new WhatsAppAPIError(msg, 131056, 429);
  }

  // P0.3 — pre-check ventana 24h: si no hay inbound reciente, no intentar free-form.
  if (retries === 0) {
    const open = await isConversationWindowOpen(to);
    if (!open) {
      const msg = `Ventana 24h cerrada para ${to}: requiere template para re-engagement`;
      logger.warn({ phone: to }, msg);
      throw new WhatsAppAPIError(msg, 131047, 400);
    }
  }

  await rateLimitWait();

  // Guard: WhatsApp rechaza textos > 4096 chars (error 100). Clamp + log.
  let safeMessage = message;
  if (message.length > WHATSAPP_LIMITS.MAX_TEXT_BODY) {
    logger.error(
      { phone: to, length: message.length, max: WHATSAPP_LIMITS.MAX_TEXT_BODY },
      "sendMessage: texto excede 4096 chars — se trunca",
    );
    safeMessage = message.slice(0, WHATSAPP_LIMITS.MAX_TEXT_BODY - 1) + "…";
  }

  try {
    const result = await callWhatsAppAPI("/messages", {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: safeMessage },
    });

    logger.debug({ phone: to, preview: safeMessage.slice(0, 50) }, "Mensaje enviado");
    return result;
  } catch (err) {
    // No reintentar errores permanentes
    if (err instanceof WhatsAppAPIError && err.isPermanent) {
      // P1.6 — 131056: registrar backoff por teléfono
      if (err.code === 131056) recordRateLimitHit(to);
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

// ── Mensajes interactivos: botones (hasta 3) ───────────
export async function sendInteractiveButtons(
  phone: string,
  body: string,
  buttons: Array<{ id: string; title: string }>,
): Promise<any> {
  const to = formatPhone(phone);
  assertTestWhitelist(to);
  await rateLimitWait();

  // Guard: WhatsApp rechaza > 3 botones con error 100. Truncar + log.
  if (buttons.length > WHATSAPP_LIMITS.MAX_BUTTONS) {
    logger.error(
      { phone: to, count: buttons.length, max: WHATSAPP_LIMITS.MAX_BUTTONS },
      "sendInteractiveButtons: > 3 botones — se truncan al primero/segundo/tercero",
    );
    buttons = buttons.slice(0, WHATSAPP_LIMITS.MAX_BUTTONS);
  }
  const safeBody = clampStr(body, WHATSAPP_LIMITS.MAX_BODY);
  const safeButtons = buttons.map((b) => ({
    ...b,
    title: clampStr(b.title, WHATSAPP_LIMITS.MAX_BUTTON_TITLE),
  }));

  try {
    const result = await callWhatsAppAPI("/messages", {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: safeBody },
        action: {
          buttons: safeButtons.map((b) => ({
            type: "reply",
            reply: { id: b.id, title: b.title },
          })),
        },
      },
    });
    logger.debug({ phone: to, buttons: buttons.map((b) => b.id) }, "Botones enviados");
    return result;
  } catch (err) {
    logger.error({ phone: to, err }, "Error al enviar botones interactivos");
    throw err;
  }
}

// ── Mensajes interactivos: lista desplegable (hasta 10) ──
export async function sendInteractiveList(
  phone: string,
  body: string,
  buttonText: string,
  sections: Array<{
    title?: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }>,
): Promise<any> {
  const to = formatPhone(phone);
  assertTestWhitelist(to);
  await rateLimitWait();

  // Guard: WhatsApp permite máximo 10 rows TOTALES en una lista
  // (sumando todas las secciones). Truncar preservando orden.
  let totalRows = 0;
  const safeSections: typeof sections = [];
  for (const sec of sections) {
    if (totalRows >= WHATSAPP_LIMITS.MAX_LIST_ROWS) break;
    const remaining = WHATSAPP_LIMITS.MAX_LIST_ROWS - totalRows;
    const rows = sec.rows.slice(0, remaining).map((r) => ({
      id: r.id,
      title: clampStr(r.title, WHATSAPP_LIMITS.MAX_ROW_TITLE),
      ...(r.description !== undefined
        ? { description: clampStr(r.description, WHATSAPP_LIMITS.MAX_ROW_DESCRIPTION) }
        : {}),
    }));
    if (rows.length > 0) {
      safeSections.push({ ...sec, rows });
      totalRows += rows.length;
    }
  }
  const originalRows = sections.reduce((n, s) => n + s.rows.length, 0);
  if (originalRows > WHATSAPP_LIMITS.MAX_LIST_ROWS) {
    logger.error(
      { phone: to, originalRows, kept: totalRows, max: WHATSAPP_LIMITS.MAX_LIST_ROWS },
      "sendInteractiveList: lista excede 10 rows — se truncan los excedentes",
    );
  }
  const safeBody = clampStr(body, WHATSAPP_LIMITS.MAX_BODY);
  const safeButtonText = clampStr(buttonText, WHATSAPP_LIMITS.MAX_BUTTON_TITLE);

  try {
    const result = await callWhatsAppAPI("/messages", {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: safeBody },
        action: {
          button: safeButtonText,
          sections: safeSections,
        },
      },
    });
    logger.debug({ phone: to, sections: sections.length }, "Lista interactiva enviada");
    return result;
  } catch (err) {
    logger.error({ phone: to, err }, "Error al enviar lista interactiva");
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

    const safeFilename = clampStr(fileName, WHATSAPP_LIMITS.MAX_DOC_FILENAME);
    const safeCaption = caption
      ? clampStr(caption, WHATSAPP_LIMITS.MAX_DOC_CAPTION)
      : undefined;
    if (caption && caption.length > WHATSAPP_LIMITS.MAX_DOC_CAPTION) {
      logger.error(
        { phone: to, length: caption.length, max: WHATSAPP_LIMITS.MAX_DOC_CAPTION },
        "sendDocument: caption excede 1024 chars — se trunca",
      );
    }

    const result = await callWhatsAppAPI("/messages", {
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: {
        id: mediaId,
        filename: safeFilename,
        ...(safeCaption && { caption: safeCaption }),
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
  const mimeMap: Record<string, string> = {
    ".pdf": "application/pdf",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".csv": "text/csv",
  };
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  const mimeType = mimeMap[ext] || "application/octet-stream";

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
  const cleaned = normalizePhone(phone);

  // Ya tiene código de país (Argentina 54, Italia 39, etc.)
  if (cleaned.length > 10) return cleaned;

  // Número argentino sin prefijo internacional
  return `54${cleaned}`;
}
