import { FlowHandler, ConversationState, FlowResponse, InteractiveMessage } from "./types";
import { db } from "../../database";
import { donantes, reclamos, reportesBaja, encuestasRegalo, difusionEnvios, iaFeedback } from "../../database/schema";
import { eq, and, desc, sql, ilike, count, like } from "drizzle-orm";
import { logger } from "../../config/logger";
import { obtenerResumenProgreso } from "../../services/progreso-ruta";
import { marcarReporteEnviado } from "../../services/reporte-diario";
import { generarReportePDF } from "../../services/reporte-pdf";
import { sendDocument } from "../../bot/client";
import { generarXLSContactosNuevos, activarDonante, limpiarTmpViejos } from "../../services/exportar-contactos";

/**
 * Flujo para administradores.
 * Solo accesible para números en ADMIN_PHONES o CEO_PHONE.
 *
 * Steps:
 * 0  - Bienvenida (menú interactivo)
 * 1  - Menú principal (handler de opciones)
 * 10 - Contactos nuevos (paginación)
 * 11 - Detalle/acción sobre contacto nuevo
 * 12 - Confirmar activación de donante
 * 20 - Buscar donante
 * 21 - Detalle de donante (búsqueda)
 * 30 - Reclamos pendientes
 * 40 - Reportes de baja pendientes
 * 50 - Progreso de rutas del día
 * 60 - Resultados de encuesta
 * 70 - Generar reporte diario PDF
 * 99 - Volver al menú o finalizar
 */
export const adminFlow: FlowHandler = {
  name: "admin",
  keyword: ["admin", "administrador", "gestión", "gestion"],

  async handle(state: ConversationState, message: string): Promise<FlowResponse> {
    const respuesta = message.trim();

    switch (state.step) {
      case 0: return handleBienvenida();
      case 1: return await handleMenu(respuesta, state);
      case 10: return await handleContactosNuevos(state);
      case 11: return await handleDetalleContacto(respuesta, state);
      case 12: return await handleConfirmarActivacion(respuesta, state);
      case 20: return await handleBuscarDonante(respuesta);
      case 21: return await handleDetalleDonante(respuesta, state);
      case 30: return await handleReclamosPendientes();
      case 40: return await handleBajasPendientes();
      case 50: return handleProgresoRutas();
      case 60: return await handleResultadosEncuesta();
      case 70: return await handleGenerarReporte(state.phone);
      case 80: return await handleRevisarFeedbackIA(respuesta, state);
      case 99: return await handleVolverOFinalizar(respuesta);
      default:
        return handleBienvenida();
    }
  },
};

// ── Bienvenida (menú interactivo WhatsApp) ──────────
function handleBienvenida(): FlowResponse {
  // WhatsApp permite MAXIMO 10 rows en listas interactivas
  return {
    reply: "",
    nextStep: 1,
    interactive: {
      type: "list",
      body: "🔐 *Panel de Administración GARYCIO*\n\n¿Qué querés hacer?",
      buttonText: "Ver opciones",
      sections: [{
        title: "Gestión",
        rows: [
          { id: "1", title: "Contactos nuevos", description: "Revisar, agendar y exportar XLS" },
          { id: "2", title: "Buscar donante", description: "Por nombre, tel o dirección" },
          { id: "3", title: "Reclamos pendientes", description: "Sin resolver" },
          { id: "4", title: "Reportes de baja", description: "Pendientes de confirmación" },
        ],
      }, {
        title: "Operación",
        rows: [
          { id: "10", title: "Estado difusión", description: "Confirmadas vs pendientes" },
          { id: "11", title: "Resumen rápido", description: "Stats del día en un vistazo" },
        ],
      }, {
        title: "Reportes",
        rows: [
          { id: "8", title: "Reporte diario PDF", description: "Generar y enviar" },
          { id: "7", title: "Lista de comandos", description: "Todos los comandos" },
          { id: "13", title: "Revisar IA feedback", description: "Ver fallos e interpretaciones IA" },
        ],
      }, {
        title: "Sesión",
        rows: [
          { id: "9", title: "Finalizar", description: "Cerrar panel admin" },
        ],
      }],
    },
  };
}

// ── Menú: mapeo de títulos interactivos y números ────
async function handleMenu(respuesta: string, state: ConversationState): Promise<FlowResponse> {
  const opcion = respuesta.toLowerCase().trim();
  const menuMap: Record<string, string> = {
    "contactos nuevos": "1",
    "exportar xls": "12",
    "buscar donante": "2",
    "reclamos pendientes": "3",
    "reportes de baja": "4",
    "progreso de rutas": "5",
    "encuesta mensual": "6",
    "lista de comandos": "7",
    "reporte diario pdf": "8",
    "finalizar": "9",
    "estado difusión": "10",
    "estado difusion": "10",
    "resumen rápido": "11",
    "resumen rapido": "11",
    "revisar ia feedback": "13",
    "ia feedback": "13",
    "feedback ia": "13",
  };
  const choice = menuMap[opcion] || opcion;

  switch (choice) {
    case "1":
      return await handleContactosNuevos({ ...state, data: { pagina: 0 } });
    case "2":
      return {
        reply: "🔍 *Buscar donante*\n\nIngresá el nombre, teléfono o dirección a buscar:",
        nextStep: 20,
      };
    case "3":
      return await handleReclamosPendientes();
    case "4":
      return await handleBajasPendientes();
    case "5":
      return handleProgresoRutas();
    case "6":
      return await handleResultadosEncuesta();
    case "7":
      return handleListaComandos();
    case "8":
      return await handleGenerarReporte(state.phone);
    case "9":
      return { reply: "✅ Sesión de admin finalizada.", endFlow: true };
    case "10":
      return await handleEstadoDifusion();
    case "11":
      return await handleResumenRapido();
    case "12":
      return await handleExportarXLS(state.phone);
    case "13":
      return await handleRevisarFeedbackIA("ver", state);
    default:
      return handleBienvenida();
  }
}

const PAGE_SIZE = 50;

// ── Contactos nuevos (con paginación) ─────────────────
async function handleContactosNuevos(state: ConversationState): Promise<FlowResponse> {
  const pagina: number = state.data?.pagina ?? 0;
  const offset = pagina * PAGE_SIZE;

  const [{ total }] = await db
    .select({ total: count() })
    .from(donantes)
    .where(and(eq(donantes.estado, "nueva"), eq(donantes.donandoActualmente, false)));

  if (total === 0) {
    return {
      reply: "",
      nextStep: 99,
      interactive: {
        type: "buttons",
        body: "✅ No hay contactos nuevos pendientes de revisión.",
        buttons: [
          { id: "1", title: "Volver al menú" },
          { id: "2", title: "Finalizar" },
        ],
      },
    };
  }

  const nuevos = await db
    .select({
      id: donantes.id,
      nombre: donantes.nombre,
      telefono: donantes.telefono,
      direccion: donantes.direccion,
      notas: donantes.notas,
      createdAt: donantes.createdAt,
    })
    .from(donantes)
    .where(and(eq(donantes.estado, "nueva"), eq(donantes.donandoActualmente, false)))
    .orderBy(desc(donantes.createdAt))
    .limit(PAGE_SIZE)
    .offset(offset);

  const totalPaginas = Math.ceil(total / PAGE_SIZE);
  const desde = offset + 1;
  const hasta = offset + nuevos.length;

  let lista = `📋 *Contactos nuevos* (${total} total) — Pág. ${pagina + 1}/${totalPaginas}\n`;
  lista += `Mostrando ${desde}–${hasta}\n\n`;

  for (const [i, c] of nuevos.entries()) {
    const fecha = c.createdAt ? new Date(c.createdAt).toLocaleDateString("es-AR") : "?";
    lista += `*${i + 1}.* ${c.nombre || "Sin nombre"} · 📱 ${c.telefono}\n`;
    lista += `   📍 ${(c.direccion || "Sin dirección").slice(0, 45)}\n`;
    lista += `   📅 ${fecha}`;
    if (c.notas) {
      const nota = c.notas.length > 35 ? c.notas.slice(0, 35) + "..." : c.notas;
      lista += ` · 📝 ${nota}`;
    }
    lista += "\n\n";
  }

  lista += "─────────────────\n";
  lista += "Enviá el *número* para ver detalle y agendar";
  if (pagina > 0) lista += "\n*A* = anterior";
  if (pagina + 1 < totalPaginas) lista += "\n*S* = siguiente";
  lista += "\n*X* = exportar XLS · *0* = menú";

  return {
    reply: lista,
    nextStep: 11,
    data: { contactosNuevos: nuevos.map((c) => c.id), pagina, totalContactos: total },
  };
}

// ── Detalle de contacto nuevo + acciones ──────────────
async function handleDetalleContacto(respuesta: string, state: ConversationState): Promise<FlowResponse> {
  if (respuesta === "0") return handleBienvenida();

  const cmd = respuesta.toLowerCase().trim();

  // Paginación
  if (cmd === "s" || cmd === "a") {
    const paginaActual: number = state.data?.pagina ?? 0;
    const totalContactos: number = state.data?.totalContactos ?? 0;
    const totalPaginas = Math.ceil(totalContactos / PAGE_SIZE);
    let nuevaPagina = paginaActual;
    if (cmd === "s" && paginaActual + 1 < totalPaginas) nuevaPagina = paginaActual + 1;
    if (cmd === "a" && paginaActual > 0) nuevaPagina = paginaActual - 1;
    state.data = { ...state.data, pagina: nuevaPagina };
    return handleContactosNuevos(state);
  }

  // Exportar XLS
  if (cmd === "x" || cmd === "xls" || cmd === "excel" || cmd === "exportar" || cmd === "exportar xls") {
    return await handleExportarXLS(state.phone);
  }

  const idx = parseInt(respuesta) - 1;
  const ids: number[] = state.data?.contactosNuevos || [];

  if (isNaN(idx) || idx < 0 || idx >= ids.length) {
    // Texto no reconocido → re-mostrar la lista en lugar de mensaje de error
    return await handleContactosNuevos(state);
  }

  const [contacto] = await db
    .select()
    .from(donantes)
    .where(eq(donantes.id, ids[idx]))
    .limit(1);

  if (!contacto) {
    return { reply: "Contacto no encontrado. Elegí otro:", nextStep: 11 };
  }

  // Guardar el ID seleccionado para posible activación
  return {
    reply: "",
    nextStep: 12,
    data: { ...state.data, contactoSeleccionadoId: contacto.id },
    interactive: {
      type: "buttons",
      body:
        `📱 *Detalle del contacto*\n\n` +
        `👤 Nombre: ${contacto.nombre}\n` +
        `📱 Tel: ${contacto.telefono}\n` +
        `📍 Dir: ${contacto.direccion}\n` +
        `📅 Fecha: ${contacto.createdAt ? new Date(contacto.createdAt).toLocaleDateString("es-AR") : "?"}\n` +
        (contacto.notas ? `📝 ${contacto.notas}\n` : "") +
        `\nEstado: ${contacto.estado}`,
      buttons: [
        { id: "activar", title: "Agendar donante" },
        { id: "volver", title: "Volver a lista" },
        { id: "menu", title: "Menú principal" },
      ],
    },
  };
}

// ── Confirmar activación de donante ──────────────────
async function handleConfirmarActivacion(respuesta: string, state: ConversationState): Promise<FlowResponse> {
  const cmd = respuesta.toLowerCase().trim();
  const contactoId: number | undefined = state.data?.contactoSeleccionadoId;

  if (cmd === "volver" || cmd === "volver a lista") {
    return await handleContactosNuevos(state);
  }

  if (cmd === "menu" || cmd === "menú principal" || cmd === "menú") {
    return handleBienvenida();
  }

  if (cmd === "activar" || cmd === "agendar donante" || cmd === "si" || cmd === "sí" || cmd === "confirmar") {
    if (!contactoId) {
      return { reply: "No se encontró el contacto. Volvé a la lista.", nextStep: 11 };
    }

    const resultado = await activarDonante(contactoId);
    if (!resultado) {
      return { reply: "No se pudo activar. Contacto no encontrado.", nextStep: 11 };
    }

    return {
      reply: "",
      nextStep: 99,
      interactive: {
        type: "buttons",
        body:
          `✅ *Donante agendada exitosamente*\n\n` +
          `👤 ${resultado.nombre}\n` +
          `📱 ${resultado.telefono}\n` +
          `📍 ${resultado.direccion}\n\n` +
          `Estado actualizado a *activa*.\n` +
          `Falta asignarle zona y días de recolección.`,
        buttons: [
          { id: "1", title: "Volver al menú" },
          { id: "2", title: "Finalizar" },
        ],
      },
      notify: {
        target: "admin",
        message:
          `✅ *Donante agendada desde WhatsApp*\n\n` +
          `👤 ${resultado.nombre}\n` +
          `📱 ${resultado.telefono}\n` +
          `📍 ${resultado.direccion}\n\n` +
          `Estado: activa. Asignar zona y chofer.`,
      },
    };
  }

  // No entendió → mostrar botones de nuevo
  return {
    reply: "",
    nextStep: 12,
    interactive: {
      type: "buttons",
      body: "¿Qué querés hacer con este contacto?",
      buttons: [
        { id: "activar", title: "Agendar donante" },
        { id: "volver", title: "Volver a lista" },
        { id: "menu", title: "Menú principal" },
      ],
    },
  };
}

// ── Exportar contactos nuevos a XLS y enviar ─────────
async function handleExportarXLS(adminPhone: string): Promise<FlowResponse> {
  try {
    limpiarTmpViejos();
    const { filePath, fileName, total } = await generarXLSContactosNuevos();

    if (total === 0) {
      return {
        reply: "",
        nextStep: 99,
        interactive: {
          type: "buttons",
          body: "No hay contactos nuevos para exportar.",
          buttons: [
            { id: "1", title: "Volver al menú" },
            { id: "2", title: "Finalizar" },
          ],
        },
      };
    }

    await sendDocument(
      adminPhone,
      filePath,
      fileName,
      `📋 ${total} contactos nuevos — GARYCIO`,
    );

    return {
      reply: "",
      nextStep: 99,
      interactive: {
        type: "buttons",
        body: `📋 *XLS enviado* ✅\n\n${total} contactos nuevos exportados.\nRevisá el archivo adjunto.`,
        buttons: [
          { id: "1", title: "Volver al menú" },
          { id: "2", title: "Finalizar" },
        ],
      },
    };
  } catch (err) {
    logger.error({ err }, "Error al exportar XLS de contactos");
    return {
      reply: "❌ Hubo un error al generar el XLS. Intentá de nuevo.",
      nextStep: 99,
    };
  }
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
      reply: "",
      nextStep: 99,
      interactive: {
        type: "buttons",
        body: `🔍 No se encontraron donantes para "${query}".`,
        buttons: [
          { id: "1", title: "Nueva búsqueda" },
          { id: "2", title: "Menú principal" },
        ],
      },
    };
  }

  let lista = `🔍 *Resultados para "${query}"* (${resultados.length})\n\n`;
  for (const [i, d] of resultados.entries()) {
    const estado = d.donandoActualmente ? "🟢" : "🔴";
    lista += `*${i + 1}.* ${estado} ${d.nombre}\n`;
    lista += `   📱 ${d.telefono}\n`;
    lista += `   📍 ${d.direccion.slice(0, 50)}\n\n`;
  }

  lista += "Enviá el *número* para ver detalle, o *0* para volver:";

  return {
    reply: lista,
    nextStep: 21,
    data: { busquedaIds: resultados.map((d) => d.id) },
  };
}

async function handleDetalleDonante(respuesta: string, state: ConversationState): Promise<FlowResponse> {
  if (respuesta === "0") return handleBienvenida();

  const idx = parseInt(respuesta) - 1;
  const ids: number[] = state.data?.busquedaIds || [];

  if (isNaN(idx) || idx < 0 || idx >= ids.length) {
    return { reply: "Número no válido. Elegí de la lista o *0* para volver:", nextStep: 21 };
  }

  const donanteId = ids[idx];
  const [donante] = await db.select().from(donantes).where(eq(donantes.id, donanteId)).limit(1);
  if (!donante) {
    return { reply: "Donante no encontrada. Intentá de nuevo:", nextStep: 21 };
  }

  const histReclamos = await db.select().from(reclamos).where(eq(reclamos.donanteId, donanteId));
  const histBajas = await db.select().from(reportesBaja).where(eq(reportesBaja.donanteId, donanteId));

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

  detalle += `\n📊 Historial: ${histReclamos.length} reclamo(s), ${histBajas.length} reporte(s) de baja`;

  return {
    reply: "",
    nextStep: 99,
    interactive: {
      type: "buttons",
      body: detalle,
      buttons: [
        { id: "1", title: "Volver al menú" },
        { id: "2", title: "Finalizar" },
      ],
    },
  };
}

// ── Reclamos pendientes ──────────────────────────────────
async function handleReclamosPendientes(): Promise<FlowResponse> {
  const pendientes = await db
    .select({
      id: reclamos.id,
      tipo: reclamos.tipo,
      descripcion: reclamos.descripcion,
      estado: reclamos.estado,
      gravedad: reclamos.gravedad,
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
      reply: "",
      nextStep: 99,
      interactive: {
        type: "buttons",
        body: "✅ No hay reclamos pendientes.",
        buttons: [
          { id: "1", title: "Volver al menú" },
          { id: "2", title: "Finalizar" },
        ],
      },
    };
  }

  const gravedadEmoji: Record<string, string> = {
    leve: "🟡",
    moderado: "🟠",
    grave: "🔴",
    critico: "🚨",
  };

  let lista = `⚠️ *Reclamos pendientes* (${pendientes.length})\n\n`;
  for (const r of pendientes) {
    const fecha = r.fechaCreacion ? new Date(r.fechaCreacion).toLocaleDateString("es-AR") : "?";
    const emoji = gravedadEmoji[r.gravedad || "leve"] || "⚠️";
    lista += `${emoji} #${r.id} | ${r.tipo} | ${r.estado}\n`;
    lista += `  📅 ${fecha}`;
    if (r.descripcion) lista += ` | ${r.descripcion.slice(0, 40)}`;
    lista += "\n\n";
  }

  return {
    reply: lista,
    nextStep: 99,
    interactive: {
      type: "buttons",
      body: "¿Querés hacer algo más?",
      buttons: [
        { id: "1", title: "Volver al menú" },
        { id: "2", title: "Finalizar" },
      ],
    },
  };
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
      reply: "",
      nextStep: 99,
      interactive: {
        type: "buttons",
        body: "✅ No hay reportes de baja pendientes.",
        buttons: [
          { id: "1", title: "Volver al menú" },
          { id: "2", title: "Finalizar" },
        ],
      },
    };
  }

  let lista = `🔴 *Reportes de baja pendientes* (${pendientes.length})\n\n`;
  for (const b of pendientes) {
    const fecha = b.fecha ? new Date(b.fecha).toLocaleDateString("es-AR") : "?";
    lista += `• ${b.donanteNombre || "Donante #" + b.donanteId}\n`;
    lista += `  📍 ${(b.donanteDireccion || "").slice(0, 40)}\n`;
    lista += `  📝 Motivo: ${b.motivo || "?"}\n`;
    lista += `  👷 Reportado por: ${b.reportadoPorNombre || b.reportadoPor}\n`;
    lista += `  📅 ${fecha} · Contactada: ${b.contactadaDonante ? "Sí" : "No"}\n\n`;
  }

  return {
    reply: lista,
    nextStep: 99,
    interactive: {
      type: "buttons",
      body: "¿Querés hacer algo más?",
      buttons: [
        { id: "1", title: "Volver al menú" },
        { id: "2", title: "Finalizar" },
      ],
    },
  };
}

// ── Progreso de rutas ──────────────────────────────────
function handleProgresoRutas(): FlowResponse {
  const resumen = obtenerResumenProgreso();

  if (resumen.length === 0) {
    return {
      reply: "",
      nextStep: 99,
      interactive: {
        type: "buttons",
        body: "🚛 No hay vehículos con progreso registrado hoy.",
        buttons: [
          { id: "1", title: "Volver al menú" },
          { id: "2", title: "Finalizar" },
        ],
      },
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

  return {
    reply: lista,
    nextStep: 99,
    interactive: {
      type: "buttons",
      body: "¿Querés hacer algo más?",
      buttons: [
        { id: "1", title: "Volver al menú" },
        { id: "2", title: "Finalizar" },
      ],
    },
  };
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
    reply: "",
    nextStep: 99,
    interactive: {
      type: "buttons",
      body:
        `📊 *Resultados de encuesta mensual*\n\n` +
        `📨 Enviadas: ${s.total}\n` +
        `💬 Respondidas: ${s.respondidas} (${tasaRespuesta}%)\n` +
        `✅ Sí recibieron regalo: ${s.si}\n` +
        `❌ No recibieron regalo: ${s.no}\n` +
        `⏳ Sin respuesta: ${s.total - s.respondidas}`,
      buttons: [
        { id: "1", title: "Volver al menú" },
        { id: "2", title: "Finalizar" },
      ],
    },
  };
}

// ── Generar reporte PDF ──────────────────────────────────
async function handleGenerarReporte(adminPhone: string): Promise<FlowResponse> {
  try {
    const filePath = await generarReportePDF();
    const fecha = new Date().toLocaleDateString("es-AR");

    await sendDocument(
      adminPhone,
      filePath,
      `GARYCIO_Reporte_${fecha.replace(/\//g, "-")}.pdf`,
      `📊 Reporte diario GARYCIO - ${fecha}`,
    );

    marcarReporteEnviado();

    return {
      reply: "",
      nextStep: 99,
      interactive: {
        type: "buttons",
        body: "📄 *Reporte diario enviado* ✅\nRevisá el archivo adjunto.",
        buttons: [
          { id: "1", title: "Volver al menú" },
          { id: "2", title: "Finalizar" },
        ],
      },
    };
  } catch (err) {
    logger.error({ err }, "Error al generar reporte desde admin");
    return {
      reply: "❌ Hubo un error al generar el reporte. Intentá de nuevo en unos minutos.",
      nextStep: 99,
    };
  }
}

// ── Estado de difusión ──────────────────────────────────
async function handleEstadoDifusion(): Promise<FlowResponse> {
  const statsGlobal = await db
    .select({
      total: count(),
      confirmadas: sql<number>`COUNT(*) FILTER (WHERE ${difusionEnvios.confirmado} = true)`,
    })
    .from(difusionEnvios);

  const statsMV = await db
    .select({
      total: count(),
      confirmadas: sql<number>`COUNT(*) FILTER (WHERE ${difusionEnvios.confirmado} = true)`,
    })
    .from(difusionEnvios)
    .where(like(difusionEnvios.diasRecoleccion, "%Martes%"));

  const statsMS = await db
    .select({
      total: count(),
      confirmadas: sql<number>`COUNT(*) FILTER (WHERE ${difusionEnvios.confirmado} = true)`,
    })
    .from(difusionEnvios)
    .where(like(difusionEnvios.diasRecoleccion, "%Mi%rcoles%"));

  const g = statsGlobal[0] || { total: 0, confirmadas: 0 };
  const mv = statsMV[0] || { total: 0, confirmadas: 0 };
  const ms = statsMS[0] || { total: 0, confirmadas: 0 };

  const pctGlobal = Number(g.total) > 0 ? Math.round((Number(g.confirmadas) / Number(g.total)) * 100) : 0;
  const pctMV = Number(mv.total) > 0 ? Math.round((Number(mv.confirmadas) / Number(mv.total)) * 100) : 0;
  const pctMS = Number(ms.total) > 0 ? Math.round((Number(ms.confirmadas) / Number(ms.total)) * 100) : 0;

  const ultimasConfirmadas = await db
    .select({
      nombre: difusionEnvios.nombre,
      telefono: difusionEnvios.telefono,
      diasRecoleccion: difusionEnvios.diasRecoleccion,
      fechaConfirmacion: difusionEnvios.fechaConfirmacion,
    })
    .from(difusionEnvios)
    .where(eq(difusionEnvios.confirmado, true))
    .orderBy(desc(difusionEnvios.fechaConfirmacion))
    .limit(5);

  let body =
    `📨 *Estado de difusión*\n\n` +
    `📤 Total: ${g.total} enviados\n` +
    `✅ Confirmaron: *${g.confirmadas}* (${pctGlobal}%)\n` +
    `⏳ Pendientes: *${Number(g.total) - Number(g.confirmadas)}*\n\n` +
    `📅 *MV:* ${mv.total} env | ✅ ${mv.confirmadas} (${pctMV}%)\n` +
    `📅 *MS:* ${ms.total} env | ✅ ${ms.confirmadas} (${pctMS}%)\n`;

  if (ultimasConfirmadas.length > 0) {
    body += `\n*Últimas confirmaciones:*\n`;
    for (const c of ultimasConfirmadas) {
      const hora = c.fechaConfirmacion
        ? new Date(c.fechaConfirmacion).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })
        : "?";
      const grupo = c.diasRecoleccion?.includes("Martes") ? "MV" : c.diasRecoleccion?.includes("iércoles") ? "MS" : "LJ";
      body += `• [${grupo}] ${c.nombre ?? c.telefono} — ${hora}\n`;
    }
  }

  return {
    reply: "",
    nextStep: 99,
    interactive: {
      type: "buttons",
      body,
      buttons: [
        { id: "1", title: "Volver al menú" },
        { id: "10", title: "Actualizar" },
      ],
    },
  };
}

// ── Resumen rápido (stats del día) ───────────────────────
async function handleResumenRapido(): Promise<FlowResponse> {
  const [{ nuevos }] = await db
    .select({ nuevos: count() })
    .from(donantes)
    .where(and(eq(donantes.estado, "nueva"), eq(donantes.donandoActualmente, false)));

  const [{ reclamosPendientes }] = await db
    .select({ reclamosPendientes: count() })
    .from(reclamos)
    .where(sql`${reclamos.estado} IN ('pendiente', 'notificado_chofer', 'seguimiento_enviado')`);

  const [{ bajasPendientes }] = await db
    .select({ bajasPendientes: count() })
    .from(reportesBaja)
    .where(eq(reportesBaja.confirmado, false));

  const [difusion] = await db
    .select({
      total: count(),
      confirmadas: sql<number>`COUNT(*) FILTER (WHERE ${difusionEnvios.confirmado} = true)`,
    })
    .from(difusionEnvios);

  const dif = difusion || { total: 0, confirmadas: 0 };
  const pctDif = Number(dif.total) > 0 ? Math.round((Number(dif.confirmadas) / Number(dif.total)) * 100) : 0;

  const [{ activas }] = await db
    .select({ activas: count() })
    .from(donantes)
    .where(eq(donantes.donandoActualmente, true));

  return {
    reply: "",
    nextStep: 99,
    interactive: {
      type: "buttons",
      body:
        `📊 *Resumen rápido*\n\n` +
        `👥 Donantes activas: *${activas}*\n` +
        `🆕 Contactos nuevos: *${nuevos}*\n` +
        `⚠️ Reclamos pendientes: *${reclamosPendientes}*\n` +
        `🔴 Bajas sin confirmar: *${bajasPendientes}*\n` +
        `📨 Difusión: *${dif.confirmadas}*/${dif.total} (${pctDif}%)`,
      buttons: [
        { id: "1", title: "Volver al menú" },
        { id: "2", title: "Finalizar" },
      ],
    },
  };
}

// ── Revisar feedback de IA ────────────────────────────────
async function handleRevisarFeedbackIA(respuesta: string, state: ConversationState): Promise<FlowResponse> {
  const cmd = respuesta.toLowerCase().trim();

  // Navegación
  if (cmd === "1" || cmd === "volver al menú" || cmd === "volver al menu" || cmd === "volver") {
    return handleBienvenida();
  }
  if (cmd === "2" || cmd === "finalizar" || cmd === "salir") {
    return { reply: "✅ Sesión de admin finalizada.", endFlow: true };
  }

  // Sub-comando: marcar todos los fallbacks como revisados
  if (cmd === "marcar" || cmd === "marcar revisado" || cmd === "limpiar") {
    await db.update(iaFeedback).set({ revisado: true }).where(eq(iaFeedback.revisado, false));
    return {
      reply: "",
      nextStep: 99,
      interactive: {
        type: "buttons",
        body: "✅ Todos los registros de IA feedback marcados como revisados.",
        buttons: [
          { id: "1", title: "Volver al menú" },
          { id: "2", title: "Finalizar" },
        ],
      },
    };
  }

  // Sub-comando: ver solo los fallbacks sin revisar
  const soloPendientes = cmd === "pendientes" || cmd === "ver pendientes" || state.data?.iaPendientes;

  // Stats globales
  const [stats] = await db
    .select({
      total: sql<number>`COUNT(*)`,
      fallbacks: sql<number>`COUNT(*) FILTER (WHERE ${iaFeedback.useFallback} = true)`,
      revisados: sql<number>`COUNT(*) FILTER (WHERE ${iaFeedback.revisado} = true)`,
      sinRevisar: sql<number>`COUNT(*) FILTER (WHERE ${iaFeedback.revisado} = false AND ${iaFeedback.useFallback} = true)`,
    })
    .from(iaFeedback);

  const s = stats || { total: 0, fallbacks: 0, revisados: 0, sinRevisar: 0 };
  const pctFallback = Number(s.total) > 0 ? Math.round((Number(s.fallbacks) / Number(s.total)) * 100) : 0;

  // Últimos fallbacks sin revisar
  const ultimosFallbacks = await db
    .select({
      id: iaFeedback.id,
      telefono: iaFeedback.telefono,
      mensajeOriginal: iaFeedback.mensajeOriginal,
      intencionDetectada: iaFeedback.intencionDetectada,
      errorDetalle: iaFeedback.errorDetalle,
      createdAt: iaFeedback.createdAt,
    })
    .from(iaFeedback)
    .where(and(eq(iaFeedback.useFallback, true), eq(iaFeedback.revisado, false)))
    .orderBy(desc(iaFeedback.createdAt))
    .limit(5);

  // Intenciones más frecuentes (últimas 50)
  const recientes = await db
    .select({ intencion: iaFeedback.intencionDetectada })
    .from(iaFeedback)
    .where(eq(iaFeedback.useFallback, false))
    .orderBy(desc(iaFeedback.createdAt))
    .limit(50);

  const conteoIntenciones: Record<string, number> = {};
  for (const r of recientes) {
    if (r.intencion) {
      conteoIntenciones[r.intencion] = (conteoIntenciones[r.intencion] || 0) + 1;
    }
  }
  const topIntenciones = Object.entries(conteoIntenciones)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k, v]) => `  • ${k}: ${v}`)
    .join("\n");

  let body =
    `🤖 *Reporte de IA feedback*\n\n` +
    `📊 Total interacciones: ${s.total}\n` +
    `⚠️ Con fallback (IA falló): ${s.fallbacks} (${pctFallback}%)\n` +
    `👀 Sin revisar: *${s.sinRevisar}*\n` +
    `✅ Revisados: ${s.revisados}\n`;

  if (topIntenciones) {
    body += `\n📈 *Top intenciones (últimas 50):*\n${topIntenciones}\n`;
  }

  if (ultimosFallbacks.length > 0) {
    body += `\n🔴 *Últimos fallos sin revisar:*\n`;
    for (const f of ultimosFallbacks) {
      const hora = f.createdAt
        ? new Date(f.createdAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })
        : "?";
      const msg = (f.mensajeOriginal || "").slice(0, 40);
      const err = f.errorDetalle ? ` | ${f.errorDetalle.slice(0, 30)}` : "";
      body += `• [${hora}] "${msg}"${err}\n`;
    }
  } else {
    body += `\n✅ No hay fallos pendientes de revisión.`;
  }

  return {
    reply: "",
    nextStep: 80,
    data: { iaPendientes: true },
    interactive: {
      type: "buttons",
      body,
      buttons: [
        { id: "marcar", title: "Marcar revisados" },
        { id: "1", title: "Volver al menú" },
        { id: "2", title: "Finalizar" },
      ],
    },
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
      "*1* - 📋 *Contactos nuevos* + agendar\n" +
      "*12* - 📥 *Exportar XLS* de contactos nuevos\n" +
      "*2* - 🔍 *Buscar donante*\n" +
      "*3* - ⚠️ *Reclamos pendientes*\n" +
      "*4* - 🔴 *Reportes de baja*\n" +
      "*5* - 🚛 *Progreso de rutas*\n" +
      "*6* - 📊 *Resultados encuesta*\n" +
      "*8* - 📄 *Generar reporte diario (PDF)*\n" +
      "*10* - 📨 *Estado difusión*\n" +
      "*11* - 📊 *Resumen rápido*\n\n" +
      "━━━━━━━━━━━━━━━━━━━━━\n" +
      "*Alertas automáticas:*\n" +
      "━━━━━━━━━━━━━━━━━━━━━\n\n" +
      "🚨 Exceso de velocidad\n" +
      "🔴 Incidentes graves\n" +
      "⚠️ Reclamos nuevos\n" +
      "📋 Reportes de baja\n" +
      "🚛 Progreso de rutas\n" +
      "📊 Reporte diario automático",
    nextStep: 99,
  };
}

// ── Volver o finalizar ──────────────────────────────────
async function handleVolverOFinalizar(respuesta: string): Promise<FlowResponse> {
  const r = respuesta.toLowerCase().trim();

  // Volver al menú
  if (r === "1" || r === "si" || r === "sí" || r === "volver" || r === "menu" || r === "menú"
    || r === "volver al menú" || r === "volver al menu" || r === "nueva búsqueda"
    || r === "nueva busqueda") {
    return handleBienvenida();
  }

  // Finalizar
  if (r === "2" || r === "no" || r === "finalizar" || r === "salir" || r === "menú principal") {
    return { reply: "✅ Sesión de admin finalizada.", endFlow: true };
  }

  // Actualizar difusión
  if (r === "10" || r === "actualizar" || r === "estado difusión" || r === "estado difusion") {
    return await handleEstadoDifusion();
  }

  // No entendió → botones interactivos
  return {
    reply: "",
    nextStep: 99,
    interactive: {
      type: "buttons",
      body: "¿Querés hacer algo más?",
      buttons: [
        { id: "1", title: "Volver al menú" },
        { id: "2", title: "Finalizar" },
      ],
    },
  };
}
