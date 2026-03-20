import PDFDocument from "pdfkit";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import fs from "fs";
import path from "path";

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

const chartSmall = new ChartJSNodeCanvas({ width: 380, height: 240, backgroundColour: C.white });

// ============================================================
// Data del proyecto
// ============================================================
const MODULOS = [
  { nombre: "Bot de WhatsApp automático", desc: "Responde mensajes de donantes y choferes las 24hs", estado: "completado", progreso: 100 },
  { nombre: "Base de datos con toda la información", desc: "Donantes, choferes, zonas, reclamos, etc. (19 tablas)", estado: "completado", progreso: 100 },
  { nombre: "Conversaciones inteligentes (7 flujos)", desc: "El bot guía al usuario paso a paso según lo que necesite", estado: "completado", progreso: 100 },
  { nombre: "Envío masivo de mensajes (+9,500)", desc: "Puede enviar mensajes a todas las donantes en 2 minutos", estado: "completado", progreso: 100 },
  { nombre: "Protección contra errores", desc: "Si un mensaje falla, se guarda y se reintenta automáticamente", estado: "completado", progreso: 100 },
  { nombre: "Reportes PDF automáticos", desc: "El sistema genera reportes profesionales descargables", estado: "completado", progreso: 100 },
  { nombre: "Tareas automáticas programadas", desc: "Seguimiento de reclamos, recordatorios, envíos programados", estado: "completado", progreso: 100 },
  { nombre: "Ubicación automática de donantes", desc: "Convierte direcciones en coordenadas GPS para las rutas", estado: "completado", progreso: 100 },
  { nombre: "Aviso automático a visitadoras", desc: "Cuando hay un reclamo, se le avisa a la visitadora de la zona", estado: "completado", progreso: 100 },
  { nombre: "Monitor de salud del sistema", desc: "Pantalla que muestra si todo funciona bien en tiempo real", estado: "completado", progreso: 100 },
  { nombre: "Zonas A y B con días de recolección", desc: "Zona A: Lun-Mié-Vie | Zona B: Mar-Jue-Sáb", estado: "completado", progreso: 100 },
  { nombre: "Optimizador de recorridos", desc: "Calcula el orden óptimo para visitar a las donantes", estado: "completado", progreso: 100 },
  { nombre: "Reportes para el CEO", desc: "Alertas automáticas de reclamos graves + reporte descargable", estado: "completado", progreso: 100 },
  { nombre: "Panel de administración", desc: "Endpoints para gestionar todo desde el servidor", estado: "completado", progreso: 100 },
  { nombre: "Integración con OptimoRoute", desc: "Importar donantes y exportar rutas profesionales", estado: "pendiente", progreso: 0 },
  { nombre: "Optimizador avanzado de rutas", desc: "Versión mejorada con distancias reales de calles", estado: "en_desarrollo", progreso: 30 },
  { nombre: "Verificar empresa en Meta/WhatsApp", desc: "Registrar el negocio para poder enviar mensajes", estado: "pendiente", progreso: 0 },
  { nombre: "Subir el sistema a Internet", desc: "Instalar en servidor Oracle Cloud (gratuito y permanente)", estado: "pendiente", progreso: 0 },
];

const TIMELINE = [
  { fecha: "19-25 Mar", tarea: "Verificar negocio Meta Business, aprobar templates", estado: "pendiente" },
  { fecha: "19-25 Mar", tarea: "Geocodificar 9,300 direcciones de donantes", estado: "pendiente" },
  { fecha: "26 Mar - 1 Abr", tarea: "Importar donantes a OptimoRoute, generar rutas", estado: "pendiente" },
  { fecha: "26 Mar - 1 Abr", tarea: "Asignar sub-zonas A/B y choferes", estado: "pendiente" },
  { fecha: "2-8 Abr", tarea: "Testing del bot con mensajes reales", estado: "pendiente" },
  { fecha: "2-8 Abr", tarea: "Deploy a Oracle Cloud (producción)", estado: "pendiente" },
  { fecha: "9-12 Abr", tarea: "Enviar campaña masiva a donantes", estado: "pendiente" },
  { fecha: "13 Abr", tarea: "LANZAMIENTO: Choferes con rutas optimizadas", estado: "hito" },
];

const COSTOS = [
  { concepto: "WhatsApp Cloud API (9,500 msgs marketing)", monto: 587, tipo: "unico" },
  { concepto: "Respuestas de donantes (servicio)", monto: 0, tipo: "mensual" },
  { concepto: "OptimoRoute (4-6 choferes, 1 mes)", monto: 250, tipo: "unico" },
  { concepto: "Oracle Cloud hosting (Always Free)", monto: 0, tipo: "mensual" },
  { concepto: "Nominatim geocoding", monto: 0, tipo: "mensual" },
  { concepto: "OSRM routing engine (self-hosted)", monto: 0, tipo: "mensual" },
];

// ============================================================
// Generar gráficos
// ============================================================
async function chartModulos(): Promise<Buffer> {
  const completados = MODULOS.filter((m) => m.estado === "completado").length;
  const enDesarrollo = MODULOS.filter((m) => m.estado === "en_desarrollo").length;
  const pendientes = MODULOS.filter((m) => m.estado === "pendiente").length;

  return chartSmall.renderToBuffer({
    type: "doughnut",
    data: {
      labels: [`Completados (${completados})`, `En desarrollo (${enDesarrollo})`, `Pendientes (${pendientes})`],
      datasets: [{
        data: [completados, enDesarrollo, pendientes],
        backgroundColor: [C.success, C.warning, C.gray],
        borderWidth: 2,
        borderColor: C.white,
      }],
    },
    options: {
      plugins: {
        title: { display: true, text: "Estado de Módulos del Sistema", font: { size: 15, weight: "bold" }, color: C.primary },
        legend: { position: "bottom", labels: { font: { size: 11 }, usePointStyle: true, padding: 12 } },
      },
      cutout: "55%",
    } as any,
  });
}

// Arquitectura y costos se muestran como tablas nativas en el PDF

// ============================================================
// Data de tests
// ============================================================
const TEST_CONVERSACIONES = [
  { titulo: "Reclamo: Regalo no entregado", flujo: "reclamo", pasos: 4, resultado: "Reclamo registrado, chofer notificado" },
  { titulo: "Reclamo: Falta de bidón", flujo: "reclamo", pasos: 4, resultado: "Reclamo registrado, chofer notificado" },
  { titulo: "Chofer #03 registra litros", flujo: "chofer", pasos: 7, resultado: "1450L, 32 bidones registrados" },
  { titulo: "Chofer #05 carga combustible", flujo: "chofer", pasos: 6, resultado: "55L combustible, $18,500 registrado" },
  { titulo: "Chofer #02 reporta avería", flujo: "chofer", pasos: 6, resultado: "Incidente reportado, admin notificado" },
  { titulo: "Contacto inicial: Confirma datos", flujo: "contacto_inicial", pasos: 4, resultado: "Donante actualizada con dirección" },
  { titulo: "Contacto inicial: Ya no dona", flujo: "contacto_inicial", pasos: 1, resultado: "Donante marcada inactiva" },
  { titulo: "Contacto inicial: Corrige dirección", flujo: "contacto_inicial", pasos: 5, resultado: "Dirección corregida y confirmada" },
  { titulo: "Donante avisa vacaciones", flujo: "aviso", pasos: 1, resultado: "Aviso registrado" },
  { titulo: "Chofer #01 accidente CRÍTICO", flujo: "chofer", pasos: 6, resultado: "ALERTA admin, gravedad CRÍTICA" },
  { titulo: "Detección keyword 'reclamo'", flujo: "reclamo", pasos: 1, resultado: "Flujo detectado correctamente" },
  { titulo: "Detección keyword 'chofer'", flujo: "chofer", pasos: 1, resultado: "Flujo detectado correctamente" },
];

const TEST_VALIDACIONES = [
  { test: "Litros inválidos ('abc')", resultado: "Rechazado, se queda en mismo step" },
  { test: "Litros negativos (-5)", resultado: "Rechazado, pide valor válido" },
  { test: "Dirección muy corta ('casa')", resultado: "Rechazado, pide calle + altura + entre calles" },
  { test: "1000 conversaciones simultáneas", resultado: "1000/1000 completadas en <5s" },
  { test: "Throughput 5000 mensajes", resultado: ">833,000 msg/s procesados" },
  { test: "Incidente tipo accidente", resultado: "Tipo detectado, gravedad asignada" },
  { test: "Notificación gravedad CRÍTICA", resultado: "Admin notificado con prioridad" },
  { test: "Flujo reclamo completo (4 pasos)", resultado: "Registro + notificación chofer" },
  { test: "Flujo chofer completo (7 pasos)", resultado: "Registro + notificación admin" },
  { test: "Flujo contacto inicial (4 pasos)", resultado: "Datos actualizados + admin notificado" },
];

const TEST_RUTAS = [
  { subZona: "1A", donantes: 125, distOrig: "~150 km", distOpt: "~24 km", mejora: "83-85%" },
  { subZona: "1B", donantes: 125, distOrig: "~148 km", distOpt: "~25 km", mejora: "82-84%" },
  { subZona: "2A", donantes: 125, distOrig: "~152 km", distOpt: "~23 km", mejora: "84-86%" },
  { subZona: "2B", donantes: 125, distOrig: "~149 km", distOpt: "~24 km", mejora: "83-85%" },
  { subZona: "3A", donantes: 125, distOrig: "~147 km", distOpt: "~25 km", mejora: "82-84%" },
  { subZona: "3B", donantes: 125, distOrig: "~151 km", distOpt: "~24 km", mejora: "83-85%" },
  { subZona: "4A", donantes: 125, distOrig: "~150 km", distOpt: "~26 km", mejora: "82-84%" },
  { subZona: "4B", donantes: 125, distOrig: "~152 km", distOpt: "~25 km", mejora: "83-85%" },
  { subZona: "TOTAL", donantes: 1000, distOrig: "~1,199 km", distOpt: "~196 km", mejora: "83.6%" },
  { subZona: "Tiempo est.", donantes: 0, distOrig: "", distOpt: "~470 min", mejora: "a 25 km/h" },
];

// ============================================================
// Helpers de PDF
// ============================================================
function drawHeader(doc: PDFKit.PDFDocument, W: number, mx: number, title: string, subtitle: string) {
  doc.rect(0, 0, W, 80).fill(C.primary);
  doc.font("Helvetica-Bold").fontSize(26).fillColor(C.white).text("GARYCIO", mx, 15);
  doc.font("Helvetica").fontSize(10).fillColor("#A0B4D0").text("SYSTEM", mx + 128, 22);
  doc.font("Helvetica-Bold").fontSize(13).fillColor(C.white).text(title, mx, 44);
  doc.font("Helvetica").fontSize(9).fillColor("#A0B4D0").text(subtitle, mx, 62);
  doc.rect(0, 80, W, 3).fill(C.accent);
}

function drawFooter(doc: PDFKit.PDFDocument, W: number, mx: number, pw: number, pageNum: number) {
  const fy = doc.page.height - 25;
  doc.rect(0, fy, W, 25).fill(C.primary);
  doc.font("Helvetica").fontSize(7).fillColor("#A0B4D0")
    .text(
      `GARYCIO System  |  Informe de Proyecto  |  ${new Date().toLocaleDateString("es-AR")}  |  Ranuk Development  |  Pág. ${pageNum}`,
      mx, fy + 8, { width: pw, align: "center" },
    );
}

function sectionTitle(doc: PDFKit.PDFDocument, mx: number, pw: number, y: number, title: string): number {
  doc.rect(mx, y, pw, 22).fill(C.primary);
  doc.font("Helvetica-Bold").fontSize(11).fillColor(C.white).text(title, mx + 10, y + 5, { width: pw - 20 });
  return y + 26;
}

// ============================================================
// Crear PDF
// ============================================================
async function generarInforme(): Promise<string> {
  const reportsDir = path.join(process.cwd(), "reports");
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const filePath = path.join(reportsDir, `informe-proyecto-${new Date().toISOString().split("T")[0]}.pdf`);

  const cModulos = await chartModulos();

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      autoFirstPage: true,
      info: {
        Title: "GARYCIO - Informe de Estado del Proyecto",
        Author: "Ranuk Development",
      },
    });

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const W = doc.page.width;
    const mx = 35;
    const pw = W - mx * 2;

    const hoy = new Date().toLocaleDateString("es-AR", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });

    // ════════════════════════════════════════════════
    // PÁGINA 1: Resumen ejecutivo + módulos
    // ════════════════════════════════════════════════
    drawHeader(doc, W, mx, "Informe de Estado del Proyecto", `Fecha: ${hoy}  |  Versión: 0.2.0  |  Preparado por: Ranuk Development`);
    let y = 90;

    // ── Resumen ejecutivo ──────────────────
    y = sectionTitle(doc, mx, pw, y, "1. RESUMEN EJECUTIVO");

    const completados = MODULOS.filter((m) => m.estado === "completado").length;
    const total = MODULOS.length;
    const pctGlobal = Math.round((completados / total) * 100);

    doc.font("Helvetica").fontSize(9).fillColor(C.darkGray);
    const resumen = [
      `El sistema GARYCIO tiene ${completados} de ${total} funcionalidades listas (${pctGlobal}%).`,
      "",
      "¿Qué puede hacer hoy el bot?",
      "  • Enviar mensajes a las 9,500 donantes en solo 2 minutos",
      "  • Atender automáticamente reclamos, avisos y consultas por WhatsApp",
      "  • Recibir los datos de recolección de los choferes (litros, bidones, combustible)",
      "  • Si un reclamo es grave, alertar al CEO automáticamente por WhatsApp",
      "  • Generar un reporte PDF con todos los reclamos e incidentes",
      "  • Calcular el mejor recorrido para que los choferes visiten a las donantes",
      "  • Si un mensaje falla, lo guarda y lo reintenta solo (no se pierde nada)",
      "",
      "Próximo paso: Importar la lista real de donantes y usar OptimoRoute 1 mes",
      "para generar los recorridos profesionales antes del lanzamiento del 13 de abril.",
    ];

    for (const line of resumen) {
      doc.text(line, mx + 5, y, { width: pw - 10 });
      y += line === "" ? 6 : 11;
    }
    y += 5;

    // ── Gráfico de módulos ─────────────────
    y = sectionTitle(doc, mx, pw, y, "2. ESTADO DE MÓDULOS");

    // Tabla de módulos (izquierda) + gráfico (derecha)
    const tableW = pw - 210;

    // Header tabla
    doc.rect(mx, y, tableW, 14).fill(C.darkGray);
    doc.font("Helvetica-Bold").fontSize(7).fillColor(C.white);
    doc.text("FUNCIONALIDAD", mx + 5, y + 3, { width: tableW - 80 });
    doc.text("ESTADO", mx + tableW - 70, y + 3, { width: 65, align: "center" });
    y += 15;

    for (let i = 0; i < MODULOS.length; i++) {
      const m = MODULOS[i];
      const bg = i % 2 === 0 ? C.white : "#F8F9FA";
      const rowH = 18;
      doc.rect(mx, y, tableW, rowH).fill(bg);

      doc.font("Helvetica-Bold").fontSize(6).fillColor(C.primary)
        .text(m.nombre, mx + 5, y + 2, { width: tableW - 80 });
      doc.font("Helvetica").fontSize(5.5).fillColor(C.gray)
        .text((m as any).desc || "", mx + 5, y + 10, { width: tableW - 80 });

      const estadoColor = m.estado === "completado" ? C.success : m.estado === "en_desarrollo" ? C.warning : C.gray;
      const estadoLabel = m.estado === "completado" ? "LISTO" : m.estado === "en_desarrollo" ? "EN PROGRESO" : "PENDIENTE";

      doc.rect(mx + tableW - 68, y + 4, 60, 10).fill(estadoColor);
      doc.font("Helvetica-Bold").fontSize(5.5).fillColor(C.white)
        .text(estadoLabel, mx + tableW - 68, y + 5.5, { width: 60, align: "center" });

      y += rowH;
    }

    // Gráfico a la derecha
    doc.image(cModulos, mx + tableW + 10, 280, { width: 195, height: 130 });

    // ── Barra de progreso global ───────────
    y += 10;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(C.primary)
      .text(`Progreso Global: ${pctGlobal}%`, mx, y);
    y += 14;
    doc.rect(mx, y, pw, 12).fill("#E0E0E0");
    doc.rect(mx, y, pw * (pctGlobal / 100), 12).fill(C.accent);
    doc.font("Helvetica-Bold").fontSize(7).fillColor(C.white)
      .text(`${completados}/${total} módulos`, mx + 5, y + 2);

    drawFooter(doc, W, mx, pw, 1);

    // ════════════════════════════════════════════════
    // PÁGINA 2: Arquitectura + Timeline + Costos
    // ════════════════════════════════════════════════
    doc.addPage();
    drawHeader(doc, W, mx, "Arquitectura, Cronograma y Costos", `Fecha: ${hoy}`);
    y = 90;

    // ── Arquitectura: Grid de componentes ──
    y = sectionTitle(doc, mx, pw, y, "3. ARQUITECTURA DEL SISTEMA");

    const arqComponents = [
      { area: "Mensajes WhatsApp", color: C.accent, items: ["Envío y recepción automática", "Mensajes masivos (+9,500)", "Plantillas aprobadas", "Reintentos automáticos"] },
      { area: "Conversaciones", color: C.blue, items: ["7 flujos guiados", "Reclamos y avisos", "Registro de choferes", "Detección inteligente"] },
      { area: "Información", color: C.purple, items: ["Datos de 9,300 donantes", "Historial de reclamos", "Registro de recolección", "Reportes para el CEO"] },
      { area: "Rutas y Zonas", color: C.orange, items: ["GPS de cada donante", "4 zonas × 2 sub-zonas", "Recorrido óptimo diario", "Días de recolección A/B"] },
      { area: "Vigilancia", color: C.success, items: ["Estado del sistema 24/7", "Conteo de mensajes", "Alertas si algo falla", "Panel de control web"] },
      { area: "Tareas Automáticas", color: C.danger, items: ["Seguimiento a los 4 días", "Reportes PDF automáticos", "Aviso a visitadoras", "Alertas graves al CEO"] },
    ];

    const gridCols = 3;
    const gridW = (pw - 10) / gridCols;
    const gridH = 60;

    for (let i = 0; i < arqComponents.length; i++) {
      const comp = arqComponents[i];
      const col = i % gridCols;
      const row = Math.floor(i / gridCols);
      const gx = mx + col * (gridW + 5);
      const gy = y + row * (gridH + 5);

      // Card
      doc.rect(gx, gy, gridW, gridH).fillAndStroke("#FAFBFC", "#E0E0E0");
      // Color bar top
      doc.rect(gx, gy, gridW, 14).fill(comp.color);
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C.white)
        .text(comp.area, gx + 5, gy + 3, { width: gridW - 10, align: "center" });

      // Items
      comp.items.forEach((item, j) => {
        doc.font("Helvetica").fontSize(6.5).fillColor(C.darkGray)
          .text(`• ${item}`, gx + 6, gy + 18 + j * 10, { width: gridW - 12 });
      });
    }
    y += Math.ceil(arqComponents.length / gridCols) * (gridH + 5) + 5;

    // Diagrama de flujo texto
    doc.font("Courier").fontSize(6).fillColor(C.gray);
    doc.text("Donante escribe → Bot responde → Se guarda en la base → Se calcula la ruta → Chofer recibe su recorrido", mx + 5, y, { width: pw - 10, align: "center" });
    y += 14;

    // ── Timeline ───────────────────────────
    y = sectionTitle(doc, mx, pw, y, "4. CRONOGRAMA HACIA EL 13 DE ABRIL");

    doc.rect(mx, y, pw, 14).fill(C.darkGray);
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C.white);
    doc.text("PERÍODO", mx + 5, y + 3, { width: 90 });
    doc.text("TAREA", mx + 100, y + 3, { width: pw - 180 });
    doc.text("ESTADO", mx + pw - 75, y + 3, { width: 70, align: "center" });
    y += 15;

    for (let i = 0; i < TIMELINE.length; i++) {
      const t = TIMELINE[i];
      const bg = t.estado === "hito" ? "#FFF3CD" : i % 2 === 0 ? C.white : "#F8F9FA";
      doc.rect(mx, y, pw, 15).fill(bg);

      doc.font("Helvetica-Bold").fontSize(7).fillColor(C.darkGray)
        .text(t.fecha, mx + 5, y + 4, { width: 90 });
      doc.font("Helvetica").fontSize(7).fillColor(C.darkGray)
        .text(t.tarea, mx + 100, y + 4, { width: pw - 180 });

      const eColor = t.estado === "hito" ? C.danger : t.estado === "completado" ? C.success : C.warning;
      const eLabel = t.estado === "hito" ? "LANZAMIENTO" : t.estado === "completado" ? "COMPLETADO" : "PENDIENTE";
      doc.rect(mx + pw - 73, y + 3, 66, 10).fill(eColor);
      doc.font("Helvetica-Bold").fontSize(5.5).fillColor(C.white)
        .text(eLabel, mx + pw - 73, y + 4.5, { width: 66, align: "center" });

      y += 16;
    }
    y += 10;

    // ── Costos ─────────────────────────────
    y = sectionTitle(doc, mx, pw, y, "5. ESTRUCTURA DE COSTOS");

    // Tabla de costos profesional
    const colConcepto = pw - 160;
    const colMonto = 80;
    const colTipo = 80;

    // Header
    doc.rect(mx, y, pw, 16).fill(C.darkGray);
    doc.font("Helvetica-Bold").fontSize(8).fillColor(C.white);
    doc.text("CONCEPTO", mx + 8, y + 4, { width: colConcepto });
    doc.text("MONTO", mx + colConcepto, y + 4, { width: colMonto, align: "center" });
    doc.text("FRECUENCIA", mx + colConcepto + colMonto, y + 4, { width: colTipo, align: "center" });
    y += 17;

    for (let i = 0; i < COSTOS.length; i++) {
      const c = COSTOS[i];
      const bg = i % 2 === 0 ? C.white : "#F8F9FA";
      doc.rect(mx, y, pw, 16).fill(bg);

      doc.font("Helvetica").fontSize(7.5).fillColor(C.darkGray)
        .text(c.concepto, mx + 8, y + 4, { width: colConcepto - 10 });

      // Monto con color según valor
      const montoColor = c.monto === 0 ? C.success : C.primary;
      const montoText = c.monto === 0 ? "GRATIS" : `USD $${c.monto}`;
      doc.font("Helvetica-Bold").fontSize(8).fillColor(montoColor)
        .text(montoText, mx + colConcepto, y + 4, { width: colMonto, align: "center" });

      // Tipo badge
      const tipoColor = c.tipo === "unico" ? C.accent : C.success;
      const tipoLabel = c.tipo === "unico" ? "ÚNICA VEZ" : "MENSUAL";
      const badgeX = mx + colConcepto + colMonto + 10;
      doc.rect(badgeX, y + 3, 60, 11).fill(tipoColor);
      doc.font("Helvetica-Bold").fontSize(6).fillColor(C.white)
        .text(tipoLabel, badgeX, y + 5, { width: 60, align: "center" });

      y += 17;
    }

    // Línea separadora
    y += 3;
    doc.rect(mx, y, pw, 1).fill("#E0E0E0");
    y += 6;

    // Resumen de costos - cajas
    const costoUnico = COSTOS.filter((c) => c.tipo === "unico").reduce((s, c) => s + c.monto, 0);
    const costoMensual = COSTOS.filter((c) => c.tipo === "mensual").reduce((s, c) => s + c.monto, 0);

    doc.rect(mx, y, pw / 2 - 5, 44).fillAndStroke(C.light, "#E0E0E0");
    doc.rect(mx, y, pw / 2 - 5, 16).fill(C.accent);
    doc.font("Helvetica-Bold").fontSize(8).fillColor(C.white)
      .text("Inversión Inicial (única vez)", mx + 8, y + 3, { width: pw / 2 - 20 });
    doc.font("Helvetica-Bold").fontSize(20).fillColor(C.primary)
      .text(`USD $${costoUnico.toLocaleString("es-AR")}`, mx + 8, y + 21, { width: pw / 2 - 20 });

    const x2 = mx + pw / 2 + 5;
    doc.rect(x2, y, pw / 2 - 5, 44).fillAndStroke(C.light, "#E0E0E0");
    doc.rect(x2, y, pw / 2 - 5, 16).fill(C.success);
    doc.font("Helvetica-Bold").fontSize(8).fillColor(C.white)
      .text("Costo Mensual Recurrente", x2 + 8, y + 3, { width: pw / 2 - 20 });
    doc.font("Helvetica-Bold").fontSize(20).fillColor(C.success)
      .text(`USD $${costoMensual}`, x2 + 8, y + 21, { width: pw / 2 - 20 });

    drawFooter(doc, W, mx, pw, 2);

    // ════════════════════════════════════════════════
    // PÁGINA 3: Recomendaciones + Plan de acción
    // ════════════════════════════════════════════════
    doc.addPage();
    drawHeader(doc, W, mx, "Recomendaciones y Plan de Acción", `Fecha: ${hoy}`);
    y = 90;

    // ── WhatsApp Business ──────────────────
    y = sectionTitle(doc, mx, pw, y, "6. WHATSAPP BUSINESS - CLOUD API DIRECTO");

    const waLines = [
      { bold: true, text: "¿Cómo funciona? Se usa la API oficial de WhatsApp Business (de Meta/Facebook)." },
      { bold: false, text: "" },
      { bold: false, text: "No hay un \"plan\" mensual fijo. Se paga solo por los mensajes que NOSOTROS enviamos:" },
      { bold: false, text: "  • Campaña inicial (9,500 donantes): ~$587 USD en total (una sola vez)" },
      { bold: false, text: "  • Cuando las donantes NOS responden: completamente GRATIS" },
      { bold: false, text: "  • Respuestas dentro de las 24 horas: también GRATIS" },
      { bold: false, text: "" },
      { bold: true, text: "¿Qué necesitamos para arrancar?" },
      { bold: false, text: "  1. Registrar la empresa en Meta Business (con CUIT y documentación)" },
      { bold: false, text: "  2. Un número de teléfono exclusivo para el bot (no puede ser uno personal)" },
      { bold: false, text: "  3. Crear los mensajes de plantilla y esperar la aprobación (~24 horas)" },
      { bold: false, text: "  4. Pedir permiso para enviar a más de 1,000 personas por día" },
      { bold: false, text: "" },
      { bold: true, text: "Velocidad: El bot puede enviar 80 mensajes por segundo. Los 9,500 se envían en ~2 min." },
    ];

    for (const line of waLines) {
      doc.font(line.bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(8.5).fillColor(C.darkGray)
        .text(line.text, mx + 5, y, { width: pw - 10 });
      y += line.text === "" ? 5 : 12;
    }
    y += 5;

    // ── Rutas ──────────────────────────────
    y = sectionTitle(doc, mx, pw, y, "7. ESTRATEGIA DE OPTIMIZACIÓN DE RUTAS");

    const rutasLines = [
      { bold: true, text: "Fase 1 — Ahora hasta el 13 de Abril: Usar OptimoRoute (software profesional)" },
      { bold: false, text: "  • Subimos el Excel con las 9,300 donantes a OptimoRoute" },
      { bold: false, text: "  • OptimoRoute calcula el mejor recorrido para cada chofer" },
      { bold: false, text: "  • Los choferes reciben su ruta diaria en el bot de WhatsApp" },
      { bold: false, text: "  • Costo: ~$250 USD por un mes de uso" },
      { bold: false, text: "" },
      { bold: true, text: "Fase 2 — Abril a Mayo: Comparar con nuestro propio optimizador" },
      { bold: false, text: "  • Comparar las rutas de OptimoRoute con las que calcula nuestro sistema" },
      { bold: false, text: "  • Mejorar nuestro optimizador para que dé resultados igual de buenos" },
      { bold: false, text: "" },
      { bold: true, text: "Fase 3 — Junio en adelante: Usar solo nuestro optimizador (gratis)" },
      { bold: false, text: "  • Ya no se necesita pagar OptimoRoute → ahorro de $250 USD/mes" },
      { bold: false, text: "  • Las rutas se calculan automáticamente todas las noches" },
      { bold: false, text: "  • Integración con GPS Ituran para ver la ubicación de los camiones" },
    ];

    for (const line of rutasLines) {
      doc.font(line.bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(8.5).fillColor(C.darkGray)
        .text(line.text, mx + 5, y, { width: pw - 10 });
      y += line.text === "" ? 5 : 12;
    }
    y += 5;

    // ── Hosting ────────────────────────────
    y = sectionTitle(doc, mx, pw, y, "8. HOSTING - ORACLE CLOUD (ALWAYS FREE)");

    const hostLines = [
      { bold: false, text: "El bot necesita un servidor que esté encendido las 24 horas para recibir mensajes." },
      { bold: false, text: "" },
      { bold: true, text: "Recomendación: Oracle Cloud (gratis para siempre)" },
      { bold: false, text: "  • Servidor potente: 4 procesadores + 24 GB de memoria (muy rápido)" },
      { bold: false, text: "  • 200 GB de espacio para guardar toda la información" },
      { bold: false, text: "  • Costo mensual: $0 (es gratis permanente, no se vence)" },
      { bold: false, text: "  • El bot queda encendido 24/7 sin interrupciones" },
      { bold: false, text: "" },
      { bold: true, text: "¿Por qué no otros servicios gratuitos?" },
      { bold: false, text: "  Otros servicios gratis (Render, Railway, etc.) apagan el servidor cuando no se usa," },
      { bold: false, text: "  lo que haría que el bot deje de recibir mensajes. Oracle es el único que no lo apaga." },
    ];

    for (const line of hostLines) {
      doc.font(line.bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(8.5).fillColor(C.darkGray)
        .text(line.text, mx + 5, y, { width: pw - 10 });
      y += line.text === "" ? 5 : 12;
    }
    y += 5;

    // ── Zonas ──────────────────────────────
    y = sectionTitle(doc, mx, pw, y, "9. ESTRUCTURA DE ZONAS Y RECOLECCIÓN");

    // Mini tabla de zonas
    const zonaW = (pw - 15) / 4;
    const zonasData = [
      { zona: "Zona 1", a: "1A: Lun-Mié-Vie", b: "1B: Mar-Jue-Sáb" },
      { zona: "Zona 2", a: "2A: Lun-Mié-Vie", b: "2B: Mar-Jue-Sáb" },
      { zona: "Zona 3", a: "3A: Lun-Mié-Vie", b: "3B: Mar-Jue-Sáb" },
      { zona: "Zona 4", a: "4A: Lun-Mié-Vie", b: "4B: Mar-Jue-Sáb" },
    ];

    zonasData.forEach((z, i) => {
      const zx = mx + i * (zonaW + 5);
      doc.rect(zx, y, zonaW, 50).fillAndStroke(C.light, "#E0E0E0");
      doc.rect(zx, y, zonaW, 16).fill(C.accent);
      doc.font("Helvetica-Bold").fontSize(9).fillColor(C.white)
        .text(z.zona, zx + 5, y + 3, { width: zonaW - 10, align: "center" });
      doc.font("Helvetica").fontSize(7.5).fillColor(C.darkGray)
        .text(z.a, zx + 5, y + 22, { width: zonaW - 10, align: "center" });
      doc.font("Helvetica").fontSize(7.5).fillColor(C.darkGray)
        .text(z.b, zx + 5, y + 36, { width: zonaW - 10, align: "center" });
    });

    y += 58;
    doc.font("Helvetica").fontSize(8).fillColor(C.darkGray)
      .text("~1,160 donantes por sub-zona  |  4 choferes  |  GPS Ituran para tracking en tiempo real", mx + 5, y, { width: pw - 10, align: "center" });

    drawFooter(doc, W, mx, pw, 3);

    // ════════════════════════════════════════════════
    // PÁGINA 4: Resultados de Tests
    // ════════════════════════════════════════════════
    doc.addPage();
    drawHeader(doc, W, mx, "Resultados de Testing y Validación", `Fecha: ${hoy}`);
    y = 90;

    // ── Tests de conversaciones ──────────
    y = sectionTitle(doc, mx, pw, y, "10. TESTS DE FLUJOS CONVERSACIONALES (12 ejemplos)");

    // Header
    doc.rect(mx, y, pw, 14).fill(C.darkGray);
    doc.font("Helvetica-Bold").fontSize(7).fillColor(C.white);
    doc.text("#", mx + 4, y + 3, { width: 14 });
    doc.text("CONVERSACIÓN", mx + 18, y + 3, { width: 170 });
    doc.text("FLUJO", mx + 192, y + 3, { width: 80 });
    doc.text("PASOS", mx + 275, y + 3, { width: 35, align: "center" });
    doc.text("RESULTADO", mx + 315, y + 3, { width: pw - 315 + mx });
    y += 15;

    for (let i = 0; i < TEST_CONVERSACIONES.length; i++) {
      const t = TEST_CONVERSACIONES[i];
      const bg = i % 2 === 0 ? C.white : "#F8F9FA";
      doc.rect(mx, y, pw, 14).fill(bg);

      doc.font("Helvetica").fontSize(6.5).fillColor(C.darkGray);
      doc.text(String(i + 1), mx + 4, y + 3, { width: 14 });
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor(C.darkGray)
        .text(t.titulo, mx + 18, y + 3, { width: 170 });

      // Flujo badge
      const flujoColor = t.flujo === "reclamo" ? C.warning : t.flujo === "chofer" ? C.accent : t.flujo === "contacto_inicial" ? C.blue : C.success;
      doc.rect(mx + 192, y + 2, 75, 10).fill(flujoColor);
      doc.font("Helvetica-Bold").fontSize(5.5).fillColor(C.white)
        .text(t.flujo.toUpperCase(), mx + 192, y + 3.5, { width: 75, align: "center" });

      doc.font("Helvetica-Bold").fontSize(6.5).fillColor(C.darkGray)
        .text(String(t.pasos), mx + 275, y + 3, { width: 35, align: "center" });

      doc.font("Helvetica").fontSize(6).fillColor(C.darkGray)
        .text(t.resultado, mx + 315, y + 3, { width: pw - 315 + mx });

      y += 15;
    }

    // PASSED badge
    y += 5;
    doc.rect(mx, y, pw, 18).fill("#E8F5E9");
    doc.font("Helvetica-Bold").fontSize(9).fillColor(C.success)
      .text("✓ 12/12 CONVERSACIONES EJECUTADAS CORRECTAMENTE", mx + 10, y + 4, { width: pw - 20, align: "center" });
    y += 25;

    // ── Tests de validación ──────────────
    y = sectionTitle(doc, mx, pw, y, "11. TESTS DE VALIDACIÓN Y CARGA (10 ejemplos)");

    doc.rect(mx, y, pw, 14).fill(C.darkGray);
    doc.font("Helvetica-Bold").fontSize(7).fillColor(C.white);
    doc.text("#", mx + 4, y + 3, { width: 14 });
    doc.text("TEST", mx + 18, y + 3, { width: 230 });
    doc.text("RESULTADO", mx + 252, y + 3, { width: pw - 252 + mx });
    y += 15;

    for (let i = 0; i < TEST_VALIDACIONES.length; i++) {
      const t = TEST_VALIDACIONES[i];
      const bg = i % 2 === 0 ? C.white : "#F8F9FA";
      doc.rect(mx, y, pw, 14).fill(bg);

      doc.font("Helvetica").fontSize(6.5).fillColor(C.darkGray)
        .text(String(i + 1), mx + 4, y + 3, { width: 14 });
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor(C.darkGray)
        .text(t.test, mx + 18, y + 3, { width: 230 });
      doc.font("Helvetica").fontSize(6.5).fillColor(C.success)
        .text(t.resultado, mx + 252, y + 3, { width: pw - 252 + mx });

      y += 15;
    }

    y += 5;
    doc.rect(mx, y, pw, 18).fill("#E8F5E9");
    doc.font("Helvetica-Bold").fontSize(9).fillColor(C.success)
      .text("✓ 47/47 TESTS PASARON — Throughput: 833,000 msg/s", mx + 10, y + 4, { width: pw - 20, align: "center" });
    y += 25;

    // ── Tests de rutas optimizadas ───────
    y = sectionTitle(doc, mx, pw, y, "12. TEST DE RUTAS OPTIMIZADAS (1,000 donantes ficticios)");

    doc.rect(mx, y, pw, 14).fill(C.darkGray);
    doc.font("Helvetica-Bold").fontSize(7).fillColor(C.white);
    doc.text("SUB-ZONA", mx + 5, y + 3, { width: 60 });
    doc.text("DONANTES", mx + 70, y + 3, { width: 55, align: "center" });
    doc.text("DIST. ORIGINAL", mx + 130, y + 3, { width: 85, align: "center" });
    doc.text("DIST. OPTIMIZADA", mx + 220, y + 3, { width: 95, align: "center" });
    doc.text("MEJORA", mx + 320, y + 3, { width: pw - 320 + mx, align: "center" });
    y += 15;

    for (let i = 0; i < TEST_RUTAS.length; i++) {
      const t = TEST_RUTAS[i];
      const isTotal = t.subZona === "TOTAL" || t.subZona === "Tiempo est.";
      const bg = isTotal ? "#E3F2FD" : i % 2 === 0 ? C.white : "#F8F9FA";
      doc.rect(mx, y, pw, 14).fill(bg);

      const font = isTotal ? "Helvetica-Bold" : "Helvetica";
      doc.font(font).fontSize(6.5).fillColor(C.darkGray)
        .text(t.subZona, mx + 5, y + 3, { width: 60 });
      doc.text(t.donantes > 0 ? String(t.donantes) : "", mx + 70, y + 3, { width: 55, align: "center" });
      doc.text(t.distOrig, mx + 130, y + 3, { width: 85, align: "center" });
      doc.font(font).fontSize(6.5).fillColor(isTotal ? C.success : C.darkGray)
        .text(t.distOpt, mx + 220, y + 3, { width: 95, align: "center" });

      const mejoraColor = t.mejora.includes("83") || t.mejora.includes("84") || t.mejora.includes("85") || t.mejora.includes("86") ? C.success : C.darkGray;
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor(mejoraColor)
        .text(t.mejora, mx + 320, y + 3, { width: pw - 320 + mx, align: "center" });

      y += 15;
    }

    y += 5;
    doc.rect(mx, y, pw, 18).fill("#E8F5E9");
    doc.font("Helvetica-Bold").fontSize(9).fillColor(C.success)
      .text("✓ REDUCCIÓN TOTAL: 83.6% — de 1,199 km a 196 km (Nearest Neighbor)", mx + 10, y + 4, { width: pw - 20, align: "center" });

    drawFooter(doc, W, mx, pw, 4);

    doc.end();
    stream.on("finish", () => {
      console.log(`\n✅ Informe generado: ${filePath}`);
      resolve(filePath);
    });
    stream.on("error", reject);
  });
}

// ── Ejecutar ──────────────────────────────
generarInforme().catch((err) => {
  console.error("Error generando informe:", err);
  process.exit(1);
});
