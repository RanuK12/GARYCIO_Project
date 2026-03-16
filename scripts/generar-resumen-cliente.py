"""
Genera un PDF profesional de resumen técnico para el cliente de GARYCIO.
Explica todo lo desarrollado en la Fase 1 de forma clara y visual.

Uso: python scripts/generar-resumen-cliente.py
"""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable,
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
from reportlab.pdfgen.canvas import Canvas

# ── Colores ──────────────────────────────────────────
PRIMARY = HexColor("#1B2A4A")
ACCENT = HexColor("#2E86AB")
SUCCESS = HexColor("#27AE60")
WARNING = HexColor("#F39C12")
DANGER = HexColor("#E74C3C")
LIGHT = HexColor("#F5F6F8")
WHITE = HexColor("#FFFFFF")
GRAY = HexColor("#7F8C8D")
DARK = HexColor("#2C3E50")
LIGHT_ACCENT = HexColor("#D6EAF8")

# ── Estilos ──────────────────────────────────────────
style_title = ParagraphStyle(
    "Title", fontName="Helvetica-Bold", fontSize=28,
    textColor=WHITE, alignment=TA_CENTER, leading=34,
)
style_subtitle = ParagraphStyle(
    "Subtitle", fontName="Helvetica", fontSize=14,
    textColor=HexColor("#A0B4D0"), alignment=TA_CENTER, leading=18,
)
style_h1 = ParagraphStyle(
    "H1", fontName="Helvetica-Bold", fontSize=18,
    textColor=PRIMARY, spaceBefore=18, spaceAfter=10, leading=22,
)
style_h2 = ParagraphStyle(
    "H2", fontName="Helvetica-Bold", fontSize=13,
    textColor=ACCENT, spaceBefore=14, spaceAfter=6, leading=16,
)
style_body = ParagraphStyle(
    "Body", fontName="Helvetica", fontSize=10,
    textColor=DARK, alignment=TA_JUSTIFY, leading=14,
    spaceBefore=4, spaceAfter=4,
)
style_body_bold = ParagraphStyle(
    "BodyBold", fontName="Helvetica-Bold", fontSize=10,
    textColor=DARK, leading=14, spaceBefore=2, spaceAfter=2,
)
style_bullet = ParagraphStyle(
    "Bullet", fontName="Helvetica", fontSize=10,
    textColor=DARK, leftIndent=20, leading=14,
    spaceBefore=2, spaceAfter=2, bulletIndent=8,
)
style_small = ParagraphStyle(
    "Small", fontName="Helvetica", fontSize=8,
    textColor=GRAY, alignment=TA_CENTER, leading=10,
)
style_footer = ParagraphStyle(
    "Footer", fontName="Helvetica", fontSize=7,
    textColor=HexColor("#A0B4D0"), alignment=TA_CENTER,
)
style_check = ParagraphStyle(
    "Check", fontName="Helvetica", fontSize=10,
    textColor=SUCCESS, leftIndent=20, leading=14,
    spaceBefore=2, spaceAfter=2, bulletIndent=8,
)

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "docs")
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "GARYCIO_Resumen_Tecnico.pdf")


def header_footer(canvas: Canvas, doc):
    """Dibuja header y footer en cada página."""
    canvas.saveState()
    w, h = A4

    # Footer
    canvas.setFillColor(PRIMARY)
    canvas.rect(0, 0, w, 22 * mm, fill=1, stroke=0)
    canvas.setFillColor(HexColor("#A0B4D0"))
    canvas.setFont("Helvetica", 7)
    canvas.drawCentredString(
        w / 2, 6 * mm,
        "GARYCIO System  |  Documento confidencial  |  Ranuk Development  |  2026",
    )

    # Línea superior accent
    if doc.page > 1:
        canvas.setFillColor(ACCENT)
        canvas.rect(0, h - 3 * mm, w, 3 * mm, fill=1, stroke=0)

    # Número de página
    canvas.setFillColor(WHITE)
    canvas.setFont("Helvetica-Bold", 8)
    canvas.drawRightString(w - 15 * mm, 6 * mm, f"Pág. {doc.page}")

    canvas.restoreState()


def cover_page(canvas: Canvas, doc):
    """Página de portada."""
    canvas.saveState()
    w, h = A4

    # Fondo completo
    canvas.setFillColor(PRIMARY)
    canvas.rect(0, 0, w, h, fill=1, stroke=0)

    # Footer portada
    canvas.setFillColor(HexColor("#A0B4D0"))
    canvas.setFont("Helvetica", 8)
    canvas.drawCentredString(w / 2, 20 * mm, "Documento confidencial  |  Ranuk Development  |  Marzo 2026")

    canvas.restoreState()


def build_pdf():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    doc = SimpleDocTemplate(
        OUTPUT_FILE,
        pagesize=A4,
        topMargin=20 * mm,
        bottomMargin=28 * mm,
        leftMargin=22 * mm,
        rightMargin=22 * mm,
    )

    story = []
    pw = doc.width  # ancho útil

    # ═══════════════════════════════════════════════════
    # PORTADA
    # ═══════════════════════════════════════════════════
    story.append(Spacer(1, 100 * mm))
    story.append(Paragraph("GARYCIO", style_title))
    story.append(Spacer(1, 5 * mm))
    story.append(Paragraph("Sistema de Gestión Logística", style_subtitle))
    story.append(Spacer(1, 15 * mm))
    story.append(Paragraph("Resumen Técnico - Fase 1", ParagraphStyle(
        "ST2", fontName="Helvetica-Bold", fontSize=16,
        textColor=ACCENT, alignment=TA_CENTER, leading=20,
    )))
    story.append(Spacer(1, 8 * mm))
    story.append(Paragraph("Marzo 2026", ParagraphStyle(
        "Date", fontName="Helvetica", fontSize=12,
        textColor=HexColor("#A0B4D0"), alignment=TA_CENTER,
    )))
    story.append(Spacer(1, 30 * mm))

    # Info cards en portada
    cover_data = [
        ["Desarrollado por", "Ranuk Development"],
        ["Contacto", "Emilio Ranucoli"],
        ["Estado", "Fase 1 - En desarrollo"],
        ["Entrega estimada", "13 de Abril, 2026"],
    ]
    cover_table = Table(cover_data, colWidths=[pw * 0.4, pw * 0.4])
    cover_table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (0, -1), "Helvetica"),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("TEXTCOLOR", (0, 0), (0, -1), HexColor("#8899AA")),
        ("TEXTCOLOR", (1, 0), (1, -1), WHITE),
        ("ALIGN", (0, 0), (0, -1), "RIGHT"),
        ("ALIGN", (1, 0), (1, -1), "LEFT"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(cover_table)

    story.append(PageBreak())

    # ═══════════════════════════════════════════════════
    # PÁGINA 2: Resumen ejecutivo
    # ═══════════════════════════════════════════════════
    story.append(Paragraph("Resumen Ejecutivo", style_h1))
    story.append(HRFlowable(width="100%", thickness=2, color=ACCENT, spaceBefore=2, spaceAfter=10))

    story.append(Paragraph(
        "GARYCIO es un sistema integral de gestión logística diseñado específicamente para optimizar "
        "las operaciones diarias de recolección. El sistema automatiza la comunicación con donantes "
        "a través de WhatsApp, gestiona la flota de vehículos, y proporciona reportes detallados "
        "en tiempo real para la toma de decisiones.",
        style_body,
    ))
    story.append(Spacer(1, 5 * mm))

    story.append(Paragraph("Objetivos principales de la Fase 1:", style_body_bold))
    objectives = [
        "Automatizar la comunicación con donantes vía WhatsApp (bot inteligente)",
        "Digitalizar la base de datos de donantes (migración de registros físicos)",
        "Implementar sistema de reportes diarios automáticos con estadísticas",
        "Permitir a los choferes reportar datos operativos y incidentes en tiempo real",
        "Gestionar reclamos, avisos y altas de nuevas donantes de forma automatizada",
    ]
    for obj in objectives:
        story.append(Paragraph(f"•  {obj}", style_bullet))

    story.append(Spacer(1, 8 * mm))

    # Estilos de celda (definidos antes de las tablas)
    cell_style = ParagraphStyle("Cell", fontName="Helvetica", fontSize=8, textColor=DARK, leading=10)
    cell_bold = ParagraphStyle("CellBold", fontName="Helvetica-Bold", fontSize=8, textColor=ACCENT, leading=10)
    cell_header = ParagraphStyle("CellH", fontName="Helvetica-Bold", fontSize=8, textColor=WHITE, leading=10)
    cell_center_dark = ParagraphStyle("CellCD", fontName="Helvetica", fontSize=9, textColor=DARK, leading=12, alignment=TA_CENTER)

    # Tabla de alcance
    story.append(Paragraph("Alcance del Proyecto", style_h2))
    scope_data = [
        [Paragraph("Componente", cell_header), Paragraph("Fase 1 (Actual)", cell_header), Paragraph("Fase 2 (Futuro)", cell_header)],
        [Paragraph("Bot WhatsApp", cell_style), Paragraph("Completo", cell_center_dark), Paragraph("Mejoras", cell_center_dark)],
        [Paragraph("Base de datos", cell_style), Paragraph("Completo", cell_center_dark), Paragraph("Expansión", cell_center_dark)],
        [Paragraph("Reportes PDF", cell_style), Paragraph("Completo", cell_center_dark), Paragraph("Dashboard web", cell_center_dark)],
        [Paragraph("Gestión choferes", cell_style), Paragraph("Completo", cell_center_dark), Paragraph("App móvil", cell_center_dark)],
        [Paragraph("Incidentes", cell_style), Paragraph("Completo", cell_center_dark), Paragraph("Tracking GPS", cell_center_dark)],
        [Paragraph("App móvil", cell_style), Paragraph("—", cell_center_dark), Paragraph("Desarrollo", cell_center_dark)],
        [Paragraph("Panel web", cell_style), Paragraph("—", cell_center_dark), Paragraph("Desarrollo", cell_center_dark)],
        [Paragraph("Optimización rutas", cell_style), Paragraph("—", cell_center_dark), Paragraph("Desarrollo", cell_center_dark)],
    ]
    scope_table = Table(scope_data, colWidths=[pw * 0.35, pw * 0.3, pw * 0.3])
    scope_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, LIGHT]),
        ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#DEE2E6")),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(scope_table)

    story.append(PageBreak())

    # ═══════════════════════════════════════════════════
    # PÁGINA 3: Bot de WhatsApp
    # ═══════════════════════════════════════════════════
    story.append(Paragraph("Bot de WhatsApp", style_h1))
    story.append(HRFlowable(width="100%", thickness=2, color=ACCENT, spaceBefore=2, spaceAfter=10))

    story.append(Paragraph(
        "El corazón del sistema es un bot de WhatsApp que funciona como único punto de contacto "
        "con las donantes. Funciona las 24 horas del día, los 7 días de la semana, y maneja "
        "automáticamente las conversaciones más frecuentes sin necesidad de intervención humana.",
        style_body,
    ))
    story.append(Spacer(1, 4 * mm))

    story.append(Paragraph("Flujos de conversación implementados:", style_h2))

    flows = [
        [Paragraph("Flujo", cell_header), Paragraph("Descripción", cell_header), Paragraph("Acciones automáticas", cell_header)],
        [Paragraph("Contacto Inicial", cell_bold), Paragraph("Donantes de zonas nuevas: confirma si donan, qué día, y pide dirección exacta", cell_style),
         Paragraph("Recolecta dirección exacta (calle, nro, entre calles, piso/depto, barrio) para reorganizar recorridos", cell_style)],
        [Paragraph("Reclamos", cell_bold), Paragraph("Falta de regalo, bidón, pelela nueva, otros", cell_style),
         Paragraph("Notifica al chofer, seguimiento a los 4 días, escalamiento", cell_style)],
        [Paragraph("Avisos", cell_bold), Paragraph("Vacaciones, enfermedad o medicación", cell_style),
         Paragraph("Registra fecha de vuelta, recuerda al chofer cuando regresa", cell_style)],
        [Paragraph("Nueva Donante", cell_bold), Paragraph("Alta de una nueva donante al sistema", cell_style),
         Paragraph("Captura nombre, dirección, días, notifica al chofer de zona", cell_style)],
        [Paragraph("Consulta General", cell_bold), Paragraph("Preguntas frecuentes: días, regalos, etc.", cell_style),
         Paragraph("Respuestas automáticas, escalamiento si no puede resolver", cell_style)],
        [Paragraph("Chofer", cell_bold), Paragraph("Interfaz para que los choferes reporten datos del día", cell_style),
         Paragraph("Registro de litros, bidones, combustible e incidentes", cell_style)],
        [Paragraph("Reporte", cell_bold), Paragraph("El CEO envía \"reporte\" y recibe el PDF al instante", cell_style),
         Paragraph("Genera PDF on-demand, cancela el envío automático del día", cell_style)],
    ]
    flow_table = Table(flows, colWidths=[pw * 0.17, pw * 0.38, pw * 0.42])
    flow_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, LIGHT]),
        ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#DEE2E6")),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(flow_table)
    story.append(Spacer(1, 6 * mm))

    story.append(Paragraph("Características técnicas del bot:", style_h2))
    bot_features = [
        "Conexión directa a WhatsApp (sin API de pago, sin costos mensuales)",
        "Reconexión automática ante caídas de conexión",
        "Conversaciones con estado: recuerda en qué paso está cada usuario",
        "Timeout de 30 minutos de inactividad para liberar conversaciones",
        "Detección inteligente de intención por palabras clave",
        "Soporte para mensajes de texto, imágenes y documentos",
        "Envío masivo de mensajes para campañas a nuevas zonas",
        "Formateo automático de números telefónicos argentinos (+54)",
    ]
    for f in bot_features:
        story.append(Paragraph(f"•  {f}", style_bullet))

    story.append(PageBreak())

    # ═══════════════════════════════════════════════════
    # PÁGINA 4: Sistema de choferes e incidentes
    # ═══════════════════════════════════════════════════
    story.append(Paragraph("Gestión de Choferes e Incidentes", style_h1))
    story.append(HRFlowable(width="100%", thickness=2, color=ACCENT, spaceBefore=2, spaceAfter=10))

    story.append(Paragraph(
        "Los choferes interactúan con el sistema a través del mismo bot de WhatsApp. "
        "Se identifican con su número de chofer y pueden registrar toda la información "
        "operativa del día de forma sencilla.",
        style_body,
    ))
    story.append(Spacer(1, 4 * mm))

    story.append(Paragraph("Funciones del chofer:", style_h2))
    driver_features = [
        [Paragraph("Función", cell_header), Paragraph("Descripción", cell_header)],
        [Paragraph("Registro de recolección", cell_bold), Paragraph("Ingresa litros totales recolectados y cantidad de bidones utilizados", cell_style)],
        [Paragraph("Registro de combustible", cell_bold), Paragraph("Ingresa litros de combustible cargados y monto en pesos", cell_style)],
        [Paragraph("Reporte de incidentes", cell_bold), Paragraph("Reporta accidentes, retrasos, averías, robos, problemas climáticos u otros", cell_style)],
        [Paragraph("Cierre de jornada", cell_bold), Paragraph("Confirma fin del día de trabajo", cell_style)],
    ]
    dt = Table(driver_features, colWidths=[pw * 0.3, pw * 0.65])
    dt.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, LIGHT]),
        ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#DEE2E6")),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(dt)
    story.append(Spacer(1, 8 * mm))

    # Incidentes
    story.append(Paragraph("Sistema de Incidentes", style_h2))
    story.append(Paragraph(
        "Cuando un chofer reporta un incidente, el sistema lo clasifica por tipo y gravedad. "
        "Los incidentes de gravedad alta o crítica generan una notificación inmediata al "
        "CEO por WhatsApp, sin esperar al reporte del final del día.",
        style_body,
    ))
    story.append(Spacer(1, 3 * mm))

    cell_header_danger = ParagraphStyle("CellHD", fontName="Helvetica-Bold", fontSize=8, textColor=WHITE, leading=10)
    inc_data = [
        [Paragraph("Tipo de Incidente", cell_header_danger), Paragraph("Niveles de Gravedad", cell_header_danger)],
        [Paragraph("Accidente de tránsito", cell_style), Paragraph("<b>Baja</b> - Evento menor sin consecuencias", cell_style)],
        [Paragraph("Retraso significativo", cell_style), Paragraph("<b>Media</b> - Requiere atención pero no es urgente", cell_style)],
        [Paragraph("Avería del camión", cell_style), Paragraph("<b>Alta</b> - Requiere acción inmediata", cell_style)],
        [Paragraph("Robo / intento de robo", cell_style), Paragraph("<b>Crítica</b> - Emergencia, notificación instantánea", cell_style)],
        [Paragraph("Problema climático", cell_style), Paragraph("", cell_style)],
        [Paragraph("Otro", cell_style), Paragraph("", cell_style)],
    ]
    inc_table = Table(inc_data, colWidths=[pw * 0.4, pw * 0.55])
    inc_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), DANGER),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, HexColor("#FFF5F5")]),
        ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#DEE2E6")),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(inc_table)
    story.append(Spacer(1, 6 * mm))

    story.append(Paragraph("Flujo de un incidente:", style_body_bold))
    inc_steps = [
        "1.  El chofer selecciona \"Reportar incidente\" en el menú del bot",
        "2.  Elige el tipo de incidente de una lista predefinida",
        "3.  Describe lo sucedido en texto libre",
        "4.  Selecciona el nivel de gravedad (baja / media / alta / crítica)",
        "5.  El sistema registra el incidente en la base de datos",
        "6.  Se envía una alerta inmediata al CEO por WhatsApp con todos los detalles",
        "7.  El incidente se incluye en el reporte PDF diario de las 19:00 hs",
    ]
    for step in inc_steps:
        story.append(Paragraph(step, style_bullet))

    story.append(PageBreak())

    # ═══════════════════════════════════════════════════
    # PÁGINA 5: Reportes
    # ═══════════════════════════════════════════════════
    story.append(Paragraph("Sistema de Reportes", style_h1))
    story.append(HRFlowable(width="100%", thickness=2, color=ACCENT, spaceBefore=2, spaceAfter=10))

    story.append(Paragraph(
        "Todos los días a las 19:00 hs (al finalizar la jornada laboral), el sistema genera "
        "automáticamente un reporte PDF profesional de una sola página y lo envía al "
        "WhatsApp del CEO. El reporte incluye toda la información operativa del día.",
        style_body,
    ))
    story.append(Spacer(1, 4 * mm))

    story.append(Paragraph("Contenido del reporte diario:", style_h2))
    report_content = [
        [Paragraph("Sección", cell_header), Paragraph("Información incluida", cell_header)],
        [Paragraph("KPIs principales", cell_bold), Paragraph("Litros del día, bidones, promedio por bidón, progreso mensual", cell_style)],
        [Paragraph("Gráfico de progreso", cell_bold), Paragraph("Doughnut chart con porcentaje del objetivo mensual alcanzado", cell_style)],
        [Paragraph("Gráfico de donantes", cell_bold), Paragraph("Distribución de donantes: activas, nuevas y en pausa", cell_style)],
        [Paragraph("Litros por día", cell_bold), Paragraph("Gráfico de barras con la recolección diaria del mes vs. objetivo", cell_style)],
        [Paragraph("Incidentes del día", cell_bold), Paragraph("Tabla con hora, chofer, tipo, gravedad y descripción de cada incidente", cell_style)],
        [Paragraph("Reclamos", cell_bold), Paragraph("Pendientes, en seguimiento, escalados y resueltos del mes", cell_style)],
        [Paragraph("Avisos activos", cell_bold), Paragraph("Vacaciones, enfermedad, medicación y donantes que vuelven mañana", cell_style)],
        [Paragraph("Flota", cell_bold), Paragraph("Camiones operativos, en ruta, choferes activos, en mantenimiento", cell_style)],
        [Paragraph("Bot WhatsApp", cell_bold), Paragraph("Mensajes totales del día, entrantes, salientes y tasa de respuesta", cell_style)],
        [Paragraph("Barra de progreso", cell_bold), Paragraph("Progreso visual hacia el objetivo de 260.000 litros mensuales", cell_style)],
    ]
    rt = Table(report_content, colWidths=[pw * 0.28, pw * 0.67])
    rt.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, LIGHT]),
        ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#DEE2E6")),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(rt)
    story.append(Spacer(1, 6 * mm))

    story.append(Paragraph("Modos de obtener el reporte:", style_h2))
    modes = [
        ("<b>Automático:</b> Se envía todos los días a las 19:00 hs al WhatsApp del CEO",
        ),
        ("<b>On-demand:</b> El CEO envía la palabra \"reporte\" al bot y recibe el PDF inmediatamente. "
         "Ese día no se envía el reporte automático para evitar duplicados",
        ),
    ]
    for m in modes:
        story.append(Paragraph(f"•  {m[0]}", style_bullet))

    story.append(PageBreak())

    # ═══════════════════════════════════════════════════
    # PÁGINA 6: Base de datos
    # ═══════════════════════════════════════════════════
    story.append(Paragraph("Base de Datos", style_h1))
    story.append(HRFlowable(width="100%", thickness=2, color=ACCENT, spaceBefore=2, spaceAfter=10))

    story.append(Paragraph(
        "El sistema utiliza PostgreSQL 16, una base de datos empresarial de código abierto "
        "reconocida por su robustez y escalabilidad. La estructura fue diseñada para soportar "
        "tanto la Fase 1 como la futura expansión a la Fase 2.",
        style_body,
    ))
    story.append(Spacer(1, 4 * mm))

    story.append(Paragraph("Tablas principales:", style_h2))
    cell_center = ParagraphStyle("CellCenter", fontName="Helvetica", fontSize=8, textColor=DARK, leading=10, alignment=TA_CENTER)
    cell_header_c = ParagraphStyle("CellHC", fontName="Helvetica-Bold", fontSize=8, textColor=WHITE, leading=10, alignment=TA_CENTER)
    db_tables = [
        [Paragraph("Tabla", cell_header), Paragraph("Descripción", cell_header), Paragraph("Registros", cell_header_c)],
        [Paragraph("zonas", cell_bold), Paragraph("Zonas geográficas de recolección", cell_style), Paragraph("~20-50", cell_center)],
        [Paragraph("donantes", cell_bold), Paragraph("Datos de cada donante (nombre, dirección, estado, días)", cell_style), Paragraph("~300-500+", cell_center)],
        [Paragraph("choferes", cell_bold), Paragraph("Choferes registrados con número identificador", cell_style), Paragraph("~5-10", cell_center)],
        [Paragraph("camiones", cell_bold), Paragraph("Flota de vehículos con estado operativo", cell_style), Paragraph("~5-8", cell_center)],
        [Paragraph("reclamos", cell_bold), Paragraph("Reclamos recibidos con tipo, estado y seguimiento", cell_style), Paragraph("Variable", cell_center)],
        [Paragraph("avisos", cell_bold), Paragraph("Avisos de vacaciones, enfermedad, medicación", cell_style), Paragraph("Variable", cell_center)],
        [Paragraph("registros_recoleccion", cell_bold), Paragraph("Litros y bidones recolectados por día", cell_style), Paragraph("Diario", cell_center)],
        [Paragraph("registros_combustible", cell_bold), Paragraph("Combustible cargado por cada chofer", cell_style), Paragraph("Diario", cell_center)],
        [Paragraph("incidentes", cell_bold), Paragraph("Incidentes reportados con tipo, gravedad y resolución", cell_style), Paragraph("Variable", cell_center)],
        [Paragraph("mensajes_log", cell_bold), Paragraph("Historial de mensajes del bot (entrantes y salientes)", cell_style), Paragraph("Alto vol.", cell_center)],
        [Paragraph("progreso_mensual", cell_bold), Paragraph("Objetivos y progreso de recolección mensual", cell_style), Paragraph("Mensual", cell_center)],
        [Paragraph("recorridos", cell_bold), Paragraph("Recorridos asignados a cada chofer por día", cell_style), Paragraph("Diario", cell_center)],
    ]
    dbt = Table(db_tables, colWidths=[pw * 0.25, pw * 0.48, pw * 0.22])
    dbt.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, LIGHT]),
        ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#DEE2E6")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(dbt)
    story.append(Spacer(1, 6 * mm))

    story.append(Paragraph(
        "Total: 18 tablas con relaciones entre sí, incluyendo tablas de asignación "
        "zona-chofer, recorrido-donantes y recorrido-peones. La base de datos incluye "
        "migraciones automáticas que permiten actualizar la estructura sin perder datos.",
        style_body,
    ))

    story.append(PageBreak())

    # ═══════════════════════════════════════════════════
    # PÁGINA 7: Tecnología y próximos pasos
    # ═══════════════════════════════════════════════════
    story.append(Paragraph("Stack Tecnológico", style_h1))
    story.append(HRFlowable(width="100%", thickness=2, color=ACCENT, spaceBefore=2, spaceAfter=10))

    tech_data = [
        [Paragraph("Tecnología", cell_header), Paragraph("Uso en el proyecto", cell_header), Paragraph("Ventaja", cell_header)],
        [Paragraph("TypeScript", cell_bold), Paragraph("Lenguaje principal del sistema", cell_style), Paragraph("Tipado estricto, menos errores en producción", cell_style)],
        [Paragraph("Node.js", cell_bold), Paragraph("Motor de ejecución del servidor", cell_style), Paragraph("Alta performance, ideal para bots y APIs", cell_style)],
        [Paragraph("PostgreSQL 16", cell_bold), Paragraph("Base de datos relacional", cell_style), Paragraph("Empresarial, escalable, gratuito", cell_style)],
        [Paragraph("Baileys", cell_bold), Paragraph("Conexión a WhatsApp", cell_style), Paragraph("Sin costos de API, conexión directa", cell_style)],
        [Paragraph("Drizzle ORM", cell_bold), Paragraph("Manejo de base de datos", cell_style), Paragraph("Tipado completo, queries seguras", cell_style)],
        [Paragraph("PDFKit", cell_bold), Paragraph("Generación de reportes PDF", cell_style), Paragraph("Control total del diseño", cell_style)],
        [Paragraph("Chart.js", cell_bold), Paragraph("Gráficos en los reportes", cell_style), Paragraph("Profesional, variedad de gráficos", cell_style)],
        [Paragraph("node-cron", cell_bold), Paragraph("Tareas programadas", cell_style), Paragraph("Reportes automáticos, seguimientos", cell_style)],
        [Paragraph("Pino", cell_bold), Paragraph("Sistema de logs", cell_style), Paragraph("Trazabilidad de operaciones", cell_style)],
        [Paragraph("Zod", cell_bold), Paragraph("Validación de configuración", cell_style), Paragraph("Previene errores de configuración", cell_style)],
    ]
    tt = Table(tech_data, colWidths=[pw * 0.2, pw * 0.35, pw * 0.4])
    tt.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, LIGHT]),
        ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#DEE2E6")),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(tt)
    story.append(Spacer(1, 10 * mm))

    story.append(Paragraph("Estado Actual y Próximos Pasos", style_h1))
    story.append(HRFlowable(width="100%", thickness=2, color=ACCENT, spaceBefore=2, spaceAfter=10))

    story.append(Paragraph("Completado en Fase 1:", style_h2))
    done = [
        "Bot de WhatsApp con 7 flujos de conversación operativos",
        "Base de datos PostgreSQL con 18 tablas y migraciones automáticas",
        "Sistema de reportes PDF diarios (automático a las 19:00 + on-demand)",
        "Interfaz de choferes para registro de recolección, combustible e incidentes",
        "Sistema de alertas inmediatas al CEO por incidentes",
        "Gestión automática de reclamos con seguimiento y escalamiento",
        "Gestión de avisos (vacaciones, enfermedad, medicación) con recordatorios",
        "Alta de nuevas donantes con notificación automática al chofer de zona",
        "Recolección de dirección exacta de donantes para reorganizar recorridos de choferes",
        "Importador CSV para carga masiva de donantes",
    ]
    for d in done:
        story.append(Paragraph(f"<font color='#27AE60'>&#10003;</font>  {d}", style_bullet))

    story.append(Spacer(1, 6 * mm))
    story.append(Paragraph("Pendiente para completar Fase 1:", style_h2))
    pending = [
        "Carga de la base de datos real de donantes (requiere datos del cliente)",
        "Configuración del número de WhatsApp definitivo",
        "Pruebas en entorno de producción",
        "Despliegue en servidor",
    ]
    for p in pending:
        story.append(Paragraph(f"<font color='#F39C12'>&#9679;</font>  {p}", style_bullet))

    story.append(Spacer(1, 6 * mm))
    story.append(Paragraph("Fase 2 (futuro):", style_h2))
    future = [
        "Aplicación móvil para choferes y visitadoras",
        "Panel web de administración con dashboard en tiempo real",
        "Optimización de rutas con algoritmos inteligentes",
        "Tracking GPS en vivo de la flota",
        "Gestión completa de personal (choferes, peones, visitadoras)",
    ]
    for f in future:
        story.append(Paragraph(f"<font color='#2E86AB'>&#9679;</font>  {f}", style_bullet))

    # ═══════════════════════════════════════════════════
    # BUILD
    # ═══════════════════════════════════════════════════
    doc.build(
        story,
        onFirstPage=cover_page,
        onLaterPages=header_footer,
    )
    print(f"PDF generado: {OUTPUT_FILE}")
    size_kb = os.path.getsize(OUTPUT_FILE) / 1024
    print(f"Tamaño: {size_kb:.1f} KB")
    print(f"Ubicación: {OUTPUT_DIR}")


if __name__ == "__main__":
    build_pdf()
