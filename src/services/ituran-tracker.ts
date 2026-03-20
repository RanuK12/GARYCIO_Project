/**
 * Servicio de seguimiento de camiones via Ituran.
 *
 * Ituran expone un Web Service SOAP (Service3.asmx) con la operación
 * GetFullReport que devuelve posición GPS, velocidad, rumbo, kilometraje,
 * patente, chofer, y geofencing de cada vehículo.
 *
 * Opciones de integración (en orden de preferencia):
 * 1. SOAP Web Service directo (usuario/contraseña de Ituran)
 * 2. pyituran via subprocess (librería Python open-source, MIT)
 * 3. flespi como middleware (REST + MQTT)
 *
 * PENDIENTE: credenciales de Ituran Argentina (0810-44-ITURAN).
 *
 * Este módulo está preparado con la interfaz lista; cuando tengamos
 * las credenciales, se conecta y funciona.
 */

import { db } from "../database";
import { camiones, rutasOptimizadas } from "../database/schema";
import { eq } from "drizzle-orm";
import { logger } from "../config/logger";
import { env } from "../config/env";
import { haversineDistance } from "./route-optimizer";

// ============================================================
// Tipos
// ============================================================

export interface PosicionVehiculo {
  patente: string;
  lat: number;
  lon: number;
  velocidad: number;       // km/h
  rumbo: number;            // 0-359 grados
  kilometraje: number;      // km totales
  direccionTexto: string;   // calle detectada por Ituran
  choferNombre: string | null;
  timestamp: Date;
}

export interface DesvioDetectado {
  patente: string;
  choferId: number | null;
  posicionActual: { lat: number; lon: number };
  paradaMasCercana: { lat: number; lon: number; orden: number };
  distanciaDesvioKm: number;
  rutaId: number;
  timestamp: Date;
}

export interface ComparacionRuta {
  rutaId: number;
  patente: string;
  porcentajeCumplimiento: number; // 0-100
  paradasVisitadas: number;
  paradasTotales: number;
  desviosDetectados: DesvioDetectado[];
  kmReales: number;
  kmOptimizados: number;
  eficiencia: number; // kmOptimizados / kmReales * 100
}

// ============================================================
// Configuración (se llena cuando tengamos credenciales)
// ============================================================

interface IturanConfig {
  // SOAP Web Service
  soapUrl?: string;        // ej: "https://web2.ituran.com.ar/ituranwebservice3/Service3.asmx"
  username?: string;
  password?: string;
  // O vía flespi
  flespiToken?: string;
  flespiChannelId?: string;
}

let config: IturanConfig = {};

export function configurarIturan(cfg: IturanConfig): void {
  config = cfg;
  logger.info("Ituran configurado");
}

export function isIturanConfigured(): boolean {
  return !!(config.soapUrl && config.username) || !!config.flespiToken;
}

// ============================================================
// Obtener posiciones (placeholder hasta tener credenciales)
// ============================================================

/**
 * Obtiene la posición actual de todos los vehículos.
 * Cuando tengamos las credenciales, esto llama al GetFullReport de Ituran.
 */
export async function obtenerPosiciones(): Promise<PosicionVehiculo[]> {
  if (!isIturanConfigured()) {
    logger.warn("Ituran no configurado - usando datos simulados");
    return obtenerPosicionesSimuladas();
  }

  if (config.soapUrl && config.username) {
    return obtenerPosicionesSOAP();
  }

  if (config.flespiToken) {
    return obtenerPosicionesFlespi();
  }

  return [];
}

/**
 * Obtiene la posición de un vehículo específico por patente.
 */
export async function obtenerPosicionVehiculo(patente: string): Promise<PosicionVehiculo | null> {
  const todas = await obtenerPosiciones();
  return todas.find((p) => p.patente.replace(/\s/g, "") === patente.replace(/\s/g, "")) || null;
}

// ============================================================
// SOAP Web Service (Service3.asmx)
// ============================================================

async function obtenerPosicionesSOAP(): Promise<PosicionVehiculo[]> {
  // TODO: Implementar cuando tengamos credenciales
  // El SOAP envelope para GetFullReport es:
  //
  // <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
  //                xmlns:tns="http://tempuri.org/">
  //   <soap:Body>
  //     <tns:GetFullReport>
  //       <tns:UserName>{username}</tns:UserName>
  //       <tns:Password>{password}</tns:Password>
  //     </tns:GetFullReport>
  //   </soap:Body>
  // </soap:Envelope>
  //
  // Respuesta incluye: Plate, Latitude, Longitude, Speed, Heading,
  // Mileage, Address, DateTimeUTC, DriverIdentification, GeoAreas
  //
  logger.info("SOAP GetFullReport llamado (pendiente implementación real)");
  return obtenerPosicionesSimuladas();
}

// ============================================================
// flespi como alternativa
// ============================================================

async function obtenerPosicionesFlespi(): Promise<PosicionVehiculo[]> {
  // TODO: Implementar con flespi REST API
  // GET https://flespi.io/gw/devices/{device_id}/telemetry/all
  // Headers: Authorization: FlespiToken {token}
  //
  // Campos parseados: position.latitude, position.longitude,
  // position.speed, position.direction, vehicle.mileage
  //
  logger.info("flespi telemetry llamado (pendiente implementación real)");
  return obtenerPosicionesSimuladas();
}

// ============================================================
// Datos simulados (para desarrollo y demos)
// ============================================================

function obtenerPosicionesSimuladas(): PosicionVehiculo[] {
  // Simular 3 camiones en la zona sur de Buenos Aires
  const base = { timestamp: new Date() };
  return [
    {
      ...base,
      patente: "AB 123 CD",
      lat: -34.7808 + (Math.random() - 0.5) * 0.01,
      lon: -58.3731 + (Math.random() - 0.5) * 0.01,
      velocidad: Math.floor(Math.random() * 40),
      rumbo: Math.floor(Math.random() * 360),
      kilometraje: 45230,
      direccionTexto: "Gral. José J. Arias 179, José Mármol",
      choferNombre: "Chofer Demo 1",
    },
    {
      ...base,
      patente: "EF 456 GH",
      lat: -34.7914 + (Math.random() - 0.5) * 0.01,
      lon: -58.3380 + (Math.random() - 0.5) * 0.01,
      velocidad: Math.floor(Math.random() * 40),
      rumbo: Math.floor(Math.random() * 360),
      kilometraje: 62100,
      direccionTexto: "Falucho 4396, Claypole",
      choferNombre: "Chofer Demo 2",
    },
    {
      ...base,
      patente: "IJ 789 KL",
      lat: -34.7730 + (Math.random() - 0.5) * 0.01,
      lon: -58.3371 + (Math.random() - 0.5) * 0.01,
      velocidad: 0,
      rumbo: 0,
      kilometraje: 38700,
      direccionTexto: "Bouchard 5648, Rafael Calzada",
      choferNombre: "Chofer Demo 3",
    },
  ];
}

// ============================================================
// Comparación de ruta real vs optimizada
// ============================================================

/**
 * Compara la posición actual de un camión con su ruta optimizada.
 * Detecta si se desvió más de X km de la ruta planificada.
 */
export function detectarDesvio(
  posicion: PosicionVehiculo,
  paradas: Array<{ lat: number; lon: number; orden: number }>,
  umbralKm: number = 1.5,
): DesvioDetectado | null {
  if (paradas.length === 0) return null;

  // Encontrar la parada más cercana
  let minDist = Infinity;
  let paradaCercana = paradas[0];

  for (const parada of paradas) {
    const dist = haversineDistance(posicion.lat, posicion.lon, parada.lat, parada.lon);
    if (dist < minDist) {
      minDist = dist;
      paradaCercana = parada;
    }
  }

  // Si está a más del umbral de la parada más cercana → desvío
  if (minDist > umbralKm) {
    return {
      patente: posicion.patente,
      choferId: null,
      posicionActual: { lat: posicion.lat, lon: posicion.lon },
      paradaMasCercana: { lat: paradaCercana.lat, lon: paradaCercana.lon, orden: paradaCercana.orden },
      distanciaDesvioKm: Math.round(minDist * 100) / 100,
      rutaId: 0,
      timestamp: new Date(),
    };
  }

  return null;
}

/**
 * Análisis completo: compara toda la ruta recorrida con la planificada.
 * Calcula % de cumplimiento y eficiencia en km.
 */
export function compararRutas(
  posicionesHistoricas: PosicionVehiculo[],
  paradas: Array<{ lat: number; lon: number; orden: number }>,
  rutaId: number,
  distanciaOptimizadaKm: number,
): ComparacionRuta {
  const desvios: DesvioDetectado[] = [];
  const paradasVisitadas = new Set<number>();
  const RADIO_VISITA_KM = 0.3; // 300m = se considera "visitada"

  // Para cada posición histórica, verificar si pasó cerca de alguna parada
  for (const pos of posicionesHistoricas) {
    for (const parada of paradas) {
      const dist = haversineDistance(pos.lat, pos.lon, parada.lat, parada.lon);
      if (dist <= RADIO_VISITA_KM) {
        paradasVisitadas.add(parada.orden);
      }
    }

    // Detectar desvíos
    const desvio = detectarDesvio(pos, paradas);
    if (desvio) {
      desvio.rutaId = rutaId;
      desvios.push(desvio);
    }
  }

  // Calcular km reales recorridos
  let kmReales = 0;
  for (let i = 1; i < posicionesHistoricas.length; i++) {
    kmReales += haversineDistance(
      posicionesHistoricas[i - 1].lat,
      posicionesHistoricas[i - 1].lon,
      posicionesHistoricas[i].lat,
      posicionesHistoricas[i].lon,
    );
  }

  const porcentaje = paradas.length > 0
    ? Math.round((paradasVisitadas.size / paradas.length) * 100)
    : 0;

  const eficiencia = kmReales > 0
    ? Math.round((distanciaOptimizadaKm / kmReales) * 100)
    : 100;

  return {
    rutaId,
    patente: posicionesHistoricas[0]?.patente || "N/A",
    porcentajeCumplimiento: porcentaje,
    paradasVisitadas: paradasVisitadas.size,
    paradasTotales: paradas.length,
    desviosDetectados: desvios,
    kmReales: Math.round(kmReales * 100) / 100,
    kmOptimizados: distanciaOptimizadaKm,
    eficiencia,
  };
}

// ============================================================
// Re-optimización desde posición actual
// ============================================================

/**
 * Si el camión se desvió, calcula una nueva ruta óptima desde
 * su posición actual hacia las paradas que le faltan.
 */
export function reoptimizarDesdeActual(
  posicionActual: { lat: number; lon: number },
  paradasRestantes: Array<{ id: number; nombre: string; direccion: string; lat: number; lon: number }>,
): Array<{ id: number; orden: number; lat: number; lon: number }> {
  if (paradasRestantes.length === 0) return [];

  // Usar nearest neighbor desde la posición actual
  const puntoActual = {
    id: -1,
    nombre: "Posición actual",
    direccion: "",
    lat: posicionActual.lat,
    lon: posicionActual.lon,
  };

  // Importar la función internamente para evitar circular
  const visited = new Set<number>();
  const route: typeof paradasRestantes = [];
  let current = puntoActual;

  for (let step = 0; step < paradasRestantes.length; step++) {
    let nearest = paradasRestantes[0];
    let minDist = Infinity;

    for (const p of paradasRestantes) {
      if (visited.has(p.id)) continue;
      const dist = haversineDistance(current.lat, current.lon, p.lat, p.lon);
      if (dist < minDist) {
        minDist = dist;
        nearest = p;
      }
    }

    if (!visited.has(nearest.id)) {
      route.push(nearest);
      visited.add(nearest.id);
      current = nearest;
    }
  }

  return route.map((p, i) => ({
    id: p.id,
    orden: i + 1,
    lat: p.lat,
    lon: p.lon,
  }));
}
