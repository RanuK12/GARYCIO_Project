import { FlowHandler, ConversationState, FlowResponse } from "./types";
import { db } from "../../database";
import { donantes, reclamos, reportesBaja, encuestasRegalo } from "../../database/schema";
import { eq, and, desc, sql, ilike } from "drizzle-orm";
import { logger } from "../../config/logger";
import { obtenerResumenProgreso } from "../../services/progreso-ruta";

/**
 * Flujo para administradores.
 * Solo accesible para números en ADMIN_PHONES o CEO_PHONE.
 *
 * Comandos:
 * 0  - Identificación (verifica que sea admin)
 * 1  - Menú principal
 * 10 - Ver contactos nuevos (pendientes de revisión)
 * 11 - Detalle de un contacto nuevo
 * 20 - Buscar donante
 * 21 - Detalle de donante
 * 30 - Ver reclamos pendientes
 * 40 - Ver reportes de baja pendientes
 * 50 - Ver progreso de rutas del día
 * 60 - Ver resultados de encuesta
 * 99 - Volver al menú o finalizar
 */
export const adminFlow: FlowHandler = {
  name: "admin",
  keyword: ["admin", "administrador", "gestión", "gestion"],

  async handle(state: ConversationState, message: string): Promise<FlowResponse> {
    const respuesta = message.trim();

    switch (state.step) {
      case 0: return handleBienvenida();
      case 1: return handleMenu(respuesta);
      case 10: return await handleContactosNuevos();
      case 11: return await handleDetalleContacto(respuesta, state);
      case 20: return await handleBuscarDonante(respuesta);
      case 21: return await handleDetalleDonante(respuesta);
      case 30: return await handleReclamosPendientes();
      case 40: return await handleBajasPendientes();
      case 50: return handleProgresoRutas();
      case 60: return await handleResultadosEncuesta();
      case 99: return handleVolverOFinalizar(respuesta);
      default:
        return { reply: "Sesión finalizada. Escribí *admin* para volver.", endFlow: true };
    }
  },
};

// ── Bienvenida ──────────────────────────────────
function handleBienvenida(): FlowResponse {
  return {
    reply:
      "🔐 *Panel de Administración GARYCIO*\n\n" +
      "¿Qué querés hacer?\n\n" +
      "*1* - 📋 Ver contactos nuevos (pendientes)\n" +
      "*2* - 🔍 Buscar donante\n" +
      "*3* - ⚠️ Ver reclamos pendientes\n" +
      "*4* - 🔴 Ver reportes de baja\n" +
      "*5* - 🚛 Progreso de rutas del día\n" +
      "*6* - 📊 Resultados de encuesta\n" +
      "*7* - 📖 Ver lista de comandos\n" +
      "*8* - Finalizar\n\n" +
      "Elegí una opción:",
    nextStep: 1,
  };
}

// ── Menú ──────────────────────────────────
function handleMenu(respuesta: string): FlowResponse {
  switch (respuesta) {
    case "1":
      return { reply: "Buscando contactos nuevos...", nextStep: 10 };
    case "2":
      return {
        reply: "🔍 *Buscar donante*\n\nIngresá el nombre, teléfono o dirección a buscar:",
        nextStep: 20,
      };
    case "3":
      return { reply: "Buscando reclamos pendientes...", nextStep: 30 };
    case "4":
      return { reply: "Buscando reportes de baja...", nextStep: 40 };
    case "5":
      return { reply: "Consultando progreso de rutas...", nextStep: 50 };
    case "6":
      return { reply: "Consultando encuestas...", nextStep: 60 };
    case "7":
      return handleListaComandos();
    case "8":
      return { reply: "✅ Sesión de admin finalizada.", endFlow: true };
    default:
      return { reply: "Opción no válida. Elegí del *1* al *8*:", nextStep: 1 };
  }
}

// ── Contactos nuevos ──────────────────────────────────
async function handleContactosNuevos(): Promise<FlowResponse> {
  const nuevos = await db
    .select({
      id: donantes.id,
      nombre: donantes.nombre,
      telefono: donantes.telefono,
      notas: donantes.notas,
      createdAt: donantes.createdAt,
    })
    .from(donantes)
    .where(
      and(
        eq(donantes.estado, "nueva"),
        eq(donantes.donandoActualmente, false),
      ),
    )
    .orderBy(desc(donantes.createdAt))
    .limit(20);

  if (nuevos.length === 0) {
    return {
      reply:
        "✅ No hay contactos nuevos pendientes de revisión.\n\n" +
        "¿Querés hacer algo más?\n*1* - Sí, volver al menú\n*2* - No, finalizar",
      nextStep: 99,
    };
  }

  let lista = `📋 *Contactos nuevos pendientes* (${nuevos.length})\n\n`;
  for (const [i, c] of nuevos.entries()) {
    const fecha = c.createdAt ? new Date(c.createdAt).toLocaleDateString("es-AR") : "?";
    lista += `*${i + 1}.* 📱 ${c.telefono}\n`;
    lista += `   📅 ${fecha}\n`;
    if (c.notas) {
      const nota = c.notas.length > 60 ? c.notas.slice(0, 60) + "..." : c.notas;
      lista += `   📝 ${nota}\n`;
    }
    lista += "\n";
  }

  lista += "Enviá el *número* del contacto para ver detalle, o:\n";
  lista += "*0* - Volver al menú";

  return {
    reply: lista,
    nextStep: 11,
    data: { contactosNuevos: nuevos.map((c) => c.id) },
  };
}

async function handleDetalleContacto(respuesta: string, state: ConversationState): Promise<FlowResponse> {
  if (respuesta === "0") {
    return handleBienvenida();
  }

  const idx = parseInt(respuesta) - 1;
  const ids: number[] = state.data.contactosNuevos || [];

  if (isNaN(idx) || idx < 0 || idx >= ids.length) {
    return { reply: "Número no válido. Elegí uno de la lista o *0* para volver:", nextStep: 11 };
  }

  const [contacto] = await db
    .select()
    .from(donantes)
    .where(eq(donantes.id, ids[idx]))
    .limit(1);

  if (!contacto) {
    return { reply: "Contacto no encontrado. Elegí otro:", nextStep: 11 };
  }

  return {
    reply:
      `📱 *Detalle del contacto*\n\n` +
      `Nombre: ${contacto.nombre}\n` +
      `Teléfono: ${contacto.telefono}\n` +
      `Dirección: ${contacto.direccion}\n` +
      `Estado: ${contacto.estado}\n` +
      `Fecha: ${contacto.createdAt ? new Date(contacto.createdAt).toLocaleDateString("es-AR") : "?"}\n` +
      (contacto.notas ? `Notas: ${contacto.notas}\n` : "") +
      `\nPara agregar al listado general, completá sus datos desde el panel web o pedime que lo actualice.\n\n` +
      "¿Querés hacer algo más?\n*1* - Sí, volver al menú\n*2* - No, finalizar",
    nextStep: 99,
  };
}

// ── Buscar donante ──────────────────────────────────
async function handleBuscarDonante(query: string): Promise<FlowResponse> {
  if (query.length < 2) {
    return { reply: "Búsqueda muy corta. Ingresá al menos 2 caracteres:", nextStep: 20 };
  }

  const resultados = await db
    .select({
      id: donantes.id,
      nombre: donantes.nombre,
      telefono: donantes.telefono,
      direccion: donantes.direccion,
      estado: donantes.estado,
      donandoActualmente: donantes.donandoActualmente,
    })
    .from(donantes)
    .where(
      sql`(${donantes.nombre} ILIKE ${"%" + query + "%"} OR ${donantes.telefono} ILIKE ${"%" + query + "%"} OR ${donantes.direccion} ILIKE ${"%" + query + "%"})`,
    )
    .limit(10);

  if (resultados.length === 0) {
    return {
      reply:
        `🔍 No se encontraron donantes para "${query}".\n\n` +
        "¿Querés buscar otra cosa?\n*1* - Sí, nueva búsqueda\n*2* - No, volver al menú",
      nextStep: 99,
    };
  }

  let lista = `🔍 *Resultados para "${query}"* (${resultados.length})\n\n`;
  for (const [i, d] of resultados.entries()) {
    const estado = d.donandoActualmente ? "🟢" : "🔴";
    lista += `*${i + 1}.* ${estado} ${d.nombre}\n`;
    lista += `   📱 ${d.telefono}\n`;
    lista += `   📍 ${d.direccion.slice(0, 50)}\n\n`;
  }

  lista += "Enviá el *número* para ver detalle, o *0* para volver al menú:";

  return {
    reply: lista,
    nextStep: 21,
    data: { busquedaIds: resultados.map((d) => d.id) },
  };
}

async function handleDetalleDonante(respuesta: string): Promise<FlowResponse> {
  if (respuesta === "0") {
    return handleBienvenida();
  }

  const id = parseInt(respuesta);
  if (isNaN(id)) {
    return { reply: "Número no válido. Elegí de la lista o *0* para volver:", nextStep: 21 };
  }

  const [donante] = await db.select().from(donantes).where(eq(donantes.id, id)).limit(1);
  if (!donante) {
    return { reply: "Donante no encontrada. Intentá de nuevo:", nextStep: 21 };
  }

  const histReclamos = await db.select().from(reclamos).where(eq(reclamos.donanteId, id));
  const histBajas = await db.select().from(reportesBaja).where(eq(reportesBaja.donanteId, id));

  let detalle =
    `📋 *Ficha de donante #${donante.id}*\n\n` +
    `👤 ${donante.nombre}\n` +
    `📱 ${donante.telefono}\n` +
    `📍 ${donante.direccion}\n` +
    `📊 Estado: ${donante.estado}\n` +
    `🗓️ Alta: ${donante.fechaAlta || "?"}\n` +
    `💧 Donando: ${donante.donandoActualmente ? "Sí" : "No"}\n`;

  if (donante.diasRecoleccion) detalle += `📅 Días: ${donante.diasRecoleccion}\n`;
  if (donante.subZona) detalle += `🗺️ Sub-zona: ${donante.subZona}\n`;
  if (donante.notas) detalle += `📝 Notas: ${donante.notas}\n`;

  detalle += `\n📊 Historial: ${histReclamos.length} reclamo(s), ${histBajas.length} reporte(s) de baja\n`;

  detalle += "\n¿Querés hacer algo más?\n*1* - Sí, volver al menú\n*2* - No, finalizar";

  return { reply: detalle, nextStep: 99 };
}

// ── Reclamos pendientes ──────────────────────────────────
async function handleReclamosPendientes(): Promise<FlowResponse> {
  const pendientes = await db
    .select({
      id: reclamos.id,
      tipo: reclamos.tipo,
      descripcion: reclamos.descripcion,
      estado: reclamos.estado,
      fechaCreacion: reclamos.fechaCreacion,
      donanteId: reclamos.donanteId,
    })
    .from(reclamos)
    .where(
      sql`${reclamos.estado} IN ('pendiente', 'notificado_chofer', 'seguimiento_enviado')`,
    )
    .orderBy(desc(reclamos.fechaCreacion))
    .limit(15);

  if (pendientes.length === 0) {
    return {
      reply: "✅ No hay reclamos pendientes.\n\n*1* - Volver al menú\n*2* - Finalizar",
      nextStep: 99,
    };
  }

  let lista = `⚠️ *Reclamos pendientes* (${pendientes.length})\n\n`;
  for (const r of pendientes) {
    const fecha = r.fechaCreacion ? new Date(r.fechaCreacion).toLocaleDateString("es-AR") : "?";
    lista += `• #${r.id} | ${r.tipo} | ${r.estado}\n`;
    lista += `  📅 ${fecha}`;
    if (r.descripcion) lista += ` | ${r.descripcion.slice(0, 40)}`;
    lista += "\n\n";
  }

  lista += "*1* - Volver al menú\n*2* - Finalizar";
  return { reply: lista, nextStep: 99 };
}

// ── Bajas pendientes ──────────────────────────────────
async function handleBajasPendientes(): Promise<FlowResponse> {
  const pendientes = await db
    .select()
    .from(reportesBaja)
    .where(eq(reportesBaja.confirmado, false))
    .orderBy(desc(reportesBaja.fecha))
    .limit(15);

  if (pendientes.length === 0) {
    return {
      reply: "✅ No hay reportes de baja pendientes de confirmación.\n\n*1* - Volver al menú\n*2* - Finalizar",
      nextStep: 99,
    };
  }

  let lista = `🔴 *Reportes de baja pendientes* (${pendientes.length})\n\n`;
  for (const b of pendientes) {
    const fecha = b.fecha ? new Date(b.fecha).toLocaleDateString("es-AR") : "?";
    lista += `• ${b.donanteNombre || "Donante #" + b.donanteId}\n`;
    lista += `  📍 ${(b.donanteDireccion || "").slice(0, 40)}\n`;
    lista += `  📝 Motivo: ${b.motivo || "?"}\n`;
    lista += `  👷 Reportado por: ${b.reportadoPorNombre || b.reportadoPor}\n`;
    lista += `  📅 ${fecha}\n`;
    lista += `  Contactada: ${b.contactadaDonante ? "Sí" : "No"}\n\n`;
  }

  lista += "*1* - Volver al menú\n*2* - Finalizar";
  return { reply: lista, nextStep: 99 };
}

// ── Progreso de rutas ──────────────────────────────────
function handleProgresoRutas(): FlowResponse {
  const resumen = obtenerResumenProgreso();

  if (resumen.length === 0) {
    return {
      reply: "🚛 No hay vehículos con progreso registrado hoy.\n\n*1* - Volver al menú\n*2* - Finalizar",
      nextStep: 99,
    };
  }

  let lista = `🚛 *Progreso de rutas del día*\n\n`;
  for (const v of resumen) {
    lista += `*${v.patente}*`;
    if (v.choferNombre) lista += ` (${v.choferNombre})`;
    lista += "\n";
    if (v.hitosCompletados.length > 0) {
      lista += `  ✅ ${v.hitosCompletados.join(", ")}\n`;
    } else {
      lista += `  ⏳ Sin hitos registrados aún\n`;
    }
    lista += "\n";
  }

  lista += "*1* - Volver al menú\n*2* - Finalizar";
  return { reply: lista, nextStep: 99 };
}

// ── Resultados encuesta ──────────────────────────────────
async function handleResultadosEncuesta(): Promise<FlowResponse> {
  const stats = await db
    .select({
      total: sql<number>`COUNT(*)`,
      respondidas: sql<number>`COUNT(*) FILTER (WHERE ${encuestasRegalo.respondida} = true)`,
      si: sql<number>`COUNT(*) FILTER (WHERE ${encuestasRegalo.respuesta} = 'SI')`,
      no: sql<number>`COUNT(*) FILTER (WHERE ${encuestasRegalo.respuesta} = 'NO')`,
    })
    .from(encuestasRegalo);

  const s = stats[0] || { total: 0, respondidas: 0, si: 0, no: 0 };
  const tasaRespuesta = s.total > 0 ? Math.round((s.respondidas / s.total) * 100) : 0;

  return {
    reply:
      `📊 *Resultados de encuesta mensual*\n\n` +
      `📨 Enviadas: ${s.total}\n` +
      `💬 Respondidas: ${s.respondidas} (${tasaRespuesta}%)\n` +
      `✅ Sí recibieron regalo: ${s.si}\n` +
      `❌ No recibieron regalo: ${s.no}\n` +
      `⏳ Sin respuesta: ${s.total - s.respondidas}\n\n` +
      "*1* - Volver al menú\n*2* - Finalizar",
    nextStep: 99,
  };
}

// ── Lista de comandos ──────────────────────────────────
function handleListaComandos(): FlowResponse {
  return {
    reply:
      "📖 *Comandos de Administración GARYCIO*\n\n" +
      "Escribí *admin* para abrir el panel.\n\n" +
      "━━━━━━━━━━━━━━━━━━━━━\n" +
      "*Desde el panel admin:*\n" +
      "━━━━━━━━━━━━━━━━━━━━━\n\n" +
      "*1* - 📋 *Contactos nuevos*\n" +
      "  Ver números que escribieron al bot y no están en el listado. Podés revisar cada uno y decidir si agregarlo.\n\n" +
      "*2* - 🔍 *Buscar donante*\n" +
      "  Buscá por nombre, teléfono o dirección. Muestra ficha completa con historial.\n\n" +
      "*3* - ⚠️ *Reclamos pendientes*\n" +
      "  Lista de reclamos sin resolver. Muestra tipo, estado y fecha.\n\n" +
      "*4* - 🔴 *Reportes de baja*\n" +
      "  Bajas reportadas por choferes/peones pendientes de confirmación.\n\n" +
      "*5* - 🚛 *Progreso de rutas*\n" +
      "  Estado actual de cada camión: salida, zona, descarga.\n\n" +
      "*6* - 📊 *Resultados encuesta*\n" +
      "  Estadísticas de la encuesta mensual de regalos.\n\n" +
      "━━━━━━━━━━━━━━━━━━━━━\n" +
      "*Palabras clave (escribir directamente):*\n" +
      "━━━━━━━━━━━━━━━━━━━━━\n\n" +
      "• *admin* → Abre panel de administración\n" +
      "• *chofer* → Registro de chofer (jornada)\n" +
      "• *peón* → Registro de peón\n" +
      "• *reclamo* → Reportar reclamo (donantes)\n" +
      "• *aviso* → Dar aviso (vacaciones/enfermedad)\n" +
      "• *reporte* → Reporte para CEO\n\n" +
      "━━━━━━━━━━━━━━━━━━━━━\n" +
      "*Alertas automáticas (llegan solas):*\n" +
      "━━━━━━━━━━━━━━━━━━━━━\n\n" +
      "🚨 Exceso de velocidad (>80 km/h)\n" +
      "🔴 Incidentes graves reportados por choferes\n" +
      "⚠️ Reclamos nuevos de donantes\n" +
      "📋 Reportes de baja de donantes\n" +
      "🚛 Progreso de rutas (salida, zona, retorno)\n" +
      "📊 Reporte diario automático\n\n" +
      "*1* - Volver al menú\n*2* - Finalizar",
    nextStep: 99,
  };
}

// ── Volver o finalizar ──────────────────────────────────
function handleVolverOFinalizar(respuesta: string): FlowResponse {
  if (respuesta === "1") {
    return handleBienvenida();
  }
  return { reply: "✅ Sesión finalizada. Escribí *admin* para volver.", endFlow: true };
}
