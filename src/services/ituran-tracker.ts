/**
 * Servicio de seguimiento de camiones via Ituran.
 *
 * Ituran expone un Web Service SOAP (Service3.asmx) con operaciones:
 * - GetAllPlatformsData_JSON: posición actual de todos los vehículos
 * - GetFullReport_JSON: historial de posiciones por rango de fechas
 *
 * Namespace: http://www.ituran.com/ituranWebService3
 * URL: https://web2.ituran.com.ar/ituranwebservice3/Service3.asmx
 *
 * NOTA: El usuario necesita el permiso "CanUseWebserviceApi" habilitado
 * por Ituran. Sin esto, devuelve error de permisos.
 *
 * Configurar en .env:
 *   ITURAN_USER=garycio
 *   ITURAN_PASSWORD=***
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
// Configuración
// ============================================================

const ITURAN_SOAP_URL = "https://web2.ituran.com.ar/ituranwebservice3/Service3.asmx";
const ITURAN_NAMESPACE = "http://www.ituran.com/ituranWebService3";

export function isIturanConfigured(): boolean {
  return !!(env.ITURAN_USER && env.ITURAN_PASSWORD);
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
    logger.warn("Ituran no configurado (ITURAN_USER/ITURAN_PASSWORD vacíos) - usando datos simulados");
    return obtenerPosicionesSimuladas();
  }

  return obtenerPosicionesSOAP();
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

/**
 * Helper para llamar SOAP con el namespace correcto de Ituran.
 */
async function callIturanSOAP(action: string, bodyXml: string): Promise<string> {
  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:tns="${ITURAN_NAMESPACE}">
  <soap:Body>${bodyXml}</soap:Body>
</soap:Envelope>`;

  const response = await fetch(ITURAN_SOAP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "SOAPAction": `${ITURAN_NAMESPACE}/${action}`,
    },
    body: envelope,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ituran HTTP ${response.status}: ${text.substring(0, 200)}`);
  }

  return response.text();
}

/**
 * Obtiene posiciones actuales usando GetAllPlatformsData_JSON.
 * Retorna JSON directamente (más fácil de parsear que XML).
 */
async function obtenerPosicionesSOAP(): Promise<PosicionVehiculo[]> {
  try {
    const xml = await callIturanSOAP("GetAllPlatformsData_JSON", `
    <tns:GetAllPlatformsData_JSON>
      <tns:UserName>${env.ITURAN_USER}</tns:UserName>
      <tns:Password>${env.ITURAN_PASSWORD}</tns:Password>
      <tns:ShowAreas>false</tns:ShowAreas>
      <tns:ShowStatuses>true</tns:ShowStatuses>
      <tns:ShowMileageInMeters>true</tns:ShowMileageInMeters>
      <tns:ShowDriver>true</tns:ShowDriver>
    </tns:GetAllPlatformsData_JSON>`);

    // Extraer el JSON del wrapper XML
    const jsonMatch = xml.match(/<GetAllPlatformsData_JSONResult>([^<]+)/);
    if (!jsonMatch) {
      logger.error("Ituran: no se pudo extraer JSON de la respuesta");
      return obtenerPosicionesSimuladas();
    }

    const data = JSON.parse(jsonMatch[1]);

    // Verificar permisos
    if (data.ReturnCode && data.ReturnCode !== "OK" && data.ReturnCode !== "") {
      logger.error(`Ituran ReturnCode: ${data.ReturnCode}`);
      return obtenerPosicionesSimuladas();
    }

    return parsearVehiculosJSON(data.VehList || []);
  } catch (error) {
    logger.error({ error }, "Error conectando a Ituran SOAP");
    return obtenerPosicionesSimuladas();
  }
}

/**
 * Obtiene historial de posiciones usando GetFullReport_JSON.
 */
export async function obtenerHistorial(
  patente: string,
  desde: Date,
  hasta: Date,
  maxRegistros: number = 500,
): Promise<PosicionVehiculo[]> {
  if (!isIturanConfigured()) {
    logger.warn("Ituran no configurado - no hay historial disponible");
    return [];
  }

  const fmtDate = (d: Date) => d.toISOString().replace("T", " ").substring(0, 19);

  try {
    const xml = await callIturanSOAP("GetFullReport_JSON", `
    <tns:GetFullReport_JSON>
      <tns:UserName>${env.ITURAN_USER}</tns:UserName>
      <tns:Password>${env.ITURAN_PASSWORD}</tns:Password>
      <tns:Plate>${patente}</tns:Plate>
      <tns:Start>${fmtDate(desde)}</tns:Start>
      <tns:End>${fmtDate(hasta)}</tns:End>
      <tns:UAID>0</tns:UAID>
      <tns:MaxNumberOfRecords>${maxRegistros}</tns:MaxNumberOfRecords>
    </tns:GetFullReport_JSON>`);

    const jsonMatch = xml.match(/<GetFullReport_JSONResult>([^<]+)/);
    if (!jsonMatch) return [];

    const data = JSON.parse(jsonMatch[1]);
    if (data.ReturnCode && data.ReturnCode !== "OK" && data.ReturnCode !== "") {
      logger.error(`Ituran historial ReturnCode: ${data.ReturnCode}`);
      return [];
    }

    return (data.Records || []).map((r: any) => ({
      patente: r.Plate || patente,
      lat: r.Latitude || r.Lat || 0,
      lon: r.Longitude || r.Lon || r.Lng || 0,
      velocidad: r.Speed || 0,
      rumbo: r.Heading || r.Direction || 0,
      kilometraje: r.Mileage || r.Odometer || 0,
      direccionTexto: r.Address || r.Street || "",
      choferNombre: r.DriverIdentification || r.DriverName || null,
      timestamp: r.DateTimeUTC ? new Date(r.DateTimeUTC) : new Date(r.DateTime || Date.now()),
    }));
  } catch (error) {
    logger.error({ error }, "Error obteniendo historial de Ituran");
    return [];
  }
}

/**
 * Parsea la lista de vehículos del JSON de GetAllPlatformsData.
 */
function parsearVehiculosJSON(vehList: any[]): PosicionVehiculo[] {
  const vehiculos: PosicionVehiculo[] = [];

  for (const v of vehList) {
    const lat = v.Latitude || v.Lat || 0;
    const lon = v.Longitude || v.Lon || v.Lng || 0;

    if (lat === 0 && lon === 0) continue;

    vehiculos.push({
      patente: v.Plate || v.LicensePlate || v.VehicleName || "N/A",
      lat,
      lon,
      velocidad: v.Speed || 0,
      rumbo: v.Heading || v.Direction || 0,
      kilometraje: v.Mileage || v.MileageInMeters ? (v.MileageInMeters || 0) / 1000 : v.Mileage || 0,
      direccionTexto: v.Address || v.Street || "",
      choferNombre: v.DriverIdentification || v.DriverName || null,
      timestamp: v.DateTimeUTC ? new Date(v.DateTimeUTC) : new Date(v.DateTime || Date.now()),
    });
  }

  logger.info(`Ituran: ${vehiculos.length} vehículos obtenidos vía API`);
  return vehiculos;
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
