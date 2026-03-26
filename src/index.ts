import express from "express";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { testConnection } from "./database";
import { createWebhookRouter } from "./bot";
import { initScheduler } from "./services/scheduler";
import { initReporteDiario } from "./services/reporte-diario";
import { getDLQStats, retryDeadLetterQueue } from "./services/dead-letter-queue";
import { geocodeBatch } from "./services/geocoding";
import { asignarSubZonas, generarRutaParaSubZona } from "./services/route-optimizer";
import { enviarAsignacionDias } from "./services/mensajeria-masiva";
import { generarResumenCEO, generarReporteCEOPDF } from "./services/reportes-ceo";
import {
  obtenerPosiciones,
  obtenerPosicionVehiculo,
  detectarDesvio,
  isIturanConfigured,
  isIturanRESTConfigured,
  obtenerViajes,
  detectarExcesoVelocidad,
  formatearAlertaVelocidad,
} from "./services/ituran-tracker";
import { notificarAdmins } from "./services/reportes-ceo";
import { enviarEncuestaMensual } from "./services/encuesta-regalo";
import { db } from "./database";
import { donantes, reclamos, avisos, reportesBaja } from "./database/schema";
import { eq, and, gte, lte, or, ilike, sql } from "drizzle-orm";

const startTime = new Date();
let requestCount = 0;
let webhookCount = 0;
let errorCount = 0;

async function main(): Promise<void> {
  logger.info("Iniciando GARYCIO System...");

  // ── Base de datos ───────────────────────────────────
  const dbOk = await testConnection();
  if (!dbOk) {
    logger.fatal("No se pudo conectar a la base de datos. Abortando.");
    process.exit(1);
  }

  // ── Servidor Express ────────────────────────────────
  const app = express();

  // Request logging middleware
  app.use((req, res, next) => {
    requestCount++;
    const start = Date.now();
    res.on("finish", () => {
      const duration = Date.now() - start;
      if (req.path !== "/health" && req.path !== "/metrics") {
        logger.info(
          { method: req.method, path: req.path, status: res.statusCode, duration },
          "HTTP request",
        );
      }
      if (req.path === "/webhook" && req.method === "POST") {
        webhookCount++;
      }
      if (res.statusCode >= 400) {
        errorCount++;
      }
    });
    next();
  });

  app.use(express.json());

  // Webhook de WhatsApp
  app.use(createWebhookRouter());

  // ── Health check completo ─────────────────────────
  app.get("/health", async (_req, res) => {
    let dbStatus = "ok";
    try {
      const dbCheck = await testConnection();
      if (!dbCheck) dbStatus = "error";
    } catch {
      dbStatus = "error";
    }

    const dlqStats = await getDLQStats().catch(() => null);
    const mem = process.memoryUsage();

    const status = dbStatus === "ok" ? "ok" : "degraded";

    res.status(status === "ok" ? 200 : 503).json({
      status,
      uptime: process.uptime(),
      startedAt: startTime.toISOString(),
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || "0.2.0",
      database: dbStatus,
      counters: {
        totalRequests: requestCount,
        webhooksProcessed: webhookCount,
        errors: errorCount,
      },
      deadLetterQueue: dlqStats,
      memory: {
        rss: `${Math.round(mem.rss / 1024 / 1024)} MB`,
        heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)} MB`,
        heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)} MB`,
      },
    });
  });

  // ── Métricas básicas ─────────────────────────────
  app.get("/metrics", (_req, res) => {
    const mem = process.memoryUsage();
    res.json({
      uptime: process.uptime(),
      startedAt: startTime.toISOString(),
      counters: {
        totalRequests: requestCount,
        webhooksProcessed: webhookCount,
        errors: errorCount,
      },
      memory: {
        rss: `${Math.round(mem.rss / 1024 / 1024)} MB`,
        heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)} MB`,
        heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)} MB`,
      },
    });
  });

  // ── Endpoints administrativos ────────────────────
  app.post("/admin/dlq/retry", async (_req, res) => {
    try {
      const result = await retryDeadLetterQueue();
      res.json({ status: "ok", ...result });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  app.post("/admin/geocode", async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    try {
      const result = await geocodeBatch({ limit });
      res.json({ status: "ok", ...result });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  app.post("/admin/subzonas/asignar", async (_req, res) => {
    try {
      const result = await asignarSubZonas();
      res.json({ status: "ok", ...result });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  app.post("/admin/rutas/generar", async (req, res) => {
    const { subZona, fecha } = req.body as { subZona?: string; fecha?: string };
    if (!subZona || !fecha) {
      res.status(400).json({ error: "Se requiere subZona y fecha" });
      return;
    }
    try {
      const result = await generarRutaParaSubZona(subZona, fecha);
      if (!result) {
        res.status(404).json({ error: "Sin donantes o sub-zona no encontrada" });
        return;
      }
      res.json({ status: "ok", ...result });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  app.post("/admin/enviar-dias", async (req, res) => {
    const { subZona } = req.body as { subZona?: string };
    if (!subZona) {
      res.status(400).json({ error: "Se requiere subZona" });
      return;
    }
    try {
      const result = await enviarAsignacionDias(subZona);
      res.json({ status: "ok", ...result });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  // ── Reportes para CEO ──────────────────────────────
  app.get("/admin/ceo/resumen", async (req, res) => {
    const dias = parseInt(req.query.dias as string) || 30;
    try {
      const resumen = await generarResumenCEO(dias);
      res.json({ status: "ok", ...resumen });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  app.get("/admin/ceo/reporte.pdf", async (req, res) => {
    const dias = parseInt(req.query.dias as string) || 30;
    try {
      const pdf = await generarReporteCEOPDF(dias);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="reporte-ceo-${new Date().toISOString().split("T")[0]}.pdf"`);
      res.send(pdf);
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  // ── Tracking de camiones (Ituran) ─────────────────────
  app.get("/admin/tracking/posiciones", async (_req, res) => {
    try {
      const posiciones = await obtenerPosiciones();
      res.json({
        status: "ok",
        ituranConectado: isIturanConfigured(),
        galpon: {
          direccion: env.GALPON_DIRECCION,
          lat: env.GALPON_LAT,
          lon: env.GALPON_LON,
        },
        vehiculos: posiciones,
      });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  app.get("/admin/tracking/vehiculo/:patente", async (req, res) => {
    try {
      const pos = await obtenerPosicionVehiculo(req.params.patente);
      if (!pos) {
        res.status(404).json({ error: "Vehículo no encontrado" });
        return;
      }
      res.json({ status: "ok", vehiculo: pos });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  // ── Consulta de donantes ─────────────────────────────
  app.get("/admin/donantes/buscar", async (req, res) => {
    const q = (req.query.q as string || "").trim();
    if (q.length < 2) {
      res.status(400).json({ error: "Búsqueda muy corta (mínimo 2 caracteres)" });
      return;
    }
    try {
      const resultados = await db
        .select()
        .from(donantes)
        .where(
          or(
            ilike(donantes.nombre, `%${q}%`),
            ilike(donantes.telefono, `%${q}%`),
            ilike(donantes.direccion, `%${q}%`),
          ),
        )
        .limit(50);
      res.json({ status: "ok", total: resultados.length, donantes: resultados });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  app.get("/admin/donantes/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    try {
      const [donante] = await db.select().from(donantes).where(eq(donantes.id, id)).limit(1);
      if (!donante) {
        res.status(404).json({ error: "Donante no encontrada" });
        return;
      }
      const histReclamos = await db.select().from(reclamos).where(eq(reclamos.donanteId, id));
      const histAvisos = await db.select().from(avisos).where(eq(avisos.donanteId, id));
      const histBajas = await db.select().from(reportesBaja).where(eq(reportesBaja.donanteId, id));
      res.json({ status: "ok", donante, reclamos: histReclamos, avisos: histAvisos, reportesBaja: histBajas });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  app.get("/admin/donantes/altas-bajas", async (req, res) => {
    const desde = req.query.desde as string || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const hasta = req.query.hasta as string || new Date().toISOString().split("T")[0];
    try {
      const altas = await db.select().from(donantes).where(
        and(gte(donantes.fechaAlta, desde), lte(donantes.fechaAlta, hasta)),
      );
      const bajas = await db.select().from(reportesBaja).where(
        and(gte(sql`${reportesBaja.fecha}::date`, desde), lte(sql`${reportesBaja.fecha}::date`, hasta)),
      );
      res.json({ status: "ok", periodo: { desde, hasta }, altas: altas.length, bajas: bajas.length, detalleAltas: altas, detalleBajas: bajas });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  // ── Ituran REST API (viajes) ──────────────────────────
  app.get("/admin/ituran/viajes", async (req, res) => {
    const fecha = req.query.fecha as string || new Date().toISOString().split("T")[0];
    try {
      const viajes = await obtenerViajes(fecha);
      res.json({ status: "ok", fecha, total: viajes.length, viajes });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  app.get("/admin/ituran/velocidad", async (req, res) => {
    const fecha = req.query.fecha as string || new Date().toISOString().split("T")[0];
    try {
      const viajes = await obtenerViajes(fecha);
      const excesos = detectarExcesoVelocidad(viajes);
      res.json({
        status: "ok",
        fecha,
        limiteKmh: env.SPEED_LIMIT_KMH,
        totalViajes: viajes.length,
        excesos: excesos.length,
        detalle: excesos.map((v) => ({
          patente: v.carNum,
          velocidadMax: v.fastestDriveSpeed,
          desde: v.startDriveAddress,
          hasta: v.endDriveAddress,
          hora: `${v.startDriveTime} - ${v.endDriveTime}`,
          km: v.totalDriveKm,
        })),
      });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  // ── Encuesta mensual ────────────────────────────────
  app.post("/admin/encuesta/enviar", async (req, res) => {
    const cantidad = parseInt(req.query.cantidad as string) || 1000;
    try {
      const result = await enviarEncuestaMensual(cantidad);
      res.json({ status: "ok", ...result });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "Servidor HTTP iniciado");
  });

  // ── Tareas programadas ──────────────────────────────
  initScheduler();
  initReporteDiario();

  // ── Estado de integraciones ───────────────────────
  if (isIturanConfigured()) {
    logger.info("Ituran SOAP (real-time): CONECTADO");
  } else {
    logger.warn("Ituran SOAP: NO CONFIGURADO");
  }
  if (isIturanRESTConfigured()) {
    logger.info("Ituran REST API (viajes): CONECTADO");
  } else {
    logger.warn("Ituran REST API: NO CONFIGURADO");
  }

  logger.info({ port: env.PORT }, "GARYCIO System iniciado correctamente");

  // ── Graceful shutdown ───────────────────────────────
  const shutdown = (signal: string) => {
    logger.info({ signal }, "Señal de apagado recibida. Cerrando...");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Excepción no capturada");
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "Promesa rechazada sin manejar");
  });
}

main().catch((err) => {
  logger.fatal(err, "Error fatal al iniciar");
  process.exit(1);
});
