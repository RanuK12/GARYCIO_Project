/**
 * Script para generar un reporte PDF de ejemplo con datos ficticios.
 * Todo en una sola hoja A4.
 *
 * Uso: npx ts-node scripts/generar-reporte-ejemplo.ts
 */
import PDFDocument from "pdfkit";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import fs from "fs";
import path from "path";

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

const chartSmall = new ChartJSNodeCanvas({ width: 400, height: 220, backgroundColour: C.white });
const chartWide = new ChartJSNodeCanvas({ width: 700, height: 240, backgroundColour: C.white });

const D = {
  fecha: new Date(),
  litrosHoy: 4250,
  bidonesHoy: 85,
  progresoMes: { recolectados: 100100, objetivo: 260000 },
  litrosPorDia: [
    { dia: 1, litros: 7800 }, { dia: 2, litros: 8200 }, { dia: 3, litros: 7500 },
    { dia: 4, litros: 9100 }, { dia: 5, litros: 0 }, { dia: 6, litros: 0 },
    { dia: 7, litros: 8400 }, { dia: 8, litros: 7900 }, { dia: 9, litros: 8600 },
    { dia: 10, litros: 9200 }, { dia: 11, litros: 8100 }, { dia: 12, litros: 0 },
    { dia: 13, litros: 0 }, { dia: 14, litros: 4250 },
  ],
  donantes: { activas: 312, nuevas: 8, enPausa: 15, total: 340 },
  reclamos: { pendientes: 3, enSeguimiento: 2, escalados: 1, resueltosDelMes: 7 },
  avisos: { vacaciones: 5, enfermedad: 3, medicacion: 2, vuelvenManana: 1 },
  flota: { total: 5, disponibles: 4, enRuta: 3, choferes: 6 },
  mensajes: { total: 47, entrantes: 28, salientes: 19 },
  incidentes: [
    { choferCodigo: "03", tipo: "Retraso significativo", gravedad: "media", descripcion: "Corte de calle por obra en Av. Rivadavia, desvío de 20 minutos", hora: "11:45" },
    { choferCodigo: "01", tipo: "Avería del camión", gravedad: "alta", descripcion: "Falla en el sistema de frenos, camión detenido en zona 2", hora: "14:20" },
  ],
};

async function main() {
  console.log("Generando reporte PDF de ejemplo...\n");
  const dir = path.join(process.cwd(), "reports");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "EJEMPLO_reporte-diario.pdf");

  const [cProgreso, cLitros, cDonantes] = await Promise.all([
    chartProgreso(), chartLitros(), chartDonantes(),
  ]);

  await crearPDF(filePath, cProgreso, cLitros, cDonantes);
  console.log(`PDF generado: ${filePath}`);
  console.log(`Tamaño: ${(fs.statSync(filePath).size / 1024).toFixed(1)} KB`);
}

async function chartProgreso(): Promise<Buffer> {
  const pct = (D.progresoMes.recolectados / D.progresoMes.objetivo) * 100;
  return chartSmall.renderToBuffer({
    type: "doughnut",
    data: {
      labels: ["Recolectado", "Faltante"],
      datasets: [{ data: [pct, 100 - pct], backgroundColor: [C.accent, "#E0E0E0"], borderWidth: 0 }],
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

async function chartLitros(): Promise<Buffer> {
  const dias = D.litrosPorDia.map((d) => `${d.dia}`);
  const litros = D.litrosPorDia.map((d) => d.litros);
  const obj = D.progresoMes.objetivo / 30;
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
        title: { display: true, text: "Litros por Dia - Marzo 2026", font: { size: 14, weight: "bold" }, color: C.primary },
        legend: { position: "bottom", labels: { font: { size: 10 }, usePointStyle: true, padding: 8 } },
      },
      scales: {
        y: { beginAtZero: true, ticks: { font: { size: 9 } }, grid: { color: "#F0F0F0" } },
        x: { ticks: { font: { size: 9 } }, grid: { display: false } },
      },
    },
  });
}

async function chartDonantes(): Promise<Buffer> {
  return chartSmall.renderToBuffer({
    type: "doughnut",
    data: {
      labels: ["Activas", "Nuevas", "En pausa"],
      datasets: [{ data: [D.donantes.activas, D.donantes.nuevas, D.donantes.enPausa], backgroundColor: [C.green, C.blue, C.orange], borderWidth: 2, borderColor: C.white }],
    },
    options: {
      plugins: {
        title: { display: true, text: `Donantes (${D.donantes.total} total)`, font: { size: 14, weight: "bold" }, color: C.primary },
        legend: { position: "bottom", labels: { font: { size: 10 }, usePointStyle: true, padding: 8 } },
      },
      cutout: "55%",
    } as any,
  });
}

async function crearPDF(filePath: string, cProg: Buffer, cLit: Buffer, cDon: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      autoFirstPage: true,
      info: { Title: "Reporte GARYCIO - Ejemplo", Author: "GARYCIO System" },
    });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const W = doc.page.width;   // 595.28
    const mx = 35;              // margen horizontal
    const pw = W - mx * 2;      // ancho útil ~525

    const fecha = D.fecha.toLocaleDateString("es-AR", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });

    const hayIncidentes = D.incidentes.length > 0;

    // ── HEADER (70pt) ─────────────────────────────
    doc.rect(0, 0, W, 70).fill(C.primary);
    doc.font("Helvetica-Bold").fontSize(22).fillColor(C.white).text("GARYCIO", mx, 15);
    doc.font("Helvetica").fontSize(10).fillColor("#A0B4D0").text("SYSTEM", mx + 110, 20);
    doc.font("Helvetica").fontSize(11).fillColor(C.white).text("Reporte Diario de Operaciones", mx, 40);
    doc.fontSize(9).fillColor("#A0B4D0").text(fecha, mx, 54);

    if (hayIncidentes) {
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#E74C3C")
        .text(`⚠ ${D.incidentes.length} INCIDENTE${D.incidentes.length > 1 ? "S" : ""}`, W - mx - 130, 52, { width: 130, align: "right" });
    }

    doc.rect(0, 70, W, 3).fill(C.accent);

    // ── KPIs (50pt) ──────────────────────────────
    let y = 80;
    const kw = pw / 4;
    const prom = (D.litrosHoy / D.bidonesHoy).toFixed(1);
    const pct = ((D.progresoMes.recolectados / D.progresoMes.objetivo) * 100).toFixed(1);

    const kpis = [
      { label: "LITROS HOY", value: D.litrosHoy.toLocaleString("es-AR"), color: C.accent },
      { label: "BIDONES HOY", value: `${D.bidonesHoy}`, color: C.green },
      { label: "PROM/BIDON", value: `${prom} L`, color: C.orange },
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

    // ── CHARTS FILA 1: progreso + donantes (130pt) ──
    const halfW = (pw - 10) / 2;
    doc.image(cProg, mx, y, { width: halfW, height: 125 });
    doc.image(cDon, mx + halfW + 10, y, { width: halfW, height: 125 });
    y += 132;

    // ── CHART: litros por día (150pt) ────────────────
    doc.image(cLit, mx, y, { width: pw, height: 145 });
    y += 152;

    // ── INCIDENTES (si hay) ───────────────────────────
    if (hayIncidentes) {
      doc.rect(mx, y, pw, 18).fill("#E74C3C");
      doc.font("Helvetica-Bold").fontSize(9).fillColor(C.white)
        .text(`Incidentes del Día (${D.incidentes.length})`, mx + 8, y + 4, { width: pw - 16 });
      y += 20;

      doc.rect(mx, y, pw, 13).fill("#F0F0F0");
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor(C.darkGray);
      doc.text("HORA", mx + 4, y + 3, { width: 35 });
      doc.text("CHOFER", mx + 42, y + 3, { width: 35 });
      doc.text("TIPO", mx + 82, y + 3, { width: 100 });
      doc.text("GRAV.", mx + 185, y + 3, { width: 35 });
      doc.text("DESCRIPCIÓN", mx + 225, y + 3, { width: pw - 230 });
      y += 14;

      const gCol: Record<string, string> = { baja: "#27AE60", media: "#F39C12", alta: "#E67E22", critica: "#E74C3C" };

      for (let i = 0; i < D.incidentes.length; i++) {
        const inc = D.incidentes[i];
        doc.rect(mx, y, pw, 13).fill(i % 2 === 0 ? C.white : "#FAFAFA");
        doc.font("Helvetica").fontSize(6.5).fillColor(C.darkGray);
        doc.text(inc.hora, mx + 4, y + 3, { width: 35 });
        doc.text(`#${inc.choferCodigo}`, mx + 42, y + 3, { width: 35 });
        doc.text(inc.tipo, mx + 82, y + 3, { width: 100 });
        doc.rect(mx + 185, y + 4, 5, 5).fill(gCol[inc.gravedad] || C.gray);
        doc.font("Helvetica").fontSize(6.5).fillColor(C.darkGray)
          .text(inc.gravedad.toUpperCase(), mx + 193, y + 3, { width: 30 });
        doc.font("Helvetica").fontSize(6).fillColor(C.darkGray)
          .text(inc.descripcion, mx + 225, y + 3, { width: pw - 230 });
        y += 14;
      }
      y += 4;
    }

    // ── RESUMEN OPERATIVO ────────────────────────────
    // Título
    doc.rect(mx, y, pw, 20).fill(C.primary);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(C.white).text("Resumen Operativo", mx + 8, y + 5, { width: pw - 16 });
    y += 24;

    // 4 columnas compactas
    const cols = 4;
    const cw = pw / cols;

    const cards = [
      {
        title: "Reclamos", items: [
          { l: "Pendientes", v: `${D.reclamos.pendientes}`, c: C.warning },
          { l: "En seguimiento", v: `${D.reclamos.enSeguimiento}`, c: C.blue },
          { l: "Escalados", v: `${D.reclamos.escalados}`, c: C.danger },
          { l: "Resueltos (mes)", v: `${D.reclamos.resueltosDelMes}`, c: C.success },
        ],
      },
      {
        title: "Avisos Activos", items: [
          { l: "Vacaciones", v: `${D.avisos.vacaciones}`, c: C.blue },
          { l: "Enfermedad", v: `${D.avisos.enfermedad}`, c: C.orange },
          { l: "Medicacion", v: `${D.avisos.medicacion}`, c: C.purple },
          { l: "Vuelven manana", v: `${D.avisos.vuelvenManana}`, c: C.success },
        ],
      },
      {
        title: "Flota", items: [
          { l: "Camiones op.", v: `${D.flota.disponibles}/${D.flota.total}`, c: C.accent },
          { l: "En ruta hoy", v: `${D.flota.enRuta}`, c: C.green },
          { l: "Choferes", v: `${D.flota.choferes}`, c: C.blue },
          { l: "En mant.", v: `${D.flota.total - D.flota.disponibles}`, c: C.warning },
        ],
      },
      {
        title: "Bot WhatsApp", items: [
          { l: "Mensajes hoy", v: `${D.mensajes.total}`, c: C.accent },
          { l: "Entrantes", v: `${D.mensajes.entrantes}`, c: C.green },
          { l: "Salientes", v: `${D.mensajes.salientes}`, c: C.blue },
          { l: "Tasa resp.", v: `${D.mensajes.entrantes > 0 ? ((D.mensajes.salientes / D.mensajes.entrantes) * 100).toFixed(0) : 0}%`, c: C.purple },
        ],
      },
    ];

    const cardH = hayIncidentes ? 80 : 90;
    const itemSp = hayIncidentes ? 14 : 17;
    cards.forEach((card, ci) => {
      const cx = mx + ci * cw;
      doc.rect(cx + 2, y, cw - 5, cardH).fillAndStroke(C.light, "#E8E8E8");
      doc.rect(cx + 2, y, cw - 5, 17).fill(C.darkGray);
      doc.font("Helvetica-Bold").fontSize(8).fillColor(C.white).text(card.title, cx + 7, y + 4, { width: cw - 15 });

      card.items.forEach((item, ii) => {
        const iy = y + 21 + ii * itemSp;
        doc.rect(cx + 7, iy + 4, 5, 5).fill(item.c);
        doc.font("Helvetica").fontSize(7.5).fillColor(C.darkGray).text(item.l, cx + 15, iy + 2, { width: cw - 55 });
        doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C.primary).text(item.v, cx + cw - 42, iy + 2, { width: 35, align: "right" });
      });
    });

    y += cardH + 8;

    // ── BARRA PROGRESO MENSUAL ───────────────────────
    const progPct = D.progresoMes.recolectados / D.progresoMes.objetivo;
    const barW = pw - 160;
    const barH = 14;
    const barX = mx + 130;

    doc.font("Helvetica-Bold").fontSize(8).fillColor(C.primary).text("Objetivo 260.000 L:", mx, y + 2);
    doc.rect(barX, y, barW, barH).fill("#E0E0E0");
    doc.rect(barX, y, barW * Math.min(progPct, 1), barH).fill(progPct >= 1 ? C.success : C.accent);
    doc.font("Helvetica-Bold").fontSize(7).fillColor(C.white)
      .text(`${D.progresoMes.recolectados.toLocaleString("es-AR")} L`, barX + 5, y + 3);
    doc.font("Helvetica").fontSize(7).fillColor(C.gray)
      .text(`${(progPct * 100).toFixed(1)}%`, barX + barW + 5, y + 3);

    // ── FOOTER ───────────────────────────────────────
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

main().catch(console.error);
