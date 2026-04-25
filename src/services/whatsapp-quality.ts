/**
 * Monitoreo de calidad del número de WhatsApp Business.
 *
 * 360dialog y Meta exponen un quality rating (GREEN / YELLOW / RED).
 * Si el rating cae a YELLOW o RED, Meta restringe la cantidad de
 * mensajes outbound — esto puede degradar el servicio sin que nadie
 * se entere hasta que llegan reclamos.
 *
 * Endpoint 360dialog:
 *   GET https://waba-v2.360dialog.io/v1/configs
 *   Headers: D360-API-KEY: <key>
 *   Devuelve: { quality_rating: "GREEN"|"YELLOW"|"RED", messaging_limit_tier: "TIER_1K"|... }
 *
 * (Meta directo usa /v22.0/{phone-number-id} con campos
 *  ?fields=quality_rating,messaging_limit_tier.)
 *
 * Política:
 *  - Si rating != GREEN, alertar admins (con dedup de 6h via notificarAdmins).
 *  - Tier change también se loguea como warn.
 */

import { env } from "../config/env";
import { logger } from "../config/logger";
import { notificarAdmins } from "./reportes-ceo";

export interface QualityInfo {
  qualityRating: "GREEN" | "YELLOW" | "RED" | "UNKNOWN";
  messagingLimitTier: string | null;
  rawResponse?: unknown;
  fetchedAt: string;
}

let lastInfo: QualityInfo | null = null;

const is360 = env.WHATSAPP_PROVIDER === "360dialog";

export async function fetchQualityRating(): Promise<QualityInfo> {
  const url = is360
    ? "https://waba-v2.360dialog.io/v1/configs"
    : `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}?fields=quality_rating,messaging_limit_tier`;

  const headers: Record<string, string> = is360
    ? { "D360-API-KEY": env.WHATSAPP_TOKEN }
    : { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` };

  const res = await fetch(url, { method: "GET", headers });
  const data = (await res.json().catch(() => ({}))) as Record<string, any>;

  if (!res.ok) {
    logger.warn({ status: res.status, data }, "fetchQualityRating: respuesta no-OK");
  }

  // 360dialog devuelve { phone_number: { quality_rating, ... } } o cosas similares
  // según versión. Buscamos en el árbol con tolerancia.
  const qr =
    (data?.quality_rating as string | undefined) ??
    (data?.phone_number?.quality_rating as string | undefined) ??
    (data?.data?.[0]?.quality_rating as string | undefined) ??
    "UNKNOWN";

  const tier =
    (data?.messaging_limit_tier as string | undefined) ??
    (data?.phone_number?.messaging_limit_tier as string | undefined) ??
    (data?.data?.[0]?.messaging_limit_tier as string | undefined) ??
    null;

  const info: QualityInfo = {
    qualityRating: ["GREEN", "YELLOW", "RED"].includes(qr) ? (qr as QualityInfo["qualityRating"]) : "UNKNOWN",
    messagingLimitTier: tier,
    rawResponse: data,
    fetchedAt: new Date().toISOString(),
  };

  lastInfo = info;
  return info;
}

export function getLastQualityInfo(): QualityInfo | null {
  return lastInfo;
}

/**
 * Verifica calidad y avisa a admins si !=GREEN.
 * `notificarAdmins` ya tiene dedup 5min por hash, así que llamar esto cada
 * 6h (scheduler) no spammea.
 */
export async function checkAndAlertQuality(): Promise<QualityInfo> {
  try {
    const info = await fetchQualityRating();
    if (info.qualityRating === "YELLOW" || info.qualityRating === "RED") {
      const emoji = info.qualityRating === "RED" ? "🔴" : "🟡";
      await notificarAdmins(
        `${emoji} *Calidad WhatsApp degradada*\n\n` +
          `Quality rating: *${info.qualityRating}*\n` +
          `Tier: ${info.messagingLimitTier ?? "—"}\n\n` +
          `Causa frecuente: muchos donantes bloquean/reportan al número. ` +
          `Recomendación: bajar volumen de difusión y revisar contenido.`,
      );
    } else if (info.qualityRating === "UNKNOWN") {
      logger.warn({ info }, "Quality rating UNKNOWN — la API no devolvió el campo esperado");
    } else {
      logger.info({ rating: info.qualityRating, tier: info.messagingLimitTier }, "WhatsApp quality OK");
    }
    return info;
  } catch (err) {
    logger.error({ err }, "checkAndAlertQuality falló");
    throw err;
  }
}
