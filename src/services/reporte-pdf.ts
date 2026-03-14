import PDFDocument from "pdfkit";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import { db } from "../database";
import {
  donantes,
  reclamos,
  avisos,
  registrosRecoleccion,
  progresoMensual,
  camiones,
  choferes,
  mensajesLog,
  recorridos,
  incidentes,
} from "../database/schema";
import { eq, and, gte, sql, count } from "drizzle-orm";
import { logger } from "../config/logger";
import path from "path";
import fs from "fs";

// ============================================================
// Colores corporativos
// ============================================================
const C = {
  primary: "#1B2A4A",
  accent: "#2E86AB",
  success: "#27AE60",
  warning: "#F39C12",
  danger: "#E74C3C",
  light: "#F5F6F8",
  white: "#FFFFFF",
  gray: "#7F8C8D",
  darkGray: "#34495E",
  blue: "#3498DB",
  green: "#2ECC71",
  orange: "#E67E22",
  purple: "#9B59B6",
};

const REPORTS_DIR = path.join(process.cwd(), "reports");

// Charts con tamaños optimizados para 1 página A4
const chartSmall = new ChartJSNodeCanvas({ width: 400, height: 220, backgroundColour: C.white });
const chartWide = new ChartJSNodeCanvas({ width: 700, height: 240, backgroundColour: C.white });

// ============================================================
// Tipos de datos del reporte
// ============================================================
interface IncidenteReporte {
  choferCodigo: string;
  tipo: string;
  gravedad: string;
  descripcion: string;
  hora: string;
}

interface ReporteData {
  fecha: Date;
  litrosHoy: number;
  bidonesHoy: number;
  progresoMes: { recolectados: number; objetivo: number };
  litrosPorDia: Array<{ dia: number; litros: number }>;
  donantes: { activas: number; nuevas: number; enPausa: number; total: number };
  reclamos: { pendientes: number; enSeguimiento: number; escalados: number; resueltosDelMes: number };
  avisos: { vacaciones: number; enfermedad: number; medicacion: number; vuelvenManana: number };
  flota: { total: number; disponibles: number; enRuta: number; choferes: number };
  mensajes: { total: number; entrantes: number; salientes: number };
  incidentes: IncidenteReporte[];
}

// ============================================================
// Función principal: generar PDF
// ============================================================
export async function generarReportePDF(fechaOpcional?: Date): Promise<string> {
  const fecha = fechaOpcional || new Date();

  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }

  const fechaStr = fecha.toISOString().split("T")[0];
  const filePath = path.join(REPORTS_DIR, `reporte-${fechaStr}.pdf`);

  const data = await recopilarDatos(fecha);

  const [cProgreso, cLitros, cDonantes] = await Promise.all([
    chartProgreso(data),
    chartLitros(data),
    chartDonantes(data),
  ]);

  await crearPDF(filePath, data, cProgreso, cLitros, cDonantes);

  logger.info({ filePath }, "Reporte PDF generado");
  return filePath;
}

// ============================================================
// Recopilar todos los datos
// ============================================================
async function recopilarDatos(fecha: Date): Promise<ReporteData> {
  const hoyStr = fecha.toISOString().split("T")[0];
  const mesActual = fecha.getMonth() + 1;
  const anioActual = fecha.getFullYear();
  const inicioDelDia = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  const inicioMes = new Date(fecha.getFullYear(), fecha.getMonth(), 1);

  // Litros hoy
  const litrosResult = await db
    .select({
      litros: sql<number>`COALESCE(SUM(${registrosRecoleccion.litrosTotales}::numeric), 0)`,
      bidones: sql<number>`COALESCE(SUM(${registrosRecoleccion.bidonesTotales}), 0)`,
    })
    .from(registrosRecoleccion)
    .where(eq(registrosRecoleccion.fecha, hoyStr));

  // Progreso mensual
  const progresoResult = await db
    .select({
      recolectados: progresoMensual.litrosRecolectados,
      objetivo: progresoMensual.objetivoLitros,
    })
    .from(progresoMensual)
    .where(and(eq(progresoMensual.mes, mesActual), eq(progresoMensual.anio, anioActual)))
    .limit(1);

  // Litros por día del mes
  const litrosPorDiaResult = await db
    .select({
      dia: sql<number>`EXTRACT(DAY FROM ${registrosRecoleccion.fecha}::date)`,
      litros: sql<number>`COALESCE(SUM(${registrosRecoleccion.litrosTotales}::numeric), 0)`,
    })
    .from(registrosRecoleccion)
    .where(gte(registrosRecoleccion.fecha, inicioMes.toISOString().split("T")[0]))
    .groupBy(sql`EXTRACT(DAY FROM ${registrosRecoleccion.fecha}::date)`)
    .orderBy(sql`EXTRACT(DAY FROM ${registrosRecoleccion.fecha}::date)`);

  // Donantes
  const donantesResult = await db
    .select({ estado: donantes.estado, cantidad: count() })
    .from(donantes)
    .groupBy(donantes.estado);

  const statsDonantes = { activas: 0, nuevas: 0, enPausa: 0, total: 0 };
  for (const row of donantesResult) {
    const cant = Number(row.cantidad);
    statsDonantes.total += cant;
    if (row.estado === "activa") statsDonantes.activas = cant;
    else if (row.estado === "nueva") statsDonantes.nuevas = cant;
    else statsDonantes.enPausa += cant;
  }

  // Reclamos
  const reclamosResult = await db
    .select({ estado: reclamos.estado, cantidad: count() })
    .from(reclamos)
    .where(eq(reclamos.resuelto, false))
    .groupBy(reclamos.estado);

  const statsReclamos = { pendientes: 0, enSeguimiento: 0, escalados: 0, resueltosDelMes: 0 };
  for (const row of reclamosResult) {
    const cant = Number(row.cantidad);
    if (row.estado === "pendiente" || row.estado === "notificado_chofer") statsReclamos.pendientes += cant;
    else if (row.estado === "seguimiento_enviado") statsReclamos.enSeguimiento = cant;
    else if (row.estado === "escalado_visitadora") statsReclamos.escalados = cant;
  }

  const resueltosResult = await db
    .select({ cantidad: count() })
    .from(reclamos)
    .where(and(eq(reclamos.resuelto, true), gte(reclamos.fechaResolucion, inicioMes)));

  statsReclamos.resueltosDelMes = Number(resueltosResult[0]?.cantidad || 0);

  // Avisos
  const avisosResult = await db
    .select({ tipo: avisos.tipo, cantidad: count() })
    .from(avisos)
    .where(eq(avisos.notificacionVueltaEnviada, false))
    .groupBy(avisos.tipo);

  const statsAvisos = { vacaciones: 0, enfermedad: 0, medicacion: 0, vuelvenManana: 0 };
  for (const row of avisosResult) {
    const cant = Number(row.cantidad);
    if (row.tipo === "vacaciones") statsAvisos.vacaciones = cant;
    else if (row.tipo === "enfermedad") statsAvisos.enfermedad = cant;
    else if (row.tipo === "medicacion") statsAvisos.medicacion = cant;
  }

  const manana = new Date(fecha);
  manana.setDate(manana.getDate() + 1);
  const vuelvenResult = await db
    .select({ cantidad: count() })
    .from(avisos)
    .where(and(eq(avisos.fechaFin, manana.toISOString().split("T")[0]), eq(avisos.notificacionVueltaEnviada, false)));
  statsAvisos.vuelvenManana = Number(vuelvenResult[0]?.cantidad || 0);

  // Flota
  const camionesResult = await db
    .select({ estado: camiones.estado, cantidad: count() })
    .from(camiones)
    .groupBy(camiones.estado);

  const statsFlota = { total: 0, disponibles: 0, enRuta: 0, choferes: 0 };
  for (const row of camionesResult) {
    const cant = Number(row.cantidad);
    statsFlota.total += cant;
    if (row.estado === "disponible") statsFlota.disponibles = cant;
    else if (row.estado === "en_ruta") statsFlota.enRuta = cant;
  }

  const choferesResult = await db
    .select({ cantidad: count() })
    .from(choferes)
    .where(eq(choferes.activo, true));
  statsFlota.choferes = Number(choferesResult[0]?.cantidad || 0);

  // Mensajes del día
  const mensajesResult = await db
    .select({ direccion: mensajesLog.direccion, cantidad: count() })
    .from(mensajesLog)
    .where(gte(mensajesLog.createdAt, inicioDelDia))
    .groupBy(mensajesLog.direccion);

  const statsMensajes = { total: 0, entrantes: 0, salientes: 0 };
  for (const row of mensajesResult) {
    const cant = Number(row.cantidad);
    statsMensajes.total += cant;
    if (row.direccion === "entrante") statsMensajes.entrantes = cant;
    else statsMensajes.salientes = cant;
  }

  // Incidentes del día
  const incidentesResult = await db
    .select({
      choferId: incidentes.choferId,
      tipo: incidentes.tipo,
      gravedad: incidentes.gravedad,
      descripcion: incidentes.descripcion,
      fecha: incidentes.fecha,
    })
    .from(incidentes)
    .where(gte(incidentes.fecha, inicioDelDia));

  const incidentesDelDia: IncidenteReporte[] = incidentesResult.map((inc) => ({
    choferCodigo: String(inc.choferId || "?").padStart(2, "0"),
    tipo: LABELS_INCIDENTE[inc.tipo] || inc.tipo,
    gravedad: inc.gravedad || "media",
    descripcion: inc.descripcion.length > 60 ? inc.descripcion.substring(0, 57) + "..." : inc.descripcion,
    hora: inc.fecha ? new Date(inc.fecha).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "--:--",
  }));

  return {
    fecha,
    litrosHoy: Number(litrosResult[0]?.litros || 0),
    bidonesHoy: Number(litrosResult[0]?.bidones || 0),
    progresoMes: {
      recolectados: Number(progresoResult[0]?.recolectados || 0),
      objetivo: Number(progresoResult[0]?.objetivo || 260000),
    },
    litrosPorDia: litrosPorDiaResult.map((r) => ({
      dia: Number(r.dia),
      litros: Number(r.litros),
    })),
    donantes: statsDonantes,
    reclamos: statsReclamos,
    avisos: statsAvisos,
    flota: statsFlota,
    mensajes: statsMensajes,
    incidentes: incidentesDelDia,
  };
}

const LABELS_INCIDENTE: Record<string, string> = {
  accidente: "Accidente de tránsito",
  retraso: "Retraso significativo",
  averia: "Avería del camión",
  robo: "Robo / intento",
  clima: "Problema climático",
  otro: "Otro",
};

const GRAVEDAD_EMOJI: Record<string, string> = {
  baja: "●",
  media: "●",
  alta: "●",
  critica: "●",
};

const GRAVEDAD_COLOR: Record<string, string> = {
  baja: "#27AE60",
  media: "#F39C12",
  alta: "#E67E22",
  critica: "#E74C3C",
};

// ============================================================
// Generadores de gráficos (compactos)
// ============================================================
async function chartProgreso(data: ReporteData): Promise<Buffer> {
  const pct = data.progresoMes.objetivo > 0
    ? (data.progresoMes.recolectados / data.progresoMes.objetivo) * 100
    : 0;
  return chartSmall.renderToBuffer({
    type: "doughnut",
    data: {
      labels: ["Recolectado", "Faltante"],
      datasets: [{ data: [pct, Math.max(0, 100 - pct)], backgroundColor: [C.accent, "#E0E0E0"], borderWidth: 0 }],
    },
    options: {
      plugins: {
        title: { display: true, text: `Progreso Mensual: ${pct.toFixed(1)}%`, font: { size: 14, weight: "bold" }, color: C.primary },
        legend: { display: false },
      },
      cutout: "65%",
    } as any,
  });
}

async function chartLitros(data: ReporteData): Promise<Buffer> {
  const dias = data.litrosPorDia.map((d) => `${d.dia}`);
  const litros = data.litrosPorDia.map((d) => d.litros);
  const obj = data.progresoMes.objetivo / 30;

  const mesNombre = data.fecha.toLocaleDateString("es-AR", { month: "long" });
  const anio = data.fecha.getFullYear();

  return chartWide.renderToBuffer({
    type: "bar",
    data: {
      labels: dias,
      datasets: [
        { label: "Litros", data: litros, backgroundColor: litros.map((l) => l === 0 ? "#E0E0E0" : C.accent + "CC"), borderRadius: 3, borderWidth: 0 },
        { label: "Objetivo diario", data: dias.map(() => obj), type: "line" as any, borderColor: C.danger, borderDash: [5, 5], borderWidth: 2, pointRadius: 0, fill: false },
      ],
    },
    options: {
      plugins: {
        title: { display: true, text: `Litros por Día - ${mesNombre} ${anio}`, font: { size: 14, weight: "bold" }, color: C.primary },
        legend: { position: "bottom", labels: { font: { size: 10 }, usePointStyle: true, padding: 8 } },
      },
      scales: {
        y: { beginAtZero: true, ticks: { font: { size: 9 } }, grid: { color: "#F0F0F0" } },
        x: { ticks: { font: { size: 9 } }, grid: { display: false } },
      },
    },
  });
}

async function chartDonantes(data: ReporteData): Promise<Buffer> {
  return chartSmall.renderToBuffer({
    type: "doughnut",
    data: {
      labels: ["Activas", "Nuevas", "En pausa"],
      datasets: [{ data: [data.donantes.activas, data.donantes.nuevas, data.donantes.enPausa], backgroundColor: [C.green, C.blue, C.orange], borderWidth: 2, borderColor: C.white }],
    },
    options: {
      plugins: {
        title: { display: true, text: `Donantes (${data.donantes.total} total)`, font: { size: 14, weight: "bold" }, color: C.primary },
        legend: { position: "bottom", labels: { font: { size: 10 }, usePointStyle: true, padding: 8 } },
      },
      cutout: "55%",
    } as any,
  });
}

// ============================================================
// Crear el PDF (1 página A4 compacta)
// ============================================================
async function crearPDF(
  filePath: string,
  data: ReporteData,
  cProg: Buffer,
  cLit: Buffer,
  cDon: Buffer,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      autoFirstPage: true,
      info: {
        Title: `Reporte GARYCIO - ${data.fecha.toLocaleDateString("es-AR")}`,
        Author: "GARYCIO System",
      },
    });

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const W = doc.page.width;   // 595.28
    const mx = 35;              // margen horizontal
    const pw = W - mx * 2;      // ancho útil ~525

    const fecha = data.fecha.toLocaleDateString("es-AR", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });

    const hayIncidentes = data.incidentes.length > 0;

    // ── HEADER (70pt) ─────────────────────────────
    doc.rect(0, 0, W, 70).fill(C.primary);
    doc.font("Helvetica-Bold").fontSize(22).fillColor(C.white).text("GARYCIO", mx, 15);
    doc.font("Helvetica").fontSize(10).fillColor("#A0B4D0").text("SYSTEM", mx + 110, 20);
    doc.font("Helvetica").fontSize(11).fillColor(C.white).text("Reporte Diario de Operaciones", mx, 40);
    doc.fontSize(9).fillColor("#A0B4D0").text(fecha, mx, 54);

    // Alerta de incidentes en el header
    if (hayIncidentes) {
      doc.font("Helvetica-Bold").fontSize(9).fillColor(C.danger)
        .text(`⚠ ${data.incidentes.length} INCIDENTE${data.incidentes.length > 1 ? "S" : ""}`, W - mx - 130, 52, { width: 130, align: "right" });
    }

    doc.rect(0, 70, W, 3).fill(C.accent);

    // ── KPIs (50pt) ──────────────────────────────
    let y = 80;
    const kw = pw / 4;
    const prom = data.bidonesHoy > 0 ? (data.litrosHoy / data.bidonesHoy).toFixed(1) : "0";
    const pct = data.progresoMes.objetivo > 0
      ? ((data.progresoMes.recolectados / data.progresoMes.objetivo) * 100).toFixed(1)
      : "0";

    const kpis = [
      { label: "LITROS HOY", value: data.litrosHoy.toLocaleString("es-AR"), color: C.accent },
      { label: "BIDONES HOY", value: `${data.bidonesHoy}`, color: C.green },
      { label: "PROM/BIDÓN", value: `${prom} L`, color: C.orange },
      { label: "PROGRESO MES", value: `${pct}%`, color: C.purple },
    ];

    kpis.forEach((k, i) => {
      const x = mx + i * kw;
      doc.rect(x + 2, y, kw - 6, 48).fill(C.light);
      doc.rect(x + 2, y, 3, 48).fill(k.color);
      doc.font("Helvetica-Bold").fontSize(17).fillColor(C.primary).text(k.value, x + 10, y + 8, { width: kw - 18 });
      doc.font("Helvetica").fontSize(7).fillColor(C.gray).text(k.label, x + 10, y + 32, { width: kw - 18 });
    });

    y += 58;

    // ── CHARTS FILA 1: progreso + donantes ──────
    const halfW = (pw - 10) / 2;
    doc.image(cProg, mx, y, { width: halfW, height: 125 });
    doc.image(cDon, mx + halfW + 10, y, { width: halfW, height: 125 });
    y += 132;

    // ── CHART: litros por día ────────────────────
    doc.image(cLit, mx, y, { width: pw, height: 145 });
    y += 152;

    // ── INCIDENTES (si hay) ─────────────────────
    if (hayIncidentes) {
      doc.rect(mx, y, pw, 18).fill(C.danger);
      doc.font("Helvetica-Bold").fontSize(9).fillColor(C.white)
        .text(`Incidentes del Día (${data.incidentes.length})`, mx + 8, y + 4, { width: pw - 16 });
      y += 20;

      // Header de tabla
      doc.rect(mx, y, pw, 13).fill("#F0F0F0");
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor(C.darkGray);
      doc.text("HORA", mx + 4, y + 3, { width: 35 });
      doc.text("CHOFER", mx + 42, y + 3, { width: 35 });
      doc.text("TIPO", mx + 82, y + 3, { width: 100 });
      doc.text("GRAV.", mx + 185, y + 3, { width: 35 });
      doc.text("DESCRIPCIÓN", mx + 225, y + 3, { width: pw - 230 });
      y += 14;

      // Filas de incidentes (máx 3 para que entre en 1 página)
      const maxIncidentes = Math.min(data.incidentes.length, 3);
      for (let i = 0; i < maxIncidentes; i++) {
        const inc = data.incidentes[i];
        const bgColor = i % 2 === 0 ? C.white : "#FAFAFA";
        doc.rect(mx, y, pw, 13).fill(bgColor);

        const gravColor = GRAVEDAD_COLOR[inc.gravedad] || C.gray;

        doc.font("Helvetica").fontSize(6.5).fillColor(C.darkGray);
        doc.text(inc.hora, mx + 4, y + 3, { width: 35 });
        doc.text(`#${inc.choferCodigo}`, mx + 42, y + 3, { width: 35 });
        doc.text(inc.tipo, mx + 82, y + 3, { width: 100 });

        // Gravedad con color
        doc.rect(mx + 185, y + 4, 5, 5).fill(gravColor);
        doc.font("Helvetica").fontSize(6.5).fillColor(C.darkGray)
          .text(inc.gravedad.toUpperCase(), mx + 193, y + 3, { width: 30 });

        doc.font("Helvetica").fontSize(6).fillColor(C.darkGray)
          .text(inc.descripcion, mx + 225, y + 3, { width: pw - 230 });

        y += 14;
      }

      if (data.incidentes.length > 3) {
        doc.font("Helvetica").fontSize(6).fillColor(C.gray)
          .text(`+ ${data.incidentes.length - 3} incidentes más`, mx + 4, y + 1);
        y += 10;
      }

      y += 4;
    }

    // ── RESUMEN OPERATIVO ────────────────────────
    doc.rect(mx, y, pw, 20).fill(C.primary);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(C.white).text("Resumen Operativo", mx + 8, y + 5, { width: pw - 16 });
    y += 24;

    // 4 columnas compactas
    const cols = 4;
    const cw = pw / cols;

    const cards = [
      {
        title: "Reclamos", items: [
          { l: "Pendientes", v: `${data.reclamos.pendientes}`, c: C.warning },
          { l: "En seguimiento", v: `${data.reclamos.enSeguimiento}`, c: C.blue },
          { l: "Escalados", v: `${data.reclamos.escalados}`, c: C.danger },
          { l: "Resueltos (mes)", v: `${data.reclamos.resueltosDelMes}`, c: C.success },
        ],
      },
      {
        title: "Avisos Activos", items: [
          { l: "Vacaciones", v: `${data.avisos.vacaciones}`, c: C.blue },
          { l: "Enfermedad", v: `${data.avisos.enfermedad}`, c: C.orange },
          { l: "Medicación", v: `${data.avisos.medicacion}`, c: C.purple },
          { l: "Vuelven mañana", v: `${data.avisos.vuelvenManana}`, c: C.success },
        ],
      },
      {
        title: "Flota", items: [
          { l: "Camiones op.", v: `${data.flota.disponibles}/${data.flota.total}`, c: C.accent },
          { l: "En ruta hoy", v: `${data.flota.enRuta}`, c: C.green },
          { l: "Choferes", v: `${data.flota.choferes}`, c: C.blue },
          { l: "En mant.", v: `${data.flota.total - data.flota.disponibles}`, c: C.warning },
        ],
      },
      {
        title: "Bot WhatsApp", items: [
          { l: "Mensajes hoy", v: `${data.mensajes.total}`, c: C.accent },
          { l: "Entrantes", v: `${data.mensajes.entrantes}`, c: C.green },
          { l: "Salientes", v: `${data.mensajes.salientes}`, c: C.blue },
          { l: "Tasa resp.", v: `${data.mensajes.entrantes > 0 ? ((data.mensajes.salientes / data.mensajes.entrantes) * 100).toFixed(0) : 0}%`, c: C.purple },
        ],
      },
    ];

    const cardH = hayIncidentes ? 80 : 90;
    const itemSpacing = hayIncidentes ? 14 : 17;

    cards.forEach((card, ci) => {
      const cx = mx + ci * cw;
      doc.rect(cx + 2, y, cw - 5, cardH).fillAndStroke(C.light, "#E8E8E8");
      doc.rect(cx + 2, y, cw - 5, 17).fill(C.darkGray);
      doc.font("Helvetica-Bold").fontSize(8).fillColor(C.white).text(card.title, cx + 7, y + 4, { width: cw - 15 });

      card.items.forEach((item, ii) => {
        const iy = y + 21 + ii * itemSpacing;
        doc.rect(cx + 7, iy + 4, 5, 5).fill(item.c);
        doc.font("Helvetica").fontSize(7.5).fillColor(C.darkGray).text(item.l, cx + 15, iy + 2, { width: cw - 55 });
        doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C.primary).text(item.v, cx + cw - 42, iy + 2, { width: 35, align: "right" });
      });
    });

    y += cardH + 8;

    // ── BARRA PROGRESO MENSUAL ───────────────────
    const progPct = data.progresoMes.objetivo > 0
      ? data.progresoMes.recolectados / data.progresoMes.objetivo
      : 0;
    const barW = pw - 160;
    const barH = 14;
    const barX = mx + 130;

    doc.font("Helvetica-Bold").fontSize(8).fillColor(C.primary).text("Objetivo 260.000 L:", mx, y + 2);
    doc.rect(barX, y, barW, barH).fill("#E0E0E0");
    doc.rect(barX, y, barW * Math.min(progPct, 1), barH).fill(progPct >= 1 ? C.success : C.accent);
    doc.font("Helvetica-Bold").fontSize(7).fillColor(C.white)
      .text(`${data.progresoMes.recolectados.toLocaleString("es-AR")} L`, barX + 5, y + 3);
    doc.font("Helvetica").fontSize(7).fillColor(C.gray)
      .text(`${(progPct * 100).toFixed(1)}%`, barX + barW + 5, y + 3);

    // ── FOOTER ───────────────────────────────────
    const fy = doc.page.height - 25;
    doc.rect(0, fy, W, 25).fill(C.primary);
    doc.font("Helvetica").fontSize(7).fillColor("#A0B4D0")
      .text(
        `GARYCIO System  |  ${new Date().toLocaleString("es-AR")}  |  Ranuk Development`,
        mx, fy + 8, { width: pw, align: "center" },
      );

    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
}
