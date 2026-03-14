import cron from "node-cron";
import { sendMessage, sendDocument } from "../bot/client";
import { logger } from "../config/logger";
import { env } from "../config/env";
import { generarReportePDF } from "./reporte-pdf";
import fs from "fs";

/**
 * Flag para evitar enviar el automático si ya se envió on-demand hoy.
 */
let reporteEnviadoHoy = false;

/**
 * Servicio de reporte diario para CEO.
 * Envía un PDF profesional con gráficos a las 7:00 AM (hora Argentina).
 *
 * Si el CEO pide el reporte manualmente ("reporte"), se envía al instante
 * y se salta el envío automático del día.
 */
export function initReporteDiario(): void {
  // Enviar PDF todos los días a las 19:00 (fin de jornada)
  cron.schedule("0 19 * * *", async () => {
    if (reporteEnviadoHoy) {
      logger.info("Reporte ya fue enviado on-demand hoy, saltando el automático");
      reporteEnviadoHoy = false; // Reset para mañana
      return;
    }

    await enviarReportePDF();
  });

  // Reset del flag a medianoche
  cron.schedule("0 0 * * *", () => {
    reporteEnviadoHoy = false;
  });

  logger.info("Reporte diario PDF programado para las 19:00 hs");
}

/**
 * Genera y envía el reporte PDF al CEO.
 * Puede llamarse manualmente desde el bot o automáticamente.
 */
export async function enviarReportePDF(): Promise<void> {
  logger.info("Generando reporte PDF diario...");

  try {
    const filePath = await generarReportePDF();
    const fecha = new Date().toLocaleDateString("es-AR");

    await sendDocument(
      env.CEO_PHONE,
      filePath,
      `GARYCIO_Reporte_${fecha.replace(/\//g, "-")}.pdf`,
      `📊 Reporte diario GARYCIO - ${fecha}`,
    );

    reporteEnviadoHoy = true;
    logger.info("Reporte PDF enviado al CEO");
  } catch (err) {
    logger.error({ err }, "Error al generar/enviar reporte PDF");

    // Fallback: enviar mensaje de texto si falla el PDF
    await sendMessage(
      env.CEO_PHONE,
      "⚠️ No se pudo generar el reporte PDF de hoy. " +
        "El equipo técnico fue notificado. Enviá *reporte* para reintentarlo.",
    );
  }
}

/**
 * Marca que el reporte on-demand fue enviado para evitar duplicado automático.
 */
export function marcarReporteEnviado(): void {
  reporteEnviadoHoy = true;
}
