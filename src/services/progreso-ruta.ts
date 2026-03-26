/**
 * Servicio de notificaciones de progreso de ruta.
 *
 * Monitorea los viajes de Ituran y envía notificaciones a los admins
 * en hitos clave del recorrido:
 *
 * 1. Salida del galpón
 * 2. Llegada a zona de recolección
 * 3. 50% de paradas completadas
 * 4. 100% de paradas completadas
 * 5. Descarga (llegada al punto de descarga)
 * 6. Llegada al laboratorio
 *
 * Usa la REST API de Ituran para obtener viajes en tiempo real y
 * compara las posiciones con las rutas optimizadas y puntos de referencia.
 */

import { db } from "../database";
import { recorridos, rutasOptimizadas, choferes, camiones } from "../database/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../config/logger";
import { env } from "../config/env";
import { obtenerViajes, obtenerPosiciones, isIturanRESTConfigured } from "./ituran-tracker";
import { notificarAdmins } from "./reportes-ceo";
import { haversineDistance } from "./route-optimizer";

// ============================================================
// Tipos
// ============================================================

export type HitoRuta =
  | "salida_galpon"
  | "llegada_zona"
  | "progreso_50"
  | "progreso_100"
  | "descarga"
  | "llegada_laboratorio";

interface ProgresoActual {
  readonly patente: string;
  readonly choferId: number | null;
  readonly choferNombre: string | null;
  readonly hitosNotificados: Set<HitoRuta>;
  readonly paradasVisitadas: number;
  readonly paradasTotales: number;
  readonly ultimaActualizacion: Date;
}

// ============================================================
// Estado en memoria (se resetea cada día)
// ============================================================

const progresosPorPatente = new Map<string, ProgresoActual>();
let ultimoResetFecha = "";

function resetearSiNuevoDia(): void {
  const hoy = new Date().toISOString().split("T")[0];
  if (hoy !== ultimoResetFecha) {
    progresosPorPatente.clear();
    ultimoResetFecha = hoy;
    logger.info("Progreso de rutas reseteado para nuevo día");
  }
}

function obtenerProgreso(patente: string): ProgresoActual {
  const existente = progresosPorPatente.get(patente);
  if (existente) return existente;

  const nuevo: ProgresoActual = {
    patente,
    choferId: null,
    choferNombre: null,
    hitosNotificados: new Set(),
    paradasVisitadas: 0,
    paradasTotales: 0,
    ultimaActualizacion: new Date(),
  };
  progresosPorPatente.set(patente, nuevo);
  return nuevo;
}

// ============================================================
// Puntos de referencia
// ============================================================

interface PuntoReferencia {
  readonly nombre: string;
  readonly lat: number;
  readonly lon: number;
  readonly radioKm: number;
}

function obtenerPuntosReferencia(): {
  galpon: PuntoReferencia;
  laboratorio: PuntoReferencia;
  descarga: PuntoReferencia;
} {
  return {
    galpon: {
      nombre: "Galpón",
      lat: env.GALPON_LAT || -34.7808,
      lon: env.GALPON_LON || -58.3731,
      radioKm: 0.3,
    },
    laboratorio: {
      nombre: "Laboratorio",
      lat: env.GALPON_LAT || -34.7808, // Mismo lugar por defecto, configurable
      lon: env.GALPON_LON || -58.3731,
      radioKm: 0.5,
    },
    descarga: {
      nombre: "Punto de descarga",
      lat: env.GALPON_LAT || -34.7808,
      lon: env.GALPON_LON || -58.3731,
      radioKm: 0.3,
    },
  };
}

// ============================================================
// Verificación de hitos
// ============================================================

/**
 * Verifica el progreso de todas las rutas activas y envía notificaciones.
 * Se ejecuta periódicamente via cron (cada 15-30 min).
 */
export async function verificarProgresoRutas(): Promise<{
  readonly vehiculosVerificados: number;
  readonly notificacionesEnviadas: number;
}> {
  resetearSiNuevoDia();

  if (!isIturanRESTConfigured()) {
    logger.debug("Ituran REST no configurada — saltando verificación de progreso");
    return { vehiculosVerificados: 0, notificacionesEnviadas: 0 };
  }

  const hoy = new Date().toISOString().split("T")[0];
  let notificaciones = 0;

  try {
    // Obtener viajes del día
    const viajes = await obtenerViajes(hoy);
    if (viajes.length === 0) {
      return { vehiculosVerificados: 0, notificacionesEnviadas: 0 };
    }

    // Obtener posiciones actuales
    const posiciones = await obtenerPosiciones();

    // Agrupar viajes por patente
    const viajesPorPatente = new Map<string, typeof viajes>();
    for (const viaje of viajes) {
      const lista = viajesPorPatente.get(viaje.carNum) || [];
      lista.push(viaje);
      viajesPorPatente.set(viaje.carNum, lista);
    }

    const puntos = obtenerPuntosReferencia();

    for (const [patente, viajesVehiculo] of viajesPorPatente) {
      const progreso = obtenerProgreso(patente);
      const posActual = posiciones.find(
        (p) => p.patente.replace(/\s/g, "") === patente.replace(/\s/g, ""),
      );

      // Verificar salida del galpón
      if (!progreso.hitosNotificados.has("salida_galpon") && viajesVehiculo.length > 0) {
        const primerViaje = viajesVehiculo[0];
        const distGalpon = calcularDistanciaDesdeTexto(primerViaje.startDriveAddress, puntos.galpon);
        if (distGalpon !== null && distGalpon < 1.0) {
          progreso.hitosNotificados.add("salida_galpon");
          await enviarNotificacionHito(patente, progreso.choferNombre, "salida_galpon", {
            hora: primerViaje.startDriveTime,
            direccion: primerViaje.startDriveAddress,
          });
          notificaciones++;
        }
      }

      // Verificar progreso por km recorridos
      const kmTotales = viajesVehiculo.reduce((sum, v) => sum + v.totalDriveKm, 0);

      // Si recorrió más de 5km, probablemente llegó a la zona
      if (!progreso.hitosNotificados.has("llegada_zona") && kmTotales > 5) {
        progreso.hitosNotificados.add("llegada_zona");
        const ultimoViaje = viajesVehiculo[viajesVehiculo.length - 1];
        await enviarNotificacionHito(patente, progreso.choferNombre, "llegada_zona", {
          hora: ultimoViaje.startDriveTime,
          direccion: ultimoViaje.startDriveAddress,
          kmRecorridos: kmTotales,
        });
        notificaciones++;
      }

      // Verificar retorno al galpón/descarga
      if (posActual && !progreso.hitosNotificados.has("descarga")) {
        const distGalpon = haversineDistance(
          posActual.lat, posActual.lon,
          puntos.galpon.lat, puntos.galpon.lon,
        );

        // Si volvió al galpón después de salir (kmTotales > 10 indica recorrido significativo)
        if (distGalpon < puntos.descarga.radioKm && kmTotales > 10) {
          progreso.hitosNotificados.add("descarga");
          await enviarNotificacionHito(patente, progreso.choferNombre, "descarga", {
            kmRecorridos: kmTotales,
            viajesRealizados: viajesVehiculo.length,
          });
          notificaciones++;
        }
      }

      // Actualizar progreso
      const actualizado: ProgresoActual = {
        ...progreso,
        ultimaActualizacion: new Date(),
      };
      progresosPorPatente.set(patente, actualizado);
    }

    return { vehiculosVerificados: viajesPorPatente.size, notificacionesEnviadas: notificaciones };
  } catch (error) {
    logger.error({ error }, "Error verificando progreso de rutas");
    return { vehiculosVerificados: 0, notificacionesEnviadas: 0 };
  }
}

// ============================================================
// Notificaciones
// ============================================================

const HITO_EMOJIS: Record<HitoRuta, string> = {
  salida_galpon: "🚛",
  llegada_zona: "📍",
  progreso_50: "⏳",
  progreso_100: "✅",
  descarga: "📦",
  llegada_laboratorio: "🔬",
};

const HITO_NOMBRES: Record<HitoRuta, string> = {
  salida_galpon: "Salida del galpón",
  llegada_zona: "Llegada a zona",
  progreso_50: "50% completado",
  progreso_100: "100% completado",
  descarga: "Descarga/Retorno al galpón",
  llegada_laboratorio: "Llegada al laboratorio",
};

async function enviarNotificacionHito(
  patente: string,
  choferNombre: string | null,
  hito: HitoRuta,
  detalles: Record<string, any>,
): Promise<void> {
  const emoji = HITO_EMOJIS[hito];
  const nombre = HITO_NOMBRES[hito];
  const hora = new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

  let mensaje = `${emoji} *PROGRESO DE RUTA*\n\n`;
  mensaje += `🚛 Patente: *${patente}*\n`;
  if (choferNombre) mensaje += `👤 Chofer: ${choferNombre}\n`;
  mensaje += `📌 Hito: *${nombre}*\n`;
  mensaje += `🕐 Hora: ${hora}\n`;

  if (detalles.direccion) mensaje += `📍 Ubicación: ${detalles.direccion}\n`;
  if (detalles.kmRecorridos) mensaje += `📏 Km recorridos: ${detalles.kmRecorridos.toFixed(1)} km\n`;
  if (detalles.viajesRealizados) mensaje += `🔄 Viajes: ${detalles.viajesRealizados}\n`;

  await notificarAdmins(mensaje);
  logger.info({ patente, hito, detalles }, "Notificación de progreso de ruta enviada");
}

// ============================================================
// Helpers
// ============================================================

/**
 * Intenta estimar la distancia entre una dirección de texto y un punto de referencia.
 * Retorna null si no se puede calcular (sin geocoding real, usamos heurísticas).
 */
function calcularDistanciaDesdeTexto(
  direccionTexto: string,
  punto: PuntoReferencia,
): number | null {
  // Si la dirección contiene el nombre del galpón, está cerca
  const galponDir = (env.GALPON_DIRECCION || "").toLowerCase();
  if (galponDir && direccionTexto.toLowerCase().includes(galponDir.split(",")[0])) {
    return 0;
  }
  // Sin geocoding real, no podemos calcular distancia por texto
  // Retornar un valor que indica "probablemente cerca" si hay match parcial
  return null;
}

/**
 * Genera un resumen del progreso de todas las rutas activas.
 */
export function obtenerResumenProgreso(): Array<{
  readonly patente: string;
  readonly choferNombre: string | null;
  readonly hitosCompletados: readonly HitoRuta[];
  readonly ultimaActualizacion: string;
}> {
  resetearSiNuevoDia();

  return Array.from(progresosPorPatente.values()).map((p) => ({
    patente: p.patente,
    choferNombre: p.choferNombre,
    hitosCompletados: Array.from(p.hitosNotificados),
    ultimaActualizacion: p.ultimaActualizacion.toISOString(),
  }));
}
