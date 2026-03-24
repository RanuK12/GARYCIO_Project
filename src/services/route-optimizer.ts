import { db } from "../database";
import {
  donantes,
  zonas,
  subZonas,
  rutasOptimizadas,
  choferes,
  zonaChoferes,
} from "../database/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { logger } from "../config/logger";
import { env } from "../config/env";

interface Punto {
  id: number;
  nombre: string;
  direccion: string;
  lat: number;
  lon: number;
}

// ── Galpón: punto de partida y llegada de todos los camiones ──
const GALPON: Punto = {
  id: 0,
  nombre: "Galpón (Base)",
  direccion: env.GALPON_DIRECCION,
  lat: env.GALPON_LAT,
  lon: env.GALPON_LON,
};

interface RutaGenerada {
  subZonaId: number;
  choferId: number;
  paradas: Array<{ donanteId: number; orden: number; lat: number; lon: number }>;
  distanciaEstimadaKm: number;
  tiempoEstimadoMin: number;
}

// ── Asignación automática de sub-zonas ──────────────────

/**
 * Asigna donantes geocodificadas a sub-zonas usando clustering geográfico simple.
 * Divide cada zona en A (Lun/Mié/Vie) y B (Mar/Jue/Sáb) balanceando cantidad.
 *
 * Prerequisito: las donantes deben estar geocodificadas (lat/lng).
 */
export async function asignarSubZonas(): Promise<{
  zonasCreadas: number;
  donantesAsignadas: number;
}> {
  // Obtener todas las zonas activas
  const zonasActivas = await db
    .select({ id: zonas.id, nombre: zonas.nombre })
    .from(zonas)
    .where(eq(zonas.activa, true));

  let zonasCreadas = 0;
  let donantesAsignadas = 0;

  for (const zona of zonasActivas) {
    // Obtener donantes geocodificadas de esta zona
    const donantesList = await db
      .select({
        id: donantes.id,
        latitud: donantes.latitud,
        longitud: donantes.longitud,
      })
      .from(donantes)
      .where(
        and(
          eq(donantes.zonaId, zona.id),
          eq(donantes.geocodificado, true),
          eq(donantes.donandoActualmente, true),
        ),
      );

    if (donantesList.length === 0) continue;

    // Crear sub-zonas A y B si no existen
    const codigoA = `${zona.id}A`;
    const codigoB = `${zona.id}B`;

    for (const { codigo, dias } of [
      { codigo: codigoA, dias: "Lunes, Miércoles, Viernes" },
      { codigo: codigoB, dias: "Martes, Jueves, Sábado" },
    ]) {
      const exists = await db
        .select({ id: subZonas.id })
        .from(subZonas)
        .where(eq(subZonas.codigo, codigo))
        .limit(1);

      if (exists.length === 0) {
        await db.insert(subZonas).values({
          zonaId: zona.id,
          codigo,
          nombre: `${zona.nombre} - Sub-zona ${codigo.slice(-1)}`,
          diasRecoleccion: dias,
        });
        zonasCreadas++;
      }
    }

    // Dividir donantes en A y B geográficamente
    // Usamos la mediana de latitud para dividir norte/sur
    const lats = donantesList
      .map((d) => parseFloat(d.latitud || "0"))
      .sort((a, b) => a - b);
    const mediana = lats[Math.floor(lats.length / 2)];

    for (const donante of donantesList) {
      const lat = parseFloat(donante.latitud || "0");
      const subZonaCodigo = lat >= mediana ? codigoA : codigoB;

      await db
        .update(donantes)
        .set({ subZona: subZonaCodigo, updatedAt: new Date() })
        .where(eq(donantes.id, donante.id));
      donantesAsignadas++;
    }
  }

  logger.info({ zonasCreadas, donantesAsignadas }, "Asignación de sub-zonas completada");
  return { zonasCreadas, donantesAsignadas };
}

// ── Nearest Neighbor (heurística rápida) ────────────────

/**
 * Genera una ruta usando el algoritmo Nearest Neighbor.
 * Es una heurística simple pero efectiva como punto de partida.
 * En producción, OR-Tools con OSRM daría resultados mejores.
 */
export function nearestNeighborRoute(puntos: Punto[], inicio?: Punto): Punto[] {
  if (puntos.length <= 1) return inicio ? [inicio, ...puntos, inicio] : puntos;

  const visited = new Set<number>();
  const route: Punto[] = [];

  // Empezar desde el galpón (o punto de inicio indicado)
  let current = inicio || puntos[0];
  route.push(current);
  if (!inicio) visited.add(current.id);

  while (visited.size < puntos.length) {
    let nearest: Punto | null = null;
    let minDist = Infinity;

    for (const p of puntos) {
      if (visited.has(p.id)) continue;
      const dist = haversineDistance(current.lat, current.lon, p.lat, p.lon);
      if (dist < minDist) {
        minDist = dist;
        nearest = p;
      }
    }

    if (nearest) {
      route.push(nearest);
      visited.add(nearest.id);
      current = nearest;
    }
  }

  // Volver al galpón al final
  if (inicio) {
    route.push(inicio);
  }

  return route;
}

/**
 * Genera una ruta optimizada para una sub-zona y fecha específica.
 * Usa Nearest Neighbor como heurística base.
 */
export async function generarRutaParaSubZona(
  subZonaCodigo: string,
  fecha: string,
): Promise<RutaGenerada | null> {
  // Obtener sub-zona
  const subZona = await db
    .select({ id: subZonas.id, zonaId: subZonas.zonaId })
    .from(subZonas)
    .where(eq(subZonas.codigo, subZonaCodigo))
    .limit(1);

  if (subZona.length === 0) {
    logger.warn({ subZonaCodigo }, "Sub-zona no encontrada");
    return null;
  }

  // Obtener donantes de esta sub-zona
  const donantesList = await db
    .select({
      id: donantes.id,
      nombre: donantes.nombre,
      direccion: donantes.direccion,
      latitud: donantes.latitud,
      longitud: donantes.longitud,
    })
    .from(donantes)
    .where(
      and(
        eq(donantes.subZona, subZonaCodigo),
        eq(donantes.donandoActualmente, true),
        eq(donantes.geocodificado, true),
      ),
    );

  if (donantesList.length === 0) {
    logger.warn({ subZonaCodigo }, "Sin donantes geocodificadas en sub-zona");
    return null;
  }

  const puntos: Punto[] = donantesList.map((d) => ({
    id: d.id,
    nombre: d.nombre,
    direccion: d.direccion,
    lat: parseFloat(d.latitud || "0"),
    lon: parseFloat(d.longitud || "0"),
  }));

  // Optimizar con Nearest Neighbor (saliendo y volviendo al galpón)
  const rutaOptimizada = nearestNeighborRoute(puntos, GALPON);

  // Calcular distancia total (incluye ida desde galpón y vuelta)
  let distanciaTotal = 0;
  for (let i = 0; i < rutaOptimizada.length - 1; i++) {
    distanciaTotal += haversineDistance(
      rutaOptimizada[i].lat,
      rutaOptimizada[i].lon,
      rutaOptimizada[i + 1].lat,
      rutaOptimizada[i + 1].lon,
    );
  }

  // Obtener chofer asignado a la zona
  const chofer = await db
    .select({ choferId: zonaChoferes.choferId })
    .from(zonaChoferes)
    .where(
      and(
        eq(zonaChoferes.zonaId, subZona[0].zonaId),
        eq(zonaChoferes.activo, true),
      ),
    )
    .limit(1);

  const choferId = chofer.length > 0 ? chofer[0].choferId : 0;

  const paradas = rutaOptimizada.map((p, i) => ({
    donanteId: p.id,
    orden: i + 1,
    lat: p.lat,
    lon: p.lon,
  }));

  // Guardar en DB
  await db.insert(rutasOptimizadas).values({
    subZonaId: subZona[0].id,
    choferId,
    fecha,
    estado: "borrador",
    distanciaEstimadaKm: String(Math.round(distanciaTotal * 100) / 100),
    tiempoEstimadoMin: Math.round((distanciaTotal / 30) * 60), // ~30 km/h promedio urbano
    paradas,
    generadoPor: "nearest_neighbor",
  });

  logger.info(
    {
      subZonaCodigo,
      fecha,
      paradas: paradas.length,
      distanciaKm: Math.round(distanciaTotal * 100) / 100,
    },
    "Ruta generada",
  );

  return {
    subZonaId: subZona[0].id,
    choferId,
    paradas,
    distanciaEstimadaKm: Math.round(distanciaTotal * 100) / 100,
    tiempoEstimadoMin: Math.round((distanciaTotal / 30) * 60),
  };
}

// ── Utilidades geográficas ──────────────────────────────

/**
 * Calcula distancia entre dos puntos usando la fórmula de Haversine.
 * Retorna distancia en kilómetros.
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Radio de la Tierra en km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
