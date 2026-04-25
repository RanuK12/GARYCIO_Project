import express from "express";
import { env } from "./config/env";
import { audioMensajes } from "./database/schema";
import { logger } from "./config/logger";
import { testConnection } from "./database";
import { resetConversationalStateOnStart } from "./bot/conversation-manager";
import { createWebhookRouter } from "./bot";
import { initScheduler } from "./services/scheduler";
import { initReporteDiario } from "./services/reporte-diario";
import { getDLQStats, retryDeadLetterQueue } from "./services/dead-letter-queue";
import { geocodeBatch } from "./services/geocoding";
import { asignarSubZonas, generarRutaParaSubZona } from "./services/route-optimizer";
import { enviarAsignacionDias, enviarDifusionPorRutas, enviarDifusionNueva } from "./services/mensajeria-masiva";
import { sendMessage, sendTemplate } from "./bot/client";
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
import { verificarProgresoRutas, obtenerResumenProgreso } from "./services/progreso-ruta";
import { resolveHumanEscalation, isHumanEscalated } from "./services/human-escalation";
import {
  getBotState,
  pauseBot,
  resumeBot,
  emergencyStop,
  setWhitelistLimit,
  getWhitelistLimit,
  isWhitelistActive,
  ROLLOUT_PLAN,
  notifyAdminsCritical,
  getCapacidad,
  ajustarLimiteDonantes,
  liberarDonanteBot,
} from "./services/bot-control";
import {
  addTrainingExample,
  listTrainingExamples,
  toggleTrainingExample,
  deleteTrainingExample,
} from "./services/ia-training";
import { db } from "./database";
import { donantes, reclamos, avisos, reportesBaja, difusionEnvios, donantesBotActivos, configuracionSistema } from "./database/schema";
import { eq, and, gte, lte, or, ilike, sql, isNull, count, desc } from "drizzle-orm";

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

  app.use(express.json({ limit: "5mb" })); // 360dialog puede mandar webhooks con media embebida

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

  // ── Autenticación para endpoints admin ───────────
  app.use("/admin", (req, res, next) => {
    const key = req.headers["x-admin-key"] as string | undefined;
    if (!key || key !== env.ADMIN_API_KEY) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });

  // ── Bot Control
  app.get("/admin/bot/status", (_req, res) => {
    const state = getBotState();
    const mem = process.memoryUsage();
    res.json({ status: "ok", bot: state, uptime: process.uptime(), memory: { rss: ""+Math.round(mem.rss/1024/1024)+" MB", heapUsed: ""+Math.round(mem.heapUsed/1024/1024)+" MB" }, pm2: "Use pm2 describe garycio-bot" });
  });
  app.post("/admin/bot/pause", (req, res) => { pauseBot("admin_api", req.body.reason || "Mantenimiento"); res.json({status:"ok",action:"paused"}); });
  app.post("/admin/bot/resume", (_req, res) => { resumeBot("admin_api"); res.json({status:"ok",action:"resumed"}); });
  app.post("/admin/bot/emergency-stop", (req, res) => { emergencyStop(req.body.reason || "Admin"); res.json({status:"ok",action:"emergency_stop"}); });
  app.get("/admin/bot/whitelist", (_req, res) => { res.json({ status: "ok", active: isWhitelistActive(), currentLimit: getWhitelistLimit(), rolloutPlan: ROLLOUT_PLAN, testMode: env.TEST_MODE }); });
  app.post("/admin/bot/whitelist", async (req, res) => { const limit = req.body.limit; if (typeof limit !== "number" || limit < 0) { res.status(400).json({error:"limit >= 0"}); return; } await setWhitelistLimit(limit); res.json({status:"ok",limit}); });

  // ── Capacidad controlada ──────────────────────────
  app.get("/admin/capacidad", async (_req, res) => {
    try {
      const cap = await getCapacidad();
      res.json({ status: "ok", ...cap, porcentaje: Math.round((cap.activos / cap.limite) * 100) });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  app.post("/admin/capacidad", async (req, res) => {
    const limite = req.body.limite;
    if (typeof limite !== "number" || limite < 0) {
      res.status(400).json({ error: "limite >= 0 requerido" });
      return;
    }
    try {
      await ajustarLimiteDonantes(limite);
      const cap = await getCapacidad();
      res.json({ status: "ok", nuevoLimite: limite, ...cap });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  app.get("/admin/donantes-activos", async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const estado = (req.query.estado as string) || "activo";
      const offset = (page - 1) * limit;

      const data = await db.select().from(donantesBotActivos)
        .where(eq(donantesBotActivos.estado, estado as any))
        .orderBy(desc(donantesBotActivos.activadoEn))
        .limit(limit).offset(offset);

      const countResult = await db.select({ value: count() }).from(donantesBotActivos)
        .where(eq(donantesBotActivos.estado, estado as any));

      res.json({ status: "ok", page, limit, total: countResult[0]?.value ?? 0, data });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  app.delete("/admin/donantes-activos/:telefono", async (req, res) => {
    try {
      const telefono = req.params.telefono;
      await liberarDonanteBot(telefono);
      res.json({ status: "ok", telefono, accion: "liberado" });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  // ── Audios pendientes ─────────────────────────────
  app.get("/admin/audios-pendientes", async (_req, res) => {
    try {
      const pendientes = await db
        .select()
        .from(audioMensajes)
        .where(eq(audioMensajes.atendido, false))
        .orderBy(desc(audioMensajes.createdAt))
        .limit(50);
      res.json({ status: "ok", count: pendientes.length, data: pendientes });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  app.post("/admin/audios-pendientes/:id/atender", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await db
        .update(audioMensajes)
        .set({ atendido: true, atendidoPor: req.body.atendidoPor || "admin_api", updatedAt: new Date() })
        .where(eq(audioMensajes.id, id));
      res.json({ status: "ok", id, atendido: true });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  app.post("/admin/db/query", async (req, res) => { const q = req.body.query; if (!q || typeof q !== "string") { res.status(400).json({error:"query required"}); return; } const t = q.trim().toLowerCase(); if (!t.startsWith("select ") && !t.startsWith("with ")) { res.status(403).json({error:"SELECT only"}); return; } const bad = ["drop","delete","truncate","insert","update","alter","create","grant"]; for (const w of bad) { if (t.includes(w)) { res.status(403).json({error:"bad word: "+w}); return; } } try { const r = await db.execute(q); res.json({status:"ok",rows:r.rows}); } catch (e) { res.status(500).json({status:"error",error:(e as Error).message}); } });

  // ── IA Training ───────────────────────────────────
  app.get("/admin/ia-training", async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const intencion = req.query.intencion as string | undefined;
    try {
      const result = await listTrainingExamples({ limit, offset, intencion });
      res.json({ status: "ok", ...result });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  app.post("/admin/ia-training", async (req, res) => {
    const { mensajeUsuario, intencionCorrecta, respuestaEsperada, contexto, prioridad } = req.body;
    if (!mensajeUsuario || !intencionCorrecta) {
      res.status(400).json({ error: "mensajeUsuario e intencionCorrecta son requeridos" });
      return;
    }
    try {
      const id = await addTrainingExample({
        mensajeUsuario,
        intencionCorrecta,
        respuestaEsperada,
        contexto,
        prioridad: prioridad ?? 0,
        creadoPor: "admin_api",
      });
      res.json({ status: "ok", id });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  app.post("/admin/ia-training/:id/toggle", async (req, res) => {
    const id = parseInt(req.params.id);
    const { activo } = req.body as { activo: boolean };
    try {
      await toggleTrainingExample(id, activo);
      res.json({ status: "ok", id, activo });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  app.delete("/admin/ia-training/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    try {
      await deleteTrainingExample(id);
      res.json({ status: "ok", id });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
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

  // ── Envío masivo por rutas OptimoRoute ──────────────
  app.post("/admin/enviar-rutas", async (req, res) => {
    const { ruta, dias, chofer, limite, telefonos } = req.body as {
      ruta?: string;
      dias?: string;
      chofer?: number;
      limite?: number;
      telefonos?: string[];
    };
    try {
      const result = await enviarDifusionPorRutas({ ruta, dias, chofer, limite, telefonos: telefonos ? new Set(telefonos) : undefined });
      res.json({ status: "ok", ...result });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  // ── Envío de mensaje de prueba a número específico ─────
  app.post("/admin/test-mensaje", async (req, res) => {
    const { telefono, nombre, dias, horario } = req.body as {
      telefono: string;
      nombre?: string;
      dias?: string;
      horario?: string;
    };
    if (!telefono) {
      res.status(400).json({ error: "Se requiere telefono" });
      return;
    }
    try {
      await sendTemplate(telefono, env.DIFUSION_TEMPLATE_NAME, "es_AR", [
        {
          type: "body",
          parameters: [
            { type: "text", text: nombre ?? "Donante" },
            { type: "text", text: dias ?? "Lunes y Jueves" },
            { type: "text", text: horario ?? "08:00" },
          ],
        },
      ]);
      res.json({ status: "ok", telefono, nombre, dias, horario });
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

  // ── Contactos nuevos (auto-registrados) ──────────────
  app.get("/admin/donantes/nuevos", async (_req, res) => {
    try {
      const nuevos = await db
        .select()
        .from(donantes)
        .where(and(eq(donantes.estado, "nueva"), eq(donantes.donandoActualmente, false)))
        .orderBy(sql`${donantes.createdAt} DESC`)
        .limit(50);
      res.json({ status: "ok", total: nuevos.length, contactos: nuevos });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  // IMPORTANTE: rutas parametrizadas DESPUES de las estaticas
  app.get("/admin/donantes/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "ID debe ser un numero" });
      return;
    }
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

  // ── Progreso de rutas ─────────────────────────────
  app.get("/admin/rutas/progreso", async (_req, res) => {
    try {
      const resumen = obtenerResumenProgreso();
      res.json({ status: "ok", vehiculos: resumen });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  app.post("/admin/rutas/verificar-progreso", async (_req, res) => {
    try {
      const result = await verificarProgresoRutas();
      res.json({ status: "ok", ...result });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  // ── Escalaciones humanas ───────────────────────────
  app.get("/admin/human-escalations", async (_req, res) => {
    try {
      const { humanEscalations } = await import("./database/schema");
      const rows = await db.select().from(humanEscalations).orderBy(desc(humanEscalations.escalatedAt)).limit(100);
      res.json({ status: "ok", total: rows.length, escalations: rows });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  app.post("/admin/human-escalations/resolve", async (req, res) => {
    const { phone, resolvedBy } = req.body as { phone?: string; resolvedBy?: string };
    if (!phone || !resolvedBy) {
      res.status(400).json({ error: "Se requiere phone y resolvedBy" });
      return;
    }
    try {
      await resolveHumanEscalation(phone, resolvedBy);
      res.json({ status: "ok", phone, resolvedBy });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  app.get("/admin/human-escalations/check/:phone", async (req, res) => {
    try {
      const escalated = await isHumanEscalated(req.params.phone);
      res.json({ status: "ok", phone: req.params.phone, escalated });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  // ── Difusión — tracking de confirmaciones ───────────
  app.get("/admin/difusion/stats", async (_req, res) => {
    try {
      const [total] = await db.select({ total: count() }).from(difusionEnvios);
      const [confirmados] = await db
        .select({ total: count() })
        .from(difusionEnvios)
        .where(eq(difusionEnvios.confirmado, true));
      const totalNum = Number(total.total);
      const confirmadosNum = Number(confirmados.total);
      res.json({
        status: "ok",
        total: totalNum,
        confirmados: confirmadosNum,
        pendientes: totalNum - confirmadosNum,
        porcentaje: totalNum > 0 ? Math.round((confirmadosNum / totalNum) * 100) : 0,
      });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  app.get("/admin/difusion/pendientes", async (req, res) => {
    const horas = parseInt(req.query.horas as string) || 0;
    try {
      const condiciones = [eq(difusionEnvios.confirmado, false)];
      if (horas > 0) {
        const corte = new Date(Date.now() - horas * 60 * 60 * 1000);
        condiciones.push(lte(difusionEnvios.fechaEnvio, corte));
      }
      const pendientes = await db
        .select()
        .from(difusionEnvios)
        .where(and(...condiciones))
        .orderBy(difusionEnvios.fechaEnvio);
      res.json({ status: "ok", horas_desde_envio: horas, total: pendientes.length, pendientes });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  // ── Difusión nueva: templates sin parámetros a todas las donantes ──
  app.post("/admin/difusion/nueva", async (req, res) => {
    const { soloGrupos } = req.body as { soloGrupos?: string[] };
    try {
      const result = await enviarDifusionNueva(soloGrupos ? { soloGrupos } : undefined);
      res.json({ status: "ok", ...result });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  // ── Reset confirmaciones para grupos MV y MS (re-envío con nuevos templates) ──
  app.post("/admin/difusion/reset-grupos", async (req, res) => {
    const { grupos } = req.body as { grupos?: string[] };
    const gruposAResetear = grupos || ["MV", "MS"];
    try {
      // Cubrir tanto los valores nuevos correctos como los viejos incorrectos
      const diasPorGrupo: Record<string, string[]> = {
        MV: ["Martes y Viernes", "Miércoles y Viernes"],
        MS: ["Miércoles y Sábado", "Martes y Sábado"],
      };

      let totalReset = 0;

      for (const grupo of gruposAResetear) {
        const diasVariantes = diasPorGrupo[grupo] ?? [];
        for (const dias of diasVariantes) {
          const result = await db
            .update(difusionEnvios)
            .set({ confirmado: false, fechaConfirmacion: null })
            .where(eq(difusionEnvios.diasRecoleccion, dias))
            .returning({ id: difusionEnvios.id });
          totalReset += result.length;
        }
      }

      logger.info({ totalReset, grupos: gruposAResetear }, "Reset de confirmaciones de difusión");
      res.json({ status: "ok", totalReset, grupos: gruposAResetear });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  app.post("/admin/difusion/reenviar-pendientes", async (req, res) => {
    const horas = parseInt(req.query.horas as string) || 48;
    try {
      const corte = new Date(Date.now() - horas * 60 * 60 * 1000);
      const pendientes = await db
        .select({ telefono: difusionEnvios.telefono })
        .from(difusionEnvios)
        .where(and(eq(difusionEnvios.confirmado, false), lte(difusionEnvios.fechaEnvio, corte)));

      if (pendientes.length === 0) {
        res.json({ status: "ok", mensaje: "No hay pendientes para reenviar", total: 0 });
        return;
      }

      const telefonos = new Set(pendientes.map((p) => p.telefono));
      const result = await enviarDifusionPorRutas({ telefonos });
      res.json({ status: "ok", horas_desde_envio: horas, ...result });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });

  // ── P0.9: reset de estado conversacional ANTES de exponer webhook ──
  // Política acordada: el bot olvida flows previos al encender. Arranca en blanco.
  // Preserva human_escalations activas y mensajes_log (para ventana 24h).
  try {
    await resetConversationalStateOnStart();
  } catch (err) {
    logger.error({ err }, "Error reseteando estado conversacional al start (se continúa igual)");
  }

  // ── Bot-takeover (P0.10) y rate-limit (P1.6) status ──
  app.get("/admin/bot-takeover/status", async (_req, res) => {
    const { takeoverStats } = await import("./services/bot-takeover");
    res.json({ status: "ok", ...takeoverStats() });
  });
  app.post("/admin/bot-takeover/resume", async (req, res) => {
    const phone = String((req.body ?? {}).phone || "").trim();
    if (!phone) {
      res.status(400).json({ error: "Body { phone: string }" });
      return;
    }
    const { resumeBotForPhone } = await import("./services/bot-takeover");
    resumeBotForPhone(phone);
    res.json({ status: "ok", phone });
  });
  app.get("/admin/rate-limit/status", async (_req, res) => {
    const { rateLimitStats } = await import("./services/rate-limit-adaptive");
    res.json({ status: "ok", ...rateLimitStats() });
  });

  // ── WhatsApp quality rating ────────────────────────
  app.get("/admin/whatsapp/quality", async (_req, res) => {
    try {
      const { fetchQualityRating, getLastQualityInfo } = await import("./services/whatsapp-quality");
      const cached = getLastQualityInfo();
      const fresh = await fetchQualityRating();
      res.json({ status: "ok", current: fresh, previous: cached });
    } catch (err) {
      res.status(500).json({ status: "error", error: (err as Error).message });
    }
  });
  app.post("/admin/whatsapp/quality/check", async (_req, res) => {
    try {
      const { checkAndAlertQuality } = await import("./services/whatsapp-quality");
      const info = await checkAndAlertQuality();
      res.json({ status: "ok", info });
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

  if (env.TEST_MODE) {
    logger.warn(
      { whitelist: env.TEST_PHONES },
      "TEST_MODE ACTIVO: solo se envían mensajes a números en whitelist",
    );
  }

  logger.info({ port: env.PORT }, "GARYCIO System iniciado correctamente");

  // ── Graceful shutdown ───────────────────────────────
  const shutdown = (signal: string, code = 0) => {
    logger.info({ signal }, "Señal de apagado recibida. Cerrando...");
    // Dar tiempo a que los locks activos terminen antes de salir
    setTimeout(() => process.exit(code), 5000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM", 0));
  process.on("SIGINT", () => shutdown("SIGINT", 0));

  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Excepción no capturada — graceful shutdown en 5s");
    notifyAdminsCritical("uncaughtException: "+(err as Error).message, { stack: (err as Error).stack }).catch(() => {});
    shutdown("uncaughtException", 1);
  });

  process.on("unhandledRejection", (reason) => {
    logger.fatal({ reason }, "Promesa rechazada sin manejar — graceful shutdown en 5s");
    notifyAdminsCritical("unhandledRejection: "+String(reason), {}).catch(() => {});
    shutdown("unhandledRejection", 1);
  });
}

main().catch((err) => {
  logger.fatal(err, "Error fatal al iniciar");
  process.exit(1);
});
