import { db } from "../database";
import { donantes } from "../database/schema";
import { eq, and } from "drizzle-orm";
import { env } from "../config/env";
import { logger } from "../config/logger";

interface GeoResult {
  lat: number;
  lon: number;
  displayName: string;
}

/**
 * Geocodifica una dirección usando Nominatim (OpenStreetMap).
 * Gratis, pero con rate limit de 1 request/segundo.
 */
export async function geocodeAddress(address: string): Promise<GeoResult | null> {
  const query = `${address}, Argentina`;
  const url = new URL("/search", env.GEOCODING_BASE_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", env.GEOCODING_COUNTRY);

  try {
    const response = await fetch(url.toString(), {
      headers: { "User-Agent": "GARYCIO-System/1.0 (logistics bot)" },
    });

    if (!response.ok) {
      logger.error({ status: response.status, address }, "Error en geocoding API");
      return null;
    }

    const data = (await response.json()) as Array<{
      lat: string;
      lon: string;
      display_name: string;
    }>;

    if (data.length === 0) {
      logger.warn({ address }, "Dirección no encontrada en geocoding");
      return null;
    }

    return {
      lat: parseFloat(data[0].lat),
      lon: parseFloat(data[0].lon),
      displayName: data[0].display_name,
    };
  } catch (err) {
    logger.error({ address, err }, "Error geocodificando dirección");
    return null;
  }
}

/**
 * Geocodifica una donante específica y guarda lat/lng en la DB.
 */
export async function geocodeDonante(donanteId: number): Promise<boolean> {
  const result = await db
    .select({ id: donantes.id, direccion: donantes.direccion })
    .from(donantes)
    .where(eq(donantes.id, donanteId))
    .limit(1);

  if (result.length === 0) return false;

  const geo = await geocodeAddress(result[0].direccion);
  if (!geo) return false;

  await db
    .update(donantes)
    .set({
      latitud: String(geo.lat),
      longitud: String(geo.lon),
      geocodificado: true,
      updatedAt: new Date(),
    })
    .where(eq(donantes.id, donanteId));

  logger.debug({ donanteId, lat: geo.lat, lon: geo.lon }, "Donante geocodificada");
  return true;
}

/**
 * Geocodifica TODAS las donantes que aún no tienen coordenadas.
 * Respeta el rate limit de Nominatim (1 req/seg).
 * Devuelve estadísticas del proceso.
 */
export async function geocodeBatch(options?: {
  limit?: number;
  onProgress?: (done: number, total: number, failed: number) => void;
}): Promise<{ total: number; geocoded: number; failed: number }> {
  const { limit, onProgress } = options || {};

  let query = db
    .select({ id: donantes.id, direccion: donantes.direccion })
    .from(donantes)
    .where(and(eq(donantes.geocodificado, false), eq(donantes.donandoActualmente, true)));

  const pendientes = await (limit ? query.limit(limit) : query);
  const stats = { total: pendientes.length, geocoded: 0, failed: 0 };

  logger.info({ total: stats.total }, "Iniciando geocodificación batch");

  for (let i = 0; i < pendientes.length; i++) {
    const donante = pendientes[i];

    const geo = await geocodeAddress(donante.direccion);

    if (geo) {
      await db
        .update(donantes)
        .set({
          latitud: String(geo.lat),
          longitud: String(geo.lon),
          geocodificado: true,
          updatedAt: new Date(),
        })
        .where(eq(donantes.id, donante.id));
      stats.geocoded++;
    } else {
      stats.failed++;
    }

    onProgress?.(stats.geocoded, stats.total, stats.failed);

    // Rate limit: esperar entre requests
    if (i < pendientes.length - 1) {
      await new Promise((r) => setTimeout(r, env.GEOCODING_RATE_MS));
    }
  }

  logger.info(stats, "Geocodificación batch completada");
  return stats;
}
