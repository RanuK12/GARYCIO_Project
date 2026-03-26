"""Generate GARYCIO Roadmap PDF from structured data."""

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib.colors import HexColor
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, PageBreak
)

doc = SimpleDocTemplate(
    "docs/GARYCIO_Fase2_Roadmap.pdf",
    pagesize=A4,
    topMargin=2*cm, bottomMargin=2*cm,
    leftMargin=2*cm, rightMargin=2*cm,
)

styles = getSampleStyleSheet()

styles.add(ParagraphStyle(
    "DocTitle", parent=styles["Title"],
    fontSize=22, spaceAfter=6, textColor=HexColor("#1a1a2e"),
    fontName="Helvetica-Bold",
))
styles.add(ParagraphStyle(
    "Phase", parent=styles["Heading1"],
    fontSize=16, spaceAfter=8, spaceBefore=16,
    textColor=HexColor("#16213e"), fontName="Helvetica-Bold",
))
styles.add(ParagraphStyle(
    "Section", parent=styles["Heading2"],
    fontSize=13, spaceAfter=6, spaceBefore=10,
    textColor=HexColor("#0f3460"), fontName="Helvetica-Bold",
))
styles.add(ParagraphStyle(
    "SubSection", parent=styles["Heading3"],
    fontSize=11, spaceAfter=4, spaceBefore=8,
    textColor=HexColor("#533483"), fontName="Helvetica-Bold",
))
styles.add(ParagraphStyle(
    "BulletItem", parent=styles["Normal"],
    fontSize=9.5, leftIndent=15, bulletIndent=5,
    spaceBefore=2, spaceAfter=2,
))
styles.add(ParagraphStyle(
    "Note", parent=styles["Normal"],
    fontSize=9, textColor=HexColor("#666666"),
    fontName="Helvetica-Oblique", spaceBefore=4, spaceAfter=8,
))

DARK = HexColor("#1a1a2e")
BLUE = HexColor("#16213e")
GRAY = HexColor("#cccccc")
LIGHT = HexColor("#f8f8f8")
WHITE = HexColor("#ffffff")

TABLE_STYLE = TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), BLUE),
    ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
    ("FONTSIZE", (0, 0), (-1, -1), 9),
    ("GRID", (0, 0), (-1, -1), 0.5, GRAY),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [LIGHT, WHITE]),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("TOPPADDING", (0, 0), (-1, -1), 4),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
])

story = []

# ─── TITLE ───
story.append(Paragraph("GARYCIO - Roadmap Completo", styles["DocTitle"]))
story.append(Paragraph("Marzo 2026", styles["Note"]))
story.append(HRFlowable(width="100%", thickness=2, color=DARK))
story.append(Spacer(1, 8))

# ─── FASE 1 ───
story.append(Paragraph("Fase 1: Bot WhatsApp + Gestion Operativa (EN CURSO)", styles["Phase"]))

story.append(Paragraph("Completado", styles["Section"]))
completado = [
    "Bot WhatsApp con flujos: contacto inicial, reclamos, avisos, consultas, nueva donante",
    "Flujo choferes: reporte de incidentes, envio de fotos/comprobantes (OCR)",
    "Flujo peones: reclamos, entrega de regalos, fotos, reportar bajas",
    "Panel admin por WhatsApp: contactos nuevos, buscar donantes, reclamos, bajas, progreso rutas",
    "Sistema OCR para tickets de combustible, lavado, bidones",
    "Reportes CEO con alertas automaticas por gravedad",
    "Alertas multi-admin (Stefano, Luciano, Vicente)",
    "Persistencia de reclamos e incidentes en base de datos",
    "Optimizacion de rutas (nearest-neighbor desde galpon)",
    "Geocodificacion de donantes (Nominatim)",
    "Integracion Ituran GPS (REST API + SOAP)",
    "Alertas de exceso de velocidad (mayor a 80 km/h)",
    "Notificaciones de progreso de ruta (salida galpon, zona, retorno)",
    "Donantes de baja: chofer/peon reporta, notifica admin, admin decide",
    "Entrega de regalos: peon marca entrega por donante",
    "Encuesta mensual automatica (1000 donantes aleatorias)",
    "Auto-registro de contactos: numero nuevo se guarda para revision",
    "Consulta de donantes por WhatsApp (admin busca por nombre/telefono/direccion)",
    "Endpoint de contactos nuevos (pendientes de revision)",
    "Reporte altas/bajas semanal",
    "Dead Letter Queue para mensajes fallidos",
    "Importador de donantes desde Excel (F91)",
]
for item in completado:
    story.append(Paragraph(item, styles["BulletItem"], bulletText="\u2714"))

story.append(Spacer(1, 8))
story.append(Paragraph("Pendiente para produccion", styles["Section"]))

pend_data = [
    ["Item", "Responsable", "Estado"],
    ["Hosting / servidor", "Stefano", "Pendiente"],
    ["Token WhatsApp Business API", "Stefano", "En proceso"],
    ["Asignacion chofer a zona", "Stefano", "Pendiente"],
    ["73 donantes sin telefono", "Stefano", "Pendiente"],
    ["Dias de recoleccion por zona", "Stefano", "Pendiente"],
    ["Ituran SOAP CanUseWebserviceApi", "Stefano / Ituran", "Pendiente"],
]
t = Table(pend_data, colWidths=[200, 120, 100])
t.setStyle(TABLE_STYLE)
story.append(t)

# ─── FASE 2 ───
story.append(Spacer(1, 12))
story.append(HRFlowable(width="100%", thickness=1, color=GRAY))
story.append(Paragraph("Fase 2: Plataforma Completa (FUTURO)", styles["Phase"]))
story.append(Paragraph("El alcance y presupuesto se definen al inicio de esta fase.", styles["Note"]))

fase2 = {
    "2.1 Dashboard Web Admin": [
        "Panel web con metricas en tiempo real",
        "Mapa interactivo con posicion de camiones GPS",
        "Graficos de litros recolectados, km recorridos, eficiencia",
        "Alertas en pantalla (velocidad, desvios, incidentes)",
        "Gestion de usuarios y permisos",
    ],
    "2.2 CRM de Donantes": [
        "Ficha completa de cada donante (datos, historial, reclamos, avisos)",
        "Semaforo verde/amarillo/rojo por consistencia y productividad",
        "Deteccion automatica de donantes en riesgo",
        "Historial cruzado de reclamos (donante vs chofer/peon)",
        "Diferenciacion entre reclamo genuino vs insistencia repetida",
    ],
    "2.3 Optimizacion de Recorridos Avanzada": [
        "Algoritmo inteligente (OR-Tools / OptimoRoute)",
        "Ventanas horarias, capacidad del camion, prioridad",
        "Re-optimizacion en tiempo real cuando hay desvio",
        "Comparacion automatica ruta planificada vs recorrida",
    ],
    "2.4 Geolocalizacion y Tracking GPS": [
        "Tracking GPS en tiempo real (Ituran integrado)",
        "Historial de recorridos con replay en mapa",
        "Geofencing: notificacion al entrar/salir de zonas",
        "Notificaciones avanzadas con % de completitud por ruta",
    ],
    "2.5 Flujo Visitadoras": [
        "Gestion completa con asignacion y seguimiento",
        "Asignacion automatica a reclamos escalados",
        "Seguimiento de visitas con resultado y devolucion",
        "Metricas de resolucion por visitadora",
    ],
    "2.6 Tracking Peones Avanzado": [
        "Marcacion de bidones para trazabilidad",
        "Reporte de baja con foto de puerta (direccion visible)",
        "Comunicacion automatica WhatsApp a donante en baja",
    ],
    "2.7 Ausencias y Cobertura": [
        "Reasignacion automatica de choferes cuando hay ausencia",
        "Notificacion al chofer de reemplazo con la ruta del dia",
        "Historial de ausencias y cobertura por chofer",
    ],
    "2.8 Lavado de Camiones": [
        "Registro con foto comprobante cada 15 dias",
        "Alerta automatica cuando se acerca la fecha de lavado",
        "Historial de lavados por camion",
    ],
    "2.9 Etiquetas y Organizacion": [
        "Etiqueta de color por chofer con LMV o MJS",
        "Auto-etiquetado de donantes al responder",
        "Filtros avanzados por zona, estado, chofer, dias",
    ],
}

for title, items in fase2.items():
    story.append(Paragraph(title, styles["SubSection"]))
    for item in items:
        story.append(Paragraph(item, styles["BulletItem"], bulletText="\u2022"))

# ─── FASE 3 ───
story.append(PageBreak())
story.append(Paragraph("Fase 3: App Movil (BACKLOG)", styles["Phase"]))
story.append(Paragraph("Ideas recopiladas para futura app nativa. Se presupuestan por separado.", styles["Note"]))

fase3 = {
    "Para choferes": [
        "App con ruta del dia, mapa y lista de paradas",
        "Check-in/check-out en cada donante",
        "Foto de bidones + escaneo de etiquetas",
        "Reporte de incidentes con geolocalizacion automatica",
        "Chat directo con admin",
    ],
    "Para peones": [
        "Lista de donantes de la zona del dia",
        "Marcar entrega de regalo con foto",
        "Reportar baja con foto de puerta",
        "Registro de bidones retirados",
    ],
    "Para admin/CEO": [
        "Dashboard con KPIs en tiempo real",
        "Mapa con posicion de todos los camiones",
        "Notificaciones push de alertas",
        "Aprobacion de bajas y reclamos desde la app",
        "Metricas comparativas por zona/chofer/mes",
    ],
    "Para donantes": [
        "Portal de consulta del estado de su donacion",
        "Historial de recolecciones",
        "Solicitar vacaciones/ausencia",
        "Reportar reclamo directamente",
    ],
}

for title, items in fase3.items():
    story.append(Paragraph(title, styles["SubSection"]))
    for item in items:
        story.append(Paragraph(item, styles["BulletItem"], bulletText="\u2022"))

# ─── DATOS OPERATIVOS ───
story.append(Spacer(1, 12))
story.append(HRFlowable(width="100%", thickness=1, color=GRAY))
story.append(Paragraph("Datos operativos confirmados", styles["Phase"]))

story.append(Paragraph("Choferes", styles["Section"]))
chof_data = [
    ["Chofer", "Patente", "Telefono"],
    ["Jaime Barrios", "AH355HJ", "+5491132425209"],
    ["Matias Bielik", "AG185RG", "+5491158599344"],
    ["Carlos Vera", "AD795GK", "+5491166044005"],
    ["(sin asignar)", "AD609BE", "-"],
]
t2 = Table(chof_data, colWidths=[160, 100, 160])
t2.setStyle(TABLE_STYLE)
story.append(t2)

story.append(Spacer(1, 8))
story.append(Paragraph("Admin / Alertas CEO", styles["Section"]))
admin_data = [
    ["Nombre", "Rol", "Telefono"],
    ["Stefano Gargiulo", "CEO", "Pendiente"],
    ["Luciano Gargiulo Ciocca", "Admin (hermano)", "+5491130128112"],
    ["Vicente Gargiulo", "Admin (padre)", "+5491151042517"],
]
t3 = Table(admin_data, colWidths=[180, 120, 150])
t3.setStyle(TABLE_STYLE)
story.append(t3)

story.append(Spacer(1, 8))
story.append(Paragraph("Infraestructura", styles["Section"]))
infra = [
    "Galpon: Murature 3820, Villa Lynch, Provincia de Buenos Aires",
    "WhatsApp Business: +54 9 11 7156-0000",
    "Donantes: 8,404 con GPS",
    "Ituran REST API: Activa (GARYCIO_API) - probada y funcionando",
    "Ituran SOAP API: Pendiente permiso CanUseWebserviceApi",
]
for item in infra:
    story.append(Paragraph(item, styles["BulletItem"], bulletText="\u2022"))

story.append(Spacer(1, 10))
story.append(Paragraph("Pendientes criticos", styles["Section"]))
pend_crit = [
    "73 donantes sin numero de celular",
    "Asignacion chofer a zona",
    "Hosting / servidor de produccion",
    "Token permanente WhatsApp Business API",
    "Dias de recoleccion por zona (LMV / MJS)",
]
for item in pend_crit:
    story.append(Paragraph(item, styles["BulletItem"], bulletText="\u26A0"))

doc.build(story)
print("PDF generado: docs/GARYCIO_Fase2_Roadmap.pdf")
