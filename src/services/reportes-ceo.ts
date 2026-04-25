import { db } from "../database";
import {
  reclamos,
  incidentes,
  donantes,
  choferes,
} from "../database/schema";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import { sendMessage } from "../bot/client";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { addToDeadLetterQueue } from "./dead-letter-queue";

// ============================================================
// Enviar a todos los admin phones
// ============================================================

// P0.4 — dedup + throttle de notificaciones a admins.
// Evita spam: mismo mensaje en ≤ 5min se descarta. Cantidad máxima
// por minuto ≤ 30 (más que eso, se ignora con WARN).
const NOTIF_DEDUP_MS = 5 * 60 * 1000;
const NOTIF_THROTTLE_WINDOW_MS = 60 * 1000;
const NOTIF_THROTTLE_MAX = 30;
const recentMessages = new Map<string, number>(); // hash → ts
const sentTimestamps: number[] = [];

function hashMsg(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h);
}

export function _resetNotificarAdminsThrottle(): void {
  recentMessages.clear();
  sentTimestamps.length = 0;
}

/**
 * Envía un mensaje a todos los teléfonos admin (CEO + hermano + padre).
 * Usa ADMIN_PHONES (comma-separated) + CEO_PHONE.
 *
 * P0.4: dedup por hash 5min + throttle global 30 msg/min.
 */
export async function notificarAdmins(mensaje: string): Promise<void> {
  const now = Date.now();
  const h = hashMsg(mensaje);

  // Dedup: mismo mensaje en los últimos 5min, skip.
  const last = recentMessages.get(h);
  if (last && now - last < NOTIF_DEDUP_MS) {
    logger.debug({ hash: h }, "notificarAdmins: dedup — mensaje idéntico reciente, skip");
    return;
  }

  // Throttle: cuántos enviamos en la ventana móvil.
  while (sentTimestamps.length > 0 && now - sentTimestamps[0] > NOTIF_THROTTLE_WINDOW_MS) {
    sentTimestamps.shift();
  }
  if (sentTimestamps.length >= NOTIF_THROTTLE_MAX) {
    logger.warn(
      { sentInWindow: sentTimestamps.length, max: NOTIF_THROTTLE_MAX },
      "notificarAdmins: throttle activo — descartando alerta",
    );
    return;
  }

  recentMessages.set(h, now);
  sentTimestamps.push(now);

  // Cleanup periódico del Map de hashes
  if (recentMessages.size > 200) {
    for (const [k, ts] of recentMessages) {
      if (now - ts > NOTIF_DEDUP_MS) recentMessages.delete(k);
    }
  }

  const phones = new Set<string>();

  // Agregar CEO_PHONE
  if (env.CEO_PHONE) phones.add(env.CEO_PHONE);

  // Agregar ADMIN_PHONES
  const adminPhones = (env as any).ADMIN_PHONES as string | undefined;
  if (adminPhones) {
    for (const phone of adminPhones.split(",")) {
      const trimmed = phone.trim();
      if (trimmed) phones.add(trimmed);
    }
  }

  for (const phone of phones) {
    try {
      await sendMessage(phone, mensaje);
    } catch (err) {
      logger.error({ err, phone }, "Error enviando alerta a admin");
      await addToDeadLetterQueue({
        telefono: phone,
        tipo: "alerta_ceo",
        contenido: mensaje,
        errorMessage: (err as Error).message,
      }).catch(() => {});
    }
  }
}

// ============================================================
// Clasificación automática de gravedad
// ============================================================

/**
 * Determina la gravedad de un reclamo según tipo y contenido.
 * Se usa para decidir si escalar al CEO automáticamente.
 */
export function clasificarGravedadReclamo(
  tipo: string,
  descripcion: string | null,
): "leve" | "moderado" | "grave" | "critico" {
  const desc = (descripcion || "").toLowerCase();

  // Palabras clave que indican gravedad alta/crítica
  const criticas = ["robo", "amenaza", "peligro", "urgente", "emergencia", "policia", "denuncia", "agresion", "violencia"];
  const graves = ["nunca vienen", "varios meses", "hace semanas", "cansada", "harta", "mal trato", "maltrato", "insulto", "grito", "sucio", "olor"];

  if (criticas.some((kw) => desc.includes(kw))) return "critico";
  if (graves.some((kw) => desc.includes(kw))) return "grave";

  // Por tipo
  if (tipo === "otro" && desc.length > 50) return "moderado"; // reclamo largo suele ser serio
  return "leve";
}

// ============================================================
// Guardar reclamo en DB + escalar si es necesario
// ============================================================

export interface SaveReclamoParams {
  donantePhone: string;
  tipo: string;
  descripcion: string | null;
}

/**
 * Persiste un reclamo en la base de datos.
 * Si la gravedad es GRAVE o CRITICA, notifica al CEO inmediatamente.
 */
export async function guardarReclamo(params: SaveReclamoParams): Promise<{
  id: number;
  gravedad: string;
  escalado: boolean;
}> {
  // Buscar donante por teléfono
  const donanteResult = await db
    .select({ id: donantes.id, nombre: donantes.nombre, direccion: donantes.direccion })
    .from(donantes)
    .where(eq(donantes.telefono, params.donantePhone))
    .limit(1);

  if (donanteResult.length === 0) {
    logger.warn({ phone: params.donantePhone }, "Reclamo de donante no encontrada en DB");
    // Guardar igual con donanteId ficticio si no se encuentra
    return { id: 0, gravedad: "leve", escalado: false };
  }

  const donante = donanteResult[0];
  const gravedad = clasificarGravedadReclamo(params.tipo, params.descripcion);
  const debeEscalar = gravedad === "grave" || gravedad === "critico";

  // Insertar en DB
  const [inserted] = await db.insert(reclamos).values({
    donanteId: donante.id,
    tipo: params.tipo as any,
    descripcion: params.descripcion,
    gravedad: gravedad as any,
    notificadoCeo: debeEscalar,
  }).returning({ id: reclamos.id });

  // Si es grave/crítico → notificar CEO de inmediato
  if (debeEscalar) {
    const emoji = gravedad === "critico" ? "🔴" : "🟠";
    const mensaje =
      `${emoji} *ALERTA: RECLAMO ${gravedad.toUpperCase()}*\n\n` +
      `Reclamo #${inserted.id}\n` +
      `Donante: *${donante.nombre || "Sin nombre"}*\n` +
      `Teléfono: ${params.donantePhone}\n` +
      `Dirección: ${donante.direccion || "Sin dirección"}\n` +
      `Tipo: *${params.tipo}*\n` +
      `Detalle: ${params.descripcion || "Sin detalle"}\n\n` +
      `Gravedad: *${gravedad.toUpperCase()}*\n` +
      `Hora: ${new Date().toLocaleString("es-AR")}\n\n` +
      `_Este reclamo requiere atención inmediata._\n` +
      `_Notificación automática de GARYCIO_`;

    await notificarAdmins(mensaje);
    logger.info({ reclamoId: inserted.id, gravedad }, "Reclamo escalado a admins");
  }

  logger.info(
    { reclamoId: inserted.id, gravedad, escalado: debeEscalar },
    "Reclamo guardado en DB",
  );

  return { id: inserted.id, gravedad, escalado: debeEscalar };
}

// ============================================================
// Guardar incidente en DB
// ============================================================

export interface SaveIncidenteParams {
  choferId: number;
  tipo: string;
  descripcion: string;
  gravedad: string;
}

export async function guardarIncidente(params: SaveIncidenteParams): Promise<{
  id: number;
  escalado: boolean;
}> {
  const debeEscalar = params.gravedad === "alta" || params.gravedad === "critica";

  const [inserted] = await db.insert(incidentes).values({
    choferId: params.choferId,
    tipo: params.tipo as any,
    gravedad: params.gravedad as any,
    descripcion: params.descripcion,
    notificadoCeo: debeEscalar,
  }).returning({ id: incidentes.id });

  logger.info(
    { incidenteId: inserted.id, gravedad: params.gravedad, escalado: debeEscalar },
    "Incidente guardado en DB",
  );

  return { id: inserted.id, escalado: debeEscalar };
}

// ============================================================
// Resumen para CEO (datos para el reporte)
// ============================================================

export interface ResumenCEO {
  periodo: string;
  totalReclamos: number;
  reclamosPorTipo: Record<string, number>;
  reclamosPorGravedad: Record<string, number>;
  reclamosPendientes: number;
  reclamosResueltos: number;
  totalIncidentes: number;
  incidentesPorTipo: Record<string, number>;
  incidentesPorGravedad: Record<string, number>;
  reclamosDetalle: Array<{
    id: number;
    donante: string;
    telefono: string;
    tipo: string;
    gravedad: string;
    descripcion: string | null;
    estado: string;
    fecha: string;
  }>;
  incidentesDetalle: Array<{
    id: number;
    chofer: string;
    tipo: string;
    gravedad: string;
    descripcion: string;
    fecha: string;
  }>;
}

/**
 * Genera un resumen de reclamos e incidentes para el período dado.
 * Si no se especifica fecha, toma los últimos 30 días.
 */
export async function generarResumenCEO(diasAtras: number = 30): Promise<ResumenCEO> {
  const desde = new Date();
  desde.setDate(desde.getDate() - diasAtras);

  // Reclamos con join a donantes
  const reclamosRows = await db
    .select({
      id: reclamos.id,
      tipo: reclamos.tipo,
      gravedad: reclamos.gravedad,
      descripcion: reclamos.descripcion,
      estado: reclamos.estado,
      resuelto: reclamos.resuelto,
      fechaCreacion: reclamos.fechaCreacion,
      donanteNombre: donantes.nombre,
      donanteTelefono: donantes.telefono,
    })
    .from(reclamos)
    .leftJoin(donantes, eq(reclamos.donanteId, donantes.id))
    .where(gte(reclamos.fechaCreacion, desde))
    .orderBy(desc(reclamos.fechaCreacion));

  // Incidentes con join a choferes
  const incidentesRows = await db
    .select({
      id: incidentes.id,
      tipo: incidentes.tipo,
      gravedad: incidentes.gravedad,
      descripcion: incidentes.descripcion,
      fecha: incidentes.fecha,
      choferNombre: choferes.nombre,
    })
    .from(incidentes)
    .leftJoin(choferes, eq(incidentes.choferId, choferes.id))
    .where(gte(incidentes.fecha, desde))
    .orderBy(desc(incidentes.fecha));

  // Conteo por tipo
  const reclamosPorTipo: Record<string, number> = {};
  const reclamosPorGravedad: Record<string, number> = {};
  let pendientes = 0;
  let resueltos = 0;

  for (const r of reclamosRows) {
    reclamosPorTipo[r.tipo] = (reclamosPorTipo[r.tipo] || 0) + 1;
    reclamosPorGravedad[r.gravedad || "leve"] = (reclamosPorGravedad[r.gravedad || "leve"] || 0) + 1;
    if (r.resuelto) resueltos++;
    else pendientes++;
  }

  const incidentesPorTipo: Record<string, number> = {};
  const incidentesPorGravedad: Record<string, number> = {};

  for (const i of incidentesRows) {
    incidentesPorTipo[i.tipo] = (incidentesPorTipo[i.tipo] || 0) + 1;
    incidentesPorGravedad[i.gravedad || "media"] = (incidentesPorGravedad[i.gravedad || "media"] || 0) + 1;
  }

  return {
    periodo: `Últimos ${diasAtras} días (desde ${desde.toLocaleDateString("es-AR")})`,
    totalReclamos: reclamosRows.length,
    reclamosPorTipo,
    reclamosPorGravedad,
    reclamosPendientes: pendientes,
    reclamosResueltos: resueltos,
    totalIncidentes: incidentesRows.length,
    incidentesPorTipo,
    incidentesPorGravedad,
    reclamosDetalle: reclamosRows.map((r) => ({
      id: r.id,
      donante: r.donanteNombre || "Sin nombre",
      telefono: r.donanteTelefono || "",
      tipo: r.tipo,
      gravedad: r.gravedad || "leve",
      descripcion: r.descripcion,
      estado: r.estado || "pendiente",
      fecha: r.fechaCreacion ? new Date(r.fechaCreacion).toLocaleDateString("es-AR") : "",
    })),
    incidentesDetalle: incidentesRows.map((i) => ({
      id: i.id,
      chofer: i.choferNombre || "Sin asignar",
      tipo: i.tipo,
      gravedad: i.gravedad || "media",
      descripcion: i.descripcion,
      fecha: i.fecha ? new Date(i.fecha).toLocaleDateString("es-AR") : "",
    })),
  };
}

// ============================================================
// Generar PDF de reporte para CEO
// ============================================================

export async function generarReporteCEOPDF(diasAtras: number = 30): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;
  const resumen = await generarResumenCEO(diasAtras);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 40, bottom: 40, left: 40, right: 40 },
      info: {
        Title: "GARYCIO - Reporte de Reclamos e Incidentes",
        Author: "GARYCIO System",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W = doc.page.width;
    const mx = 40;
    const pw = W - mx * 2;

    // Header
    doc.rect(0, 0, W, 65).fill("#1B2A4A");
    doc.font("Helvetica-Bold").fontSize(22).fillColor("#FFFFFF")
      .text("GARYCIO", mx, 12);
    doc.font("Helvetica").fontSize(9).fillColor("#A0B4D0")
      .text("REPORTE DE RECLAMOS E INCIDENTES", mx, 36);
    doc.font("Helvetica").fontSize(8).fillColor("#A0B4D0")
      .text(`${resumen.periodo}  |  Generado: ${new Date().toLocaleString("es-AR")}`, mx, 48);
    doc.rect(0, 65, W, 3).fill("#2E86AB");

    let y = 78;

    // ── Resumen rápido (cajas) ────────
    const boxW = (pw - 15) / 4;
    const boxes = [
      { label: "Reclamos totales", value: String(resumen.totalReclamos), color: "#3498DB" },
      { label: "Pendientes", value: String(resumen.reclamosPendientes), color: "#F39C12" },
      { label: "Resueltos", value: String(resumen.reclamosResueltos), color: "#27AE60" },
      { label: "Incidentes", value: String(resumen.totalIncidentes), color: "#E74C3C" },
    ];

    boxes.forEach((b, i) => {
      const bx = mx + i * (boxW + 5);
      doc.rect(bx, y, boxW, 45).fillAndStroke("#F5F6F8", "#E0E0E0");
      doc.rect(bx, y, boxW, 3).fill(b.color);
      doc.font("Helvetica").fontSize(7).fillColor("#7F8C8D")
        .text(b.label, bx + 5, y + 8, { width: boxW - 10, align: "center" });
      doc.font("Helvetica-Bold").fontSize(18).fillColor("#1B2A4A")
        .text(b.value, bx + 5, y + 22, { width: boxW - 10, align: "center" });
    });
    y += 55;

    // ── Desglose por tipo y gravedad ──
    doc.rect(mx, y, pw, 18).fill("#1B2A4A");
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#FFFFFF")
      .text("RECLAMOS POR TIPO", mx + 8, y + 4);
    y += 22;

    const tipoLabels: Record<string, string> = {
      regalo: "Regalo no entregado", falta_bidon: "Falta de bidón",
      nueva_pelela: "Pelela nueva", otro: "Otro",
    };

    for (const [tipo, count] of Object.entries(resumen.reclamosPorTipo)) {
      doc.font("Helvetica").fontSize(8).fillColor("#34495E")
        .text(`${tipoLabels[tipo] || tipo}: `, mx + 8, y);
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#1B2A4A")
        .text(String(count), mx + 180, y);
      y += 14;
    }
    y += 5;

    // Gravedad
    doc.rect(mx, y, pw, 18).fill("#1B2A4A");
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#FFFFFF")
      .text("RECLAMOS POR GRAVEDAD", mx + 8, y + 4);
    y += 22;

    const gravColors: Record<string, string> = {
      leve: "#27AE60", moderado: "#F39C12", grave: "#E67E22", critico: "#E74C3C",
    };

    for (const [grav, count] of Object.entries(resumen.reclamosPorGravedad)) {
      const gc = gravColors[grav] || "#7F8C8D";
      doc.rect(mx + 8, y, 8, 8).fill(gc);
      doc.font("Helvetica").fontSize(8).fillColor("#34495E")
        .text(`${grav.toUpperCase()}: ${count}`, mx + 22, y);
      y += 14;
    }
    y += 10;

    // ── Tabla de reclamos detallados ──
    if (resumen.reclamosDetalle.length > 0) {
      doc.rect(mx, y, pw, 18).fill("#1B2A4A");
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#FFFFFF")
        .text("DETALLE DE RECLAMOS", mx + 8, y + 4);
      y += 20;

      // Header tabla
      doc.rect(mx, y, pw, 14).fill("#34495E");
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#FFFFFF");
      doc.text("#", mx + 3, y + 3, { width: 20 });
      doc.text("FECHA", mx + 23, y + 3, { width: 55 });
      doc.text("DONANTE", mx + 80, y + 3, { width: 110 });
      doc.text("TIPO", mx + 195, y + 3, { width: 80 });
      doc.text("GRAVEDAD", mx + 280, y + 3, { width: 60 });
      doc.text("ESTADO", mx + 345, y + 3, { width: pw - 345 + mx });
      y += 15;

      for (let i = 0; i < Math.min(resumen.reclamosDetalle.length, 25); i++) {
        const r = resumen.reclamosDetalle[i];
        if (y > doc.page.height - 60) { doc.addPage(); y = 40; }

        const bg = i % 2 === 0 ? "#FFFFFF" : "#F8F9FA";
        doc.rect(mx, y, pw, 13).fill(bg);

        doc.font("Helvetica").fontSize(6.5).fillColor("#34495E");
        doc.text(String(r.id), mx + 3, y + 3, { width: 20 });
        doc.text(r.fecha, mx + 23, y + 3, { width: 55 });
        doc.text(r.donante, mx + 80, y + 3, { width: 110 });
        doc.text(tipoLabels[r.tipo] || r.tipo, mx + 195, y + 3, { width: 80 });

        // Gravedad badge
        const gc = gravColors[r.gravedad] || "#7F8C8D";
        doc.rect(mx + 280, y + 2, 55, 9).fill(gc);
        doc.font("Helvetica-Bold").fontSize(5.5).fillColor("#FFFFFF")
          .text(r.gravedad.toUpperCase(), mx + 280, y + 3.5, { width: 55, align: "center" });

        // Estado badge
        const estadoColor = r.estado === "resuelto" ? "#27AE60" : r.estado === "pendiente" ? "#F39C12" : "#3498DB";
        doc.rect(mx + 345, y + 2, 55, 9).fill(estadoColor);
        doc.font("Helvetica-Bold").fontSize(5.5).fillColor("#FFFFFF")
          .text(r.estado.toUpperCase(), mx + 345, y + 3.5, { width: 55, align: "center" });

        y += 14;
      }
    }

    y += 15;

    // ── Incidentes ────────────────────
    if (resumen.incidentesDetalle.length > 0) {
      if (y > doc.page.height - 120) { doc.addPage(); y = 40; }

      doc.rect(mx, y, pw, 18).fill("#E74C3C");
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#FFFFFF")
        .text("DETALLE DE INCIDENTES", mx + 8, y + 4);
      y += 20;

      doc.rect(mx, y, pw, 14).fill("#34495E");
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#FFFFFF");
      doc.text("#", mx + 3, y + 3, { width: 20 });
      doc.text("FECHA", mx + 23, y + 3, { width: 55 });
      doc.text("CHOFER", mx + 80, y + 3, { width: 90 });
      doc.text("TIPO", mx + 175, y + 3, { width: 85 });
      doc.text("GRAVEDAD", mx + 265, y + 3, { width: 60 });
      doc.text("DESCRIPCIÓN", mx + 330, y + 3, { width: pw - 330 + mx });
      y += 15;

      for (let i = 0; i < Math.min(resumen.incidentesDetalle.length, 20); i++) {
        const inc = resumen.incidentesDetalle[i];
        if (y > doc.page.height - 50) { doc.addPage(); y = 40; }

        const bg = i % 2 === 0 ? "#FFFFFF" : "#F8F9FA";
        doc.rect(mx, y, pw, 13).fill(bg);

        doc.font("Helvetica").fontSize(6.5).fillColor("#34495E");
        doc.text(String(inc.id), mx + 3, y + 3, { width: 20 });
        doc.text(inc.fecha, mx + 23, y + 3, { width: 55 });
        doc.text(inc.chofer, mx + 80, y + 3, { width: 90 });
        doc.text(inc.tipo, mx + 175, y + 3, { width: 85 });

        const gc = gravColors[inc.gravedad] || "#7F8C8D";
        doc.rect(mx + 265, y + 2, 55, 9).fill(gc);
        doc.font("Helvetica-Bold").fontSize(5.5).fillColor("#FFFFFF")
          .text(inc.gravedad.toUpperCase(), mx + 265, y + 3.5, { width: 55, align: "center" });

        doc.font("Helvetica").fontSize(6).fillColor("#34495E")
          .text(inc.descripcion.slice(0, 60), mx + 330, y + 3, { width: pw - 330 + mx });

        y += 14;
      }
    }

    // Footer
    const fy = doc.page.height - 25;
    doc.rect(0, fy, W, 25).fill("#1B2A4A");
    doc.font("Helvetica").fontSize(7).fillColor("#A0B4D0")
      .text(
        `GARYCIO System  |  Reporte CEO  |  ${new Date().toLocaleDateString("es-AR")}  |  Confidencial`,
        mx, fy + 8, { width: pw, align: "center" },
      );

    doc.end();
  });
}
