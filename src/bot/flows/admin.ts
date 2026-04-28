import { FlowHandler, ConversationState, FlowResponse, InteractiveMessage } from "./types";
import { db } from "../../database";
import { donantes, reclamos, reportesBaja, encuestasRegalo, difusionEnvios, iaFeedback, audioMensajes, humanEscalations, mensajesLog } from "../../database/schema";
import { eq, and, desc, sql, ilike, count, like } from "drizzle-orm";
import { logger } from "../../config/logger";
import { obtenerResumenProgreso } from "../../services/progreso-ruta";
import { marcarReporteEnviado } from "../../services/reporte-diario";
import { generarReportePDF } from "../../services/reporte-pdf";
import { sendDocument } from "../../bot/client";
import { generarXLSContactosNuevos, activarDonante, limpiarTmpViejos } from "../../services/exportar-contactos";
import { getBotState, pauseBot, resumeBot, emergencyStop, setWhitelistLimit, getWhitelistLimit, ROLLOUT_PLAN, getCapacidad, ajustarLimiteDonantes } from "../../services/bot-control";
import { addTrainingExample, listTrainingExamples, toggleTrainingExample, deleteTrainingExample } from "../../services/ia-training";
import { classifyIntent, type ClassifierResult } from "../../services/clasificador-ia";
import { resolveHumanEscalation } from "../../services/human-escalation";

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
 * 80 - Revisar IA feedback
 * 90 - Bot control
 * 91 - Agregar ejemplo IA
 * 92 - Ver ejemplos IA
 * 93 - Acción sobre ejemplo IA
 * 95 - Ajustar límite bot
 * 99 - Volver al menú o finalizar
 * 100 - Gestionar IA (hub)
 * 101 - Simular clasificación IA
 * 102 - Reclasificar desde feedback
 * 103 - Ver escalaciones activas
 * 104 - Resolver escalación
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
      case 30: return await handleReclamosPendientes(state);
      case 31: return await handleAccionReclamo(respuesta, state);
      case 40: return await handleBajasPendientes();
      case 50: return handleProgresoRutas();
      case 60: return await handleResultadosEncuesta();
      case 70: return await handleGenerarReporte(state.phone);
      case 80: return await handleRevisarFeedbackIA(respuesta, state);
      case 90: return await handleBotControlMenu(respuesta, state);
      case 91: return await handleAgregarEjemploIA(respuesta, state);
      case 92: return await handleVerEjemplosIA(respuesta, state);
      case 93: return await handleAccionEjemploIA(respuesta, state);
      case 94: return await handleAccionAudio(respuesta, state);
      case 95: return await handleAjustarLimiteBot(respuesta);
      case 99: return await handleVolverOFinalizar(respuesta);
      case 100: return await handleGestionarIA(respuesta, state);
      case 101: return await handleSimularClasificacion(respuesta, state);
      case 102: return await handleReclasificarFeedback(respuesta, state);
      case 103: return await handleVerEscalaciones(respuesta, state);
      case 104: return await handleResolverEscalacion(respuesta, state);
      case 110: return await handleControlBotHub(respuesta, state);
      case 111: return await handleEstadoServidor();
      default:
        return handleBienvenida();
    }
  },
};

// ── Bienvenida (menú interactivo WhatsApp) ──────────
function handleBienvenida(): FlowResponse {
  // WhatsApp permite MAXIMO 10 rows en listas interactivas (usamos 9)
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
          { id: "3", title: "Reclamos pendientes", description: "Ver, resolver y limpiar" },
        ],
      }, {
        title: "Operación",
        rows: [
          { id: "11", title: "Resumen del día", description: "Stats, mensajes, IA, servidor" },
          { id: "8", title: "Reporte diario PDF", description: "Generar y enviar" },
        ],
      }, {
        title: "Control",
        rows: [
          { id: "14", title: "Control del bot", description: "Pausar, reiniciar, limpiar" },
          { id: "22", title: "Estado del servidor", description: "RAM, uptime, errores, DB" },
          { id: "20", title: "Capacidad del bot", description: "Ver y ajustar límite" },
          { id: "19", title: "Audios pendientes", description: "Revisar y marcar atendidos" },
          { id: "21", title: "Gestionar IA", description: "Entrenar, simular, escalar" },
        ],
      }],
    },
  };
}

// ── Menú: mapeo de títulos interactivos y números ────
async function handleMenu(respuesta: string, state: ConversationState): Promise<FlowResponse> {
  const opcion = respuesta.toLowerCase().trim();
  const menuMap: Record<string, string> = {
    // Títulos exactos de la lista interactiva
    "contactos nuevos": "1",
    "reclamos pendientes": "3",
    "resumen del día": "11",
    "resumen del dia": "11",
    "resumen rápido": "11",
    "resumen rapido": "11",
    "reporte diario pdf": "8",
    "control del bot": "14",
    "estado del servidor": "22",
    "capacidad del bot": "20",
    "audios pendientes": "19",
    "gestionar ia": "21",
    "finalizar": "9",
    // Aliases adicionales
    "exportar xls": "12",
    "buscar donante": "2",
    "reportes de baja": "4",
    "progreso de rutas": "5",
    "encuesta mensual": "6",
    "lista de comandos": "7",
    "estado difusión": "10",
    "estado difusion": "10",
    "revisar ia feedback": "13",
    "ia feedback": "13",
    "feedback ia": "13",
    "estado del bot": "22",
    "estado bot": "22",
    "pausar bot": "14",
    "reanudar bot": "14",
    "whitelist": "17",
    "whitelist progresiva": "17",
    "entrenar ia": "18",
    "entrenar": "18",
    "audios": "19",
    "ia": "21",
    "capacidad": "20",
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
      return await handleReclamosPendientes({ ...state, data: { paginaReclamos: 0 } });
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
      return await handleResumenDelDia();
    case "12":
      return await handleExportarXLS(state.phone);
    case "13":
      return await handleRevisarFeedbackIA("ver", state);
    case "14":
      return handleControlBotMenu();
    case "17":
      return handleBotWhitelist();
    case "18":
      return handleEntrenarIA();
    case "19":
    case "audios pendientes":
      return await handleAudiosPendientes({ ...state, data: { paginaAudios: 0 } });
    case "20":
    case "capacidad":
    case "capacidad del bot":
      return await handleCapacidadBot();
    case "21":
      return handleGestionarIAMenu();
    case "22":
      return await handleEstadoServidor();
    default:
      return handleBienvenida();
  }
}

const PAGE_SIZE = 10; // WhatsApp limita mensajes a 4096 chars

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
    lista += `*${offset + i + 1}.* ${(c.nombre || "Sin nombre").slice(0, 25)} · ${c.telefono}\n`;
    lista += `  ${(c.direccion || "Sin dirección").slice(0, 40)} · ${fecha}\n`;
  }

  lista += "─────────────\n";
  lista += "Número = ver detalle";
  if (pagina > 0) lista += " | *A* = ant.";
  if (pagina + 1 < totalPaginas) lista += " | *S* = sig.";
  lista += "\n*X* exportar XLS | *0* menú";

  // Seguridad: WhatsApp limita a 4096 chars
  if (lista.length > 4000) lista = lista.slice(0, 3990) + "...\n*0* menú";

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
async function handleReclamosPendientes(state: ConversationState): Promise<FlowResponse> {
  const pagina = state.data?.paginaReclamos ?? 0;
  const PAGE = 10;
  const offset = pagina * PAGE;

  const [{ total }] = await db
    .select({ total: count() })
    .from(reclamos)
    .where(sql`${reclamos.estado} IN ('pendiente', 'notificado_chofer', 'seguimiento_enviado')`);

  if (total === 0) {
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
    .where(sql`${reclamos.estado} IN ('pendiente', 'notificado_chofer', 'seguimiento_enviado')`)
    .orderBy(desc(reclamos.fechaCreacion))
    .limit(PAGE)
    .offset(offset);

  const totalPaginas = Math.ceil(total / PAGE);
  const gravedadEmoji: Record<string, string> = {
    leve: "🟡", moderado: "🟠", grave: "🔴", critico: "🚨",
  };

  let lista = `⚠️ *Reclamos pendientes* (${total} total) — Pág. ${pagina + 1}/${totalPaginas}\n\n`;
  for (const [i, r] of pendientes.entries()) {
    const fecha = r.fechaCreacion ? new Date(r.fechaCreacion).toLocaleDateString("es-AR") : "?";
    const emoji = gravedadEmoji[r.gravedad || "leve"] || "⚠️";
    lista += `*${offset + i + 1}.* ${emoji} ${r.tipo} | ${r.estado}\n`;
    lista += `  📅 ${fecha}`;
    if (r.descripcion) lista += ` | ${r.descripcion.slice(0, 35)}`;
    lista += "\n";
  }
  lista += "\n─────────────\n";
  lista += "Número = resolver";
  if (pagina > 0) lista += " | *A* = ant.";
  if (pagina + 1 < totalPaginas) lista += " | *S* = sig.";
  lista += "\n*L* = limpiar resueltos viejos | *0* menú";

  if (lista.length > 4000) lista = lista.slice(0, 3990) + "...\n*0* menú";

  return {
    reply: lista,
    nextStep: 31,
    data: { reclamoIds: pendientes.map(r => r.id), paginaReclamos: pagina, totalReclamos: total },
  };
}

// ── Acción sobre reclamo (resolver, paginar, limpiar) ──
async function handleAccionReclamo(respuesta: string, state: ConversationState): Promise<FlowResponse> {
  const cmd = respuesta.toLowerCase().trim();
  if (cmd === "0" || cmd === "menu" || cmd === "menú") return handleBienvenida();
  if (cmd === "salir" || cmd === "finalizar") return { reply: "✅ Sesión finalizada.", endFlow: true };

  // Paginación
  if (cmd === "s" || cmd === "a") {
    const pag = state.data?.paginaReclamos ?? 0;
    const total = state.data?.totalReclamos ?? 0;
    const totalPag = Math.ceil(total / 10);
    let nuevaPag = pag;
    if (cmd === "s" && pag + 1 < totalPag) nuevaPag = pag + 1;
    if (cmd === "a" && pag > 0) nuevaPag = pag - 1;
    return handleReclamosPendientes({ ...state, data: { ...state.data, paginaReclamos: nuevaPag } });
  }

  // Limpiar resueltos viejos (> 7 días)
  if (cmd === "l" || cmd === "limpiar") {
    const result = await db.execute(sql`
      DELETE FROM reclamos
      WHERE estado = 'resuelto' AND fecha_creacion < NOW() - INTERVAL '7 days'
    `);
    const deleted = (result as any).rowCount ?? 0;
    return {
      reply: `🧹 ${deleted} reclamos resueltos antiguos eliminados.`,
      nextStep: 99,
      interactive: {
        type: "buttons",
        body: `✅ Limpieza completada. ${deleted} reclamos eliminados.`,
        buttons: [
          { id: "1", title: "Volver al menú" },
          { id: "2", title: "Ver reclamos" },
        ],
      },
    };
  }

  // Resolver por número
  const idx = parseInt(respuesta) - 1;
  const ids: number[] = state.data?.reclamoIds || [];
  if (!isNaN(idx) && idx >= 0 && idx < ids.length) {
    await db.update(reclamos).set({ estado: "resuelto" } as any).where(eq(reclamos.id, ids[idx]));
    return {
      reply: "",
      nextStep: 99,
      interactive: {
        type: "buttons",
        body: `✅ Reclamo #${ids[idx]} marcado como resuelto.`,
        buttons: [
          { id: "1", title: "Volver al menú" },
          { id: "2", title: "Ver reclamos" },
        ],
      },
    };
  }

  return handleReclamosPendientes(state);
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

// ── Resumen del día (stats accionables) ───────────────────────
async function handleResumenDelDia(): Promise<FlowResponse> {
  const hoy = new Date();
  const fechaStr = hoy.toLocaleDateString("es-AR", { day: "numeric", month: "short" });

  // Donantes activas (donando)
  const [{ activas }] = await db
    .select({ activas: count() })
    .from(donantes)
    .where(eq(donantes.donandoActualmente, true));

  // Donantes habilitadas en bot
  const [{ habilitadas }] = await db.execute<{ habilitadas: number }>(sql`
    SELECT count(*) as habilitadas FROM donantes_bot_activos WHERE estado = 'activo'
  `).then(r => [{ habilitadas: Number(r.rows?.[0]?.habilitadas ?? 0) }]);

  // Contactos nuevos (pendientes de completar datos)
  const [{ nuevos }] = await db
    .select({ nuevos: count() })
    .from(donantes)
    .where(and(eq(donantes.estado, "nueva"), eq(donantes.donandoActualmente, false)));

  // Mensajes hoy (entrantes y salientes)
  const mensajesHoy = await db.execute<{ dir: string; cnt: number }>(sql`
    SELECT direccion_msg as dir, count(*) as cnt
    FROM mensajes_log
    WHERE created_at >= CURRENT_DATE
    GROUP BY direccion_msg
  `);
  const entrantes = Number(mensajesHoy.rows?.find(r => r.dir === "entrante")?.cnt ?? 0);
  const salientes = Number(mensajesHoy.rows?.find(r => r.dir === "saliente")?.cnt ?? 0);

  // IA: escalaciones hoy vs mensajes procesados
  const [{ escalacionesHoy }] = await db.execute<{ escalacionesHoy: number }>(sql`
    SELECT count(*) as "escalacionesHoy"
    FROM human_escalations
    WHERE created_at >= CURRENT_DATE
  `).then(r => [{ escalacionesHoy: Number(r.rows?.[0]?.escalacionesHoy ?? 0) }]);
  const iaResueltos = Math.max(0, entrantes - escalacionesHoy);
  const iaPct = entrantes > 0 ? Math.round((iaResueltos / entrantes) * 100) : 100;

  // Reclamos abiertos
  const [{ reclamosAbiertos }] = await db
    .select({ reclamosAbiertos: count() })
    .from(reclamos)
    .where(sql`${reclamos.estado} IN ('pendiente', 'notificado_chofer', 'seguimiento_enviado')`);

  // Bajas pendientes
  const [{ bajasPendientes }] = await db
    .select({ bajasPendientes: count() })
    .from(reportesBaja)
    .where(eq(reportesBaja.confirmado, false));

  // Audios sin atender
  const [{ audiosPendientes }] = await db
    .select({ audiosPendientes: count() })
    .from(audioMensajes)
    .where(eq(audioMensajes.atendido, false));

  // Training examples activos
  const [{ trainingActivos }] = await db.execute<{ trainingActivos: number }>(sql`
    SELECT count(*) as "trainingActivos" FROM ia_training_examples WHERE activo = true
  `).then(r => [{ trainingActivos: Number(r.rows?.[0]?.trainingActivos ?? 0) }]);

  // Server mini-status
  const mem = process.memoryUsage();
  const uptimeMin = Math.floor(process.uptime() / 60);
  const uptimeStr = uptimeMin >= 60 ? `${Math.floor(uptimeMin / 60)}h ${uptimeMin % 60}min` : `${uptimeMin}min`;

  const body =
    `📊 *Resumen del día* (${fechaStr})\n\n` +
    `👥 Donantes: *${activas}* activas | *${habilitadas}* en bot\n` +
    `🆕 Contactos nuevos: *${nuevos}*\n` +
    `📩 Mensajes hoy: *${entrantes}* entrantes | *${salientes}* salientes\n` +
    `🤖 IA: *${iaResueltos}* resueltos | *${escalacionesHoy}* escalados | *${iaPct}%* éxito\n` +
    `⚠️ Reclamos abiertos: *${reclamosAbiertos}*\n` +
    `🔴 Bajas pendientes: *${bajasPendientes}*\n` +
    `🎤 Audios sin atender: *${audiosPendientes}*\n` +
    `🧠 Training examples: *${trainingActivos}* activos\n\n` +
    `💻 Servidor: ${Math.round(mem.rss / 1024 / 1024)}MB RAM | ${uptimeStr} uptime`;

  return {
    reply: "",
    nextStep: 99,
    interactive: {
      type: "buttons",
      body,
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

// ── Audios pendientes (con paginación) ──
async function handleAudiosPendientes(state: ConversationState): Promise<FlowResponse> {
  const pagina = state.data?.paginaAudios ?? 0;
  const PAGE = 10;
  const offset = pagina * PAGE;

  const [{ total }] = await db
    .select({ total: count() })
    .from(audioMensajes)
    .where(eq(audioMensajes.atendido, false));

  if (total === 0) {
    return {
      reply: "",
      nextStep: 99,
      interactive: {
        type: "buttons",
        body: "✅ No hay audios pendientes de atención.",
        buttons: [
          { id: "1", title: "Volver al menú" },
          { id: "2", title: "Finalizar" },
        ],
      },
    };
  }

  const pendientes = await db
    .select()
    .from(audioMensajes)
    .where(eq(audioMensajes.atendido, false))
    .orderBy(desc(audioMensajes.createdAt))
    .limit(PAGE)
    .offset(offset);

  const totalPaginas = Math.ceil(total / PAGE);

  let body = `🎤 *Audios pendientes* (${total} total) — Pág. ${pagina + 1}/${totalPaginas}\n\n`;
  for (const [i, a] of pendientes.entries()) {
    const fecha = a.createdAt ? new Date(a.createdAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "?";
    body += `*${offset + i + 1}.* 📱 ${a.telefono} — ${fecha}\n`;
  }
  body += "\n─────────────\n";
  body += "Número = marcar atendido";
  if (pagina > 0) body += " | *A* = ant.";
  if (pagina + 1 < totalPaginas) body += " | *S* = sig.";
  body += "\n*T* = marcar todos | *0* menú";

  if (body.length > 4000) body = body.slice(0, 3990) + "...\n*0* menú";

  return {
    reply: body,
    nextStep: 94,
    data: { audioIds: pendientes.map(a => a.id), paginaAudios: pagina, totalAudios: total },
  };
}

// ── Acción sobre audio pendiente ──
async function handleAccionAudio(respuesta: string, state: ConversationState): Promise<FlowResponse> {
  const cmd = respuesta.toLowerCase().trim();
  if (cmd === "0" || cmd === "menu" || cmd === "menú") return handleBienvenida();
  if (cmd === "salir" || cmd === "finalizar") return { reply: "✅ Sesión finalizada.", endFlow: true };

  // Paginación
  if (cmd === "s" || cmd === "a") {
    const pag = state.data?.paginaAudios ?? 0;
    const total = state.data?.totalAudios ?? 0;
    const totalPag = Math.ceil(total / 10);
    let nuevaPag = pag;
    if (cmd === "s" && pag + 1 < totalPag) nuevaPag = pag + 1;
    if (cmd === "a" && pag > 0) nuevaPag = pag - 1;
    return handleAudiosPendientes({ ...state, data: { ...state.data, paginaAudios: nuevaPag } });
  }

  // Marcar todos como atendidos
  if (cmd === "t" || cmd === "todos" || cmd === "marcar todos") {
    const result = await db
      .update(audioMensajes)
      .set({ atendido: true, atendidoPor: state.phone, updatedAt: new Date() })
      .where(eq(audioMensajes.atendido, false));
    const updated = (result as any).rowCount ?? 0;
    return {
      reply: "",
      nextStep: 99,
      interactive: {
        type: "buttons",
        body: `✅ ${updated} audios marcados como atendidos.`,
        buttons: [
          { id: "1", title: "Volver al menú" },
          { id: "2", title: "Finalizar" },
        ],
      },
    };
  }

  // Marcar individual por número
  const idx = parseInt(respuesta) - 1;
  const ids: number[] = state.data?.audioIds || [];
  if (isNaN(idx) || idx < 0 || idx >= ids.length) {
    return { reply: "Número no válido. Elegí de la lista o *0* para volver:", nextStep: 94 };
  }
  const audioId = ids[idx];
  await db
    .update(audioMensajes)
    .set({ atendido: true, atendidoPor: state.phone, updatedAt: new Date() })
    .where(eq(audioMensajes.id, audioId));
  return {
    reply: "",
    nextStep: 99,
    interactive: {
      type: "buttons",
      body: `✅ Audio #${((state.data?.paginaAudios ?? 0) * 10) + idx + 1} marcado como atendido.`,
      buttons: [
        { id: "1", title: "Volver al menú" },
        { id: "2", title: "Ver audios" },
      ],
    },
  };
}

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


// ════════════════════════════════════════════════════════════
// NUEVOS HANDLERS: Bot Control + Entrenamiento IA
// ════════════════════════════════════════════════════════════

// ── Bot Status ──
// ── Estado del Servidor (info técnica detallada) ──
async function handleEstadoServidor(): Promise<FlowResponse> {
  const botState = getBotState();
  const mem = process.memoryUsage();
  const uptimeMin = Math.floor(process.uptime() / 60);
  const uptimeStr = uptimeMin >= 60 ? `${Math.floor(uptimeMin / 60)}h ${uptimeMin % 60}min` : `${uptimeMin}min`;

  // DB size
  const dbSize = await db.execute<{ size: string }>(sql`
    SELECT pg_size_pretty(pg_database_size('garycio')) as size
  `).then(r => r.rows?.[0]?.size ?? "?").catch(() => "?");

  // Total donantes
  const [{ totalDonantes }] = await db.select({ totalDonantes: count() }).from(donantes);

  // Mensajes hoy
  const [{ msgsHoy }] = await db.execute<{ msgsHoy: number }>(sql`
    SELECT count(*) as "msgsHoy" FROM mensajes_log WHERE created_at >= CURRENT_DATE
  `).then(r => [{ msgsHoy: Number(r.rows?.[0]?.msgsHoy ?? 0) }]);

  // Health check
  let healthStatus = "?";
  try {
    const resp = await fetch("http://localhost:3000/health");
    const health = await resp.json() as any;
    healthStatus = health.status === "ok" ? "🟢 OK" : "🔴 Error";
  } catch { healthStatus = "⚠️ No response"; }

  const body =
    `📈 *Estado del Servidor*\n\n` +
    `${healthStatus} Status: *${botState.status}*\n` +
    `⏱️ Uptime: *${uptimeStr}*\n` +
    `💾 RAM: *${Math.round(mem.rss / 1024 / 1024)}MB* / 1500MB (${Math.round(mem.rss / 1024 / 1024 / 15)}%)\n` +
    `🗄️ Heap: ${Math.round(mem.heapUsed / 1024 / 1024)}MB / ${Math.round(mem.heapTotal / 1024 / 1024)}MB\n` +
    `📊 DB: *${dbSize}* | ${totalDonantes} donantes\n` +
    `📩 Mensajes hoy: *${msgsHoy}*\n` +
    `📋 Whitelist: ${getWhitelistLimit() === 0 ? "Full" : getWhitelistLimit() + " donantes"}\n\n` +
    `Versión: 0.2.0`;

  return {
    reply: "",
    nextStep: 99,
    interactive: {
      type: "buttons",
      body,
      buttons: [
        { id: "1", title: "Volver al menú" },
        { id: "2", title: "Finalizar" },
      ],
    },
  };
}

// ── Control del Bot (menú de comandos) ──
function handleControlBotMenu(): FlowResponse {
  return {
    reply: "",
    nextStep: 110,
    interactive: {
      type: "list",
      body: "🤖 *Control del Bot*\n\n¿Qué acción querés ejecutar?",
      buttonText: "Ver acciones",
      sections: [{
        title: "Acciones",
        rows: [
          { id: "pausar", title: "⏸️ Pausar bot", description: "Responde 'en mantenimiento'" },
          { id: "reanudar", title: "▶️ Reanudar bot", description: "Volver a atender mensajes" },
          { id: "limpiar_audios", title: "🧹 Limpiar audios viejos", description: "Marcar > 3 días como atendidos" },
          { id: "limpiar_reclamos", title: "🧹 Limpiar reclamos", description: "Eliminar resueltos > 7 días" },
          { id: "limpiar_escalaciones", title: "🧹 Limpiar escalaciones", description: "Resolver activas > 48h" },
          { id: "whitelist", title: "📋 Whitelist", description: "Ajustar límite progresivo" },
          { id: "volver", title: "↩️ Volver al menú", description: "Regresar" },
        ],
      }],
    },
  };
}

// ── Hub de Control del Bot (handler de acciones) ──
async function handleControlBotHub(respuesta: string, state: ConversationState): Promise<FlowResponse> {
  const cmd = respuesta.toLowerCase().trim();

  if (cmd === "volver" || cmd === "0" || cmd === "menu" || cmd === "menú" || cmd === "↩️ volver al menú" || cmd === "volver al menú" || cmd === "volver al menu") {
    return handleBienvenida();
  }

  // Pausar bot
  if (cmd === "pausar" || cmd === "⏸️ pausar bot" || cmd === "pausar bot") {
    pauseBot("admin_whatsapp", "Pausado desde panel admin");
    return {
      reply: "",
      nextStep: 110,
      interactive: {
        type: "buttons",
        body: "⏸️ *Bot PAUSADO*\n\nEl bot responde \"en mantenimiento\" a todos.\nLos admins siguen pudiendo usar el panel.",
        buttons: [
          { id: "volver_control", title: "↩️ Más acciones" },
          { id: "volver_menu", title: "Volver al menú" },
        ],
      },
    };
  }

  // Reanudar bot
  if (cmd === "reanudar" || cmd === "▶️ reanudar bot" || cmd === "reanudar bot") {
    resumeBot("admin_whatsapp");
    return {
      reply: "",
      nextStep: 110,
      interactive: {
        type: "buttons",
        body: "▶️ *Bot REANUDADO*\n\nAtendiendo mensajes normalmente.",
        buttons: [
          { id: "volver_control", title: "↩️ Más acciones" },
          { id: "volver_menu", title: "Volver al menú" },
        ],
      },
    };
  }

  // Limpiar audios viejos (> 3 días)
  if (cmd === "limpiar_audios" || cmd === "🧹 limpiar audios viejos" || cmd === "limpiar audios viejos" || cmd === "limpiar audios") {
    const result = await db
      .update(audioMensajes)
      .set({ atendido: true, atendidoPor: "auto-cleanup", updatedAt: new Date() })
      .where(and(
        eq(audioMensajes.atendido, false),
        sql`${audioMensajes.createdAt} < NOW() - INTERVAL '3 days'`,
      ));
    const updated = (result as any).rowCount ?? 0;
    return {
      reply: "",
      nextStep: 110,
      interactive: {
        type: "buttons",
        body: `🧹 *Audios limpiados*\n\n${updated} audios > 3 días marcados como atendidos.`,
        buttons: [
          { id: "volver_control", title: "↩️ Más acciones" },
          { id: "volver_menu", title: "Volver al menú" },
        ],
      },
    };
  }

  // Limpiar reclamos resueltos (> 7 días)
  if (cmd === "limpiar_reclamos" || cmd === "🧹 limpiar reclamos" || cmd === "limpiar reclamos") {
    const result = await db.execute(sql`
      DELETE FROM reclamos WHERE estado = 'resuelto' AND fecha_creacion < NOW() - INTERVAL '7 days'
    `);
    const deleted = (result as any).rowCount ?? 0;
    return {
      reply: "",
      nextStep: 110,
      interactive: {
        type: "buttons",
        body: `🧹 *Reclamos limpiados*\n\n${deleted} reclamos resueltos > 7 días eliminados.`,
        buttons: [
          { id: "volver_control", title: "↩️ Más acciones" },
          { id: "volver_menu", title: "Volver al menú" },
        ],
      },
    };
  }

  // Limpiar escalaciones viejas (> 48h)
  if (cmd === "limpiar_escalaciones" || cmd === "🧹 limpiar escalaciones" || cmd === "limpiar escalaciones") {
    const result = await db.execute(sql`
      UPDATE human_escalations SET estado = 'resuelta', resolved_at = NOW(), resolved_by = 'auto-cleanup'
      WHERE estado = 'activa' AND created_at < NOW() - INTERVAL '48 hours'
    `);
    const resolved = (result as any).rowCount ?? 0;
    return {
      reply: "",
      nextStep: 110,
      interactive: {
        type: "buttons",
        body: `🧹 *Escalaciones limpiadas*\n\n${resolved} escalaciones > 48h resueltas automáticamente.`,
        buttons: [
          { id: "volver_control", title: "↩️ Más acciones" },
          { id: "volver_menu", title: "Volver al menú" },
        ],
      },
    };
  }

  // Whitelist
  if (cmd === "whitelist" || cmd === "📋 whitelist") {
    return handleBotWhitelist();
  }

  // Botones de retorno
  if (cmd === "volver_control" || cmd === "↩️ más acciones" || cmd === "más acciones") {
    return handleControlBotMenu();
  }
  if (cmd === "volver_menu") {
    return handleBienvenida();
  }

  return handleControlBotMenu();
}

// ── Bot Whitelist ──
function handleBotWhitelist(): FlowResponse {
  const current = getWhitelistLimit();
  const body =
    `📋 *Whitelist Progresiva*\n\n` +
    `Actual: ${current === 0 ? "Full (todos)" : current + " donantes"}\n\n` +
    `Plan:\n` +
    ROLLOUT_PLAN.map((p) => `  Día ${p.day}: ${p.limit === 0 ? "Full" : p.limit}`).join("\n") +
    `\n\nEscribí un número para cambiar el límite, o "full" para habilitar todos (*0* para volver al menú):`;

  return { reply: body, nextStep: 90, data: { botControlAction: "whitelist" } };
}

// ── Bot Control Menu (handler genérico para whitelist input) ──
async function handleBotControlMenu(respuesta: string, state: ConversationState): Promise<FlowResponse> {
  const action = state.data?.botControlAction;
  const cmd = respuesta.toLowerCase().trim();

  if (cmd === "0" || cmd === "menu" || cmd === "menú") return handleBienvenida();
  if (cmd === "salir" || cmd === "finalizar") return { reply: "✅ Sesión finalizada.", endFlow: true };

  if (action === "whitelist") {
    let limit = parseInt(respuesta);
    if (cmd === "full" || limit === -1) limit = 0;
    
    if (isNaN(limit) || limit < 0) {
      return { reply: "Número inválido. Escribí un número, o 'full' para todos (*0* = volver):", nextStep: 90, data: state.data };
    }
    await setWhitelistLimit(limit);
    return {
      reply: "",
      nextStep: 99,
      interactive: {
        type: "buttons",
        body: `✅ Whitelist actualizada a ${limit === 0 ? "Full" : limit + " donantes"}.`,
        buttons: [
          { id: "1", title: "Volver al menú" },
          { id: "2", title: "Finalizar" },
        ],
      },
    };
  }

  return handleBienvenida();
}

// ── Entrenar IA (menú inicial) ──
function handleEntrenarIA(): FlowResponse {
  return {
    reply: "",
    nextStep: 91,
    interactive: {
      type: "list",
      body: "🧠 *Entrenamiento de IA*\n\n¿Qué querés hacer?",
      buttonText: "Ver opciones",
      sections: [{
        title: "Opciones",
        rows: [
          { id: "1", title: "Agregar ejemplo", description: "Enseñarle al bot una nueva clasificación" },
          { id: "2", title: "Ver ejemplos", description: "Listar, activar o desactivar" },
          { id: "3", title: "Volver al menú" },
        ],
      }],
    },
  };
}

// ── Agregar ejemplo IA (wizard) ──
async function handleAgregarEjemploIA(respuesta: string, state: ConversationState): Promise<FlowResponse> {
  const step = state.data?.iaTrainingStep ?? "mensaje";
  const cmd = respuesta.toLowerCase().trim();

  // Navegación: volver al menú de Gestionar IA (no al menú principal)
  if (cmd === "0" || cmd === "cancelar" || cmd === "volver" || cmd === "menu" || cmd === "menú"
    || cmd === "volver al menú" || cmd === "volver al menu" || cmd === "regresar" || cmd === "salir"
    || cmd === "3" || cmd === "finalizar") return handleGestionarIAMenu();

  // "Agregar otro" desde botones post-guardado (step 99 redirige acá con "1")
  if (cmd === "1" || cmd === "agregar otro") {
    return {
      reply: "📝 *Nuevo ejemplo*\n\nEscribí el mensaje del usuario que querés enseñarle al bot:\n\n(ej: \"no pasaron el martes\")\n\n*0* para volver.",
      nextStep: 91,
      data: { iaTrainingStep: "intencion" },
    };
  }

  if (step === "mensaje") {
    return {
      reply: "📝 *Paso 1/3*\n\nEscribí el mensaje del usuario que querés enseñarle al bot:\n\n(ej: \"no pasaron el martes\")\n\n*0* para volver.",
      nextStep: 91,
      data: { ...state.data, iaTrainingStep: "intencion", iaMensaje: respuesta },
    };
  }

  if (step === "intencion") {
    const mensaje = state.data?.iaMensaje || respuesta;
    return {
      reply: "",
      nextStep: 91,
      data: { ...state.data, iaTrainingStep: "respuesta", iaMensaje: mensaje, iaIntencion: respuesta },
      interactive: {
        type: "list",
        body: `📝 *Paso 2/3*\n\nMensaje: "${mensaje.slice(0, 60)}"\n\n¿Qué intención tiene?`,
        buttonText: "Elegir intención",
        sections: [{
          title: "Intenciones",
          rows: [
            { id: "reclamo", title: "Reclamo" },
            { id: "aviso", title: "Aviso" },
            { id: "consulta", title: "Consulta" },
            { id: "baja", title: "Baja" },
            { id: "hablar_persona", title: "Hablar persona" },
            { id: "saludo", title: "Saludo" },
            { id: "agradecimiento", title: "Agradecimiento" },
            { id: "confirmar_difusion", title: "Confirmar difusión" },
          ],
        }],
      },
    };
  }

  if (step === "respuesta") {
    const mensaje = state.data?.iaMensaje;
    const intencion = state.data?.iaIntencion || respuesta;

    return {
      reply: `📝 *Paso 3/3 (opcional)*\n\nMensaje: "${(mensaje || "").slice(0, 60)}"\nIntención: ${intencion}\n\nEscribí cómo debería responder el bot (o *saltear* para solo entrenar clasificación):`,
      nextStep: 91,
      data: { ...state.data, iaTrainingStep: "confirmar", iaIntencion: intencion, iaRespuesta: respuesta },
    };
  }

  if (step === "confirmar") {
    const mensaje = state.data?.iaMensaje;
    const intencion = state.data?.iaIntencion;
    let respuestaEsperada = state.data?.iaRespuesta;
    if (respuestaEsperada === "saltear" || respuestaEsperada === "skip") respuestaEsperada = undefined;

    if (!mensaje || !intencion) return handleGestionarIAMenu();

    try {
      const id = await addTrainingExample({
        mensajeUsuario: mensaje,
        intencionCorrecta: intencion,
        respuestaEsperada: respuestaEsperada,
        contexto: "Agregado desde panel admin WhatsApp",
        creadoPor: state.phone,
        prioridad: 5,
      });

      return {
        reply: "",
        nextStep: 91,
        data: { iaTrainingStep: "agregar_otro" },
        interactive: {
          type: "buttons",
          body: `✅ *Ejemplo #${id} guardado*\n\nMensaje: "${(mensaje || "").slice(0, 50)}"\nIntención: ${intencion}\n\nEl bot usará este ejemplo para mejorar.`,
          buttons: [
            { id: "1", title: "Agregar otro" },
            { id: "0", title: "↩️ Gestionar IA" },
          ],
        },
      };
    } catch (err) {
      logger.error({ err }, "Error guardando ejemplo de entrenamiento");
      return { reply: "❌ Error al guardar. Intentá de nuevo.", nextStep: 91 };
    }
  }

  // step "agregar_otro" — handler para botones post-guardado
  if (step === "agregar_otro") {
    if (cmd === "1" || cmd === "agregar otro") {
      return {
        reply: "📝 *Nuevo ejemplo*\n\nEscribí el mensaje del usuario:\n\n*0* para volver.",
        nextStep: 91,
        data: { iaTrainingStep: "intencion" },
      };
    }
    return handleGestionarIAMenu();
  }

  return handleGestionarIAMenu();
}

// ── Ver ejemplos IA ──
async function handleVerEjemplosIA(respuesta: string, state: ConversationState): Promise<FlowResponse> {
  const cmd = respuesta.toLowerCase().trim();

  if (cmd === "0" || cmd === "volver" || cmd === "menu" || cmd === "menú" || cmd === "volver al menú"
    || cmd === "volver al menu" || cmd === "↩️ volver") return handleGestionarIAMenu();
  if (cmd === "1" || cmd === "volver al menú") return handleGestionarIAMenu();
  if (cmd === "2" || cmd === "finalizar" || cmd === "salir") return { reply: "✅ Sesión finalizada.", endFlow: true };

  // Paginación
  if (cmd === "s" || cmd === "a") {
    const pag = state.data?.paginaEjemplos ?? 0;
    const totalEj = state.data?.totalEjemplos ?? 0;
    const totalPag = Math.ceil(totalEj / 10);
    let nuevaPag = pag;
    if (cmd === "s" && pag + 1 < totalPag) nuevaPag = pag + 1;
    if (cmd === "a" && pag > 0) nuevaPag = pag - 1;
    state.data = { ...state.data, paginaEjemplos: nuevaPag };
  } else {
    // Si escribió un número, mostrar detalle y acciones
    const idx = parseInt(respuesta);
    if (!isNaN(idx) && idx > 0) {
      let ids: number[] = state.data?.iaEjemplosIds || [];
      if (ids.length === 0) {
        const { examples } = await listTrainingExamples({ limit: 1000 });
        ids = examples.map(e => e.id);
      }
      if (idx <= ids.length) {
        // Buscar detalle del ejemplo
        const { examples } = await listTrainingExamples({ limit: 1000 });
        const ejemplo = examples.find(e => e.id === ids[idx - 1]);
        const detalle = ejemplo
          ? `📝 *Ejemplo #${idx}*\n\n` +
            `💬 Mensaje: "${ejemplo.mensajeUsuario.slice(0, 120)}"\n\n` +
            `🎯 Intención: *${ejemplo.intencionCorrecta}*\n` +
            `📊 Estado: ${ejemplo.activo ? "✅ Activo" : "⏸️ Inactivo"}\n` +
            (ejemplo.respuestaEsperada
              ? `\n🤖 Respuesta IA: "${ejemplo.respuestaEsperada.slice(0, 200)}"\n`
              : "\n🤖 Respuesta: (solo clasificación, sin respuesta fija)\n") +
            `\n¿Qué querés hacer?`
          : `Ejemplo #${idx}\n\n¿Qué querés hacer?`;

        return {
          reply: "",
          nextStep: 93,
          data: { ...state.data, iaEjemploSeleccionado: idx, iaEjemplosIds: ids },
          interactive: {
            type: "buttons",
            body: detalle,
            buttons: [
              { id: ejemplo?.activo ? "desactivar" : "activar", title: ejemplo?.activo ? "⏸️ Desactivar" : "✅ Activar" },
              { id: "eliminar", title: "🗑️ Eliminar" },
              { id: "volver", title: "↩️ Volver" },
            ],
          },
        };
      }
    }
  }

  const pagina = state.data?.paginaEjemplos ?? 0;
  const offset = pagina * 10;
  
  const { examples: allExamples, total } = await listTrainingExamples({ limit: 1000 });
  const ids = allExamples.map(e => e.id);
  const pageExamples = allExamples.slice(offset, offset + 10);

  if (allExamples.length === 0) {
    return {
      reply: "",
      nextStep: 99,
      interactive: {
        type: "buttons",
        body: "🧠 No hay ejemplos de entrenamiento cargados.",
        buttons: [
          { id: "1", title: "Agregar ejemplo" },
          { id: "2", title: "Volver al menú" },
        ],
      },
    };
  }

  const totalPaginas = Math.ceil(total / 10);
  let body = `🧠 *Ejemplos de entrenamiento* (${total} total) — Pág. ${pagina + 1}/${totalPaginas}\n\n`;
  for (const [i, ex] of pageExamples.entries()) {
    const estado = ex.activo ? "✅" : "⏸️";
    body += `*${offset + i + 1}.* ${estado} [${ex.intencionCorrecta}] "${ex.mensajeUsuario.slice(0, 35)}"\n`;
  }
  
  body += "\n─────────────\n";
  body += "Número = detalle";
  if (pagina > 0) body += " | *A* = ant.";
  if (pagina + 1 < totalPaginas) body += " | *S* = sig.";
  body += "\n*0* para volver";

  return {
    reply: body,
    nextStep: 92,
    data: { ...state.data, iaEjemplosIds: ids, paginaEjemplos: pagina, totalEjemplos: total },
  };
}

// ── Acción sobre ejemplo IA ──
async function handleAccionEjemploIA(respuesta: string, state: ConversationState): Promise<FlowResponse> {
  const cmd = respuesta.toLowerCase().trim();
  const idx: number | undefined = state.data?.iaEjemploSeleccionado;
  const ids: number[] = state.data?.iaEjemplosIds || [];

  if (cmd === "volver" || cmd === "↩️ volver" || cmd === "menu" || cmd === "menú" || cmd === "volver al menú" || cmd === "volver al menu" || cmd === "regresar" || cmd === "cancelar" || cmd === "0") return handleVerEjemplosIA("ver", state);
  if (!idx || idx < 1 || idx > ids.length) return handleVerEjemplosIA("ver", state);

  const exampleId = ids[idx - 1];

  try {
    if (cmd === "activar") {
      await toggleTrainingExample(exampleId, true);
      return { reply: `✅ Ejemplo #${idx} activado.`, nextStep: 92 };
    }
    if (cmd === "desactivar") {
      await toggleTrainingExample(exampleId, false);
      return { reply: `⏸️ Ejemplo #${idx} desactivado.`, nextStep: 92 };
    }
    if (cmd === "eliminar") {
      await deleteTrainingExample(exampleId);
      return { reply: `🗑️ Ejemplo #${idx} eliminado.`, nextStep: 92 };
    }
  } catch (err) {
    logger.error({ err, exampleId }, "Error en acción de ejemplo IA");
    return { reply: "❌ Error. Intentá de nuevo.", nextStep: 92 };
  }

  return handleVerEjemplosIA("ver", state);
}

// ── Capacidad del bot — plan de re-launch progresivo ─────
// Niveles del plan post-incidente. Cada uno se aplica desde el menú
// admin con un tap. Se sube cuando los logs de WhatsApp están limpios.
const PLAN_NIVELES: Array<{ id: string; cap: number; titulo: string; desc: string }> = [
  { id: "set:10",    cap: 10,    titulo: "1) Cap 10 (smoke)",     desc: "Primeras 10 donantes que escriben" },
  { id: "set:50",    cap: 50,    titulo: "2) Cap 50",             desc: "Subir si 24h sin errores" },
  { id: "set:200",   cap: 200,   titulo: "3) Cap 200",            desc: "Subir si 24h sin errores" },
  { id: "set:1000",  cap: 1000,  titulo: "4) Cap 1000",           desc: "Subir si 24h sin errores" },
  { id: "set:50000", cap: 50000, titulo: "5) 100% (sin tope)",    desc: "Padrón completo" },
];

async function handleCapacidadBot(): Promise<FlowResponse> {
  const cap = await getCapacidad();
  const porcentaje = cap.limite > 0 ? Math.round((cap.activos / cap.limite) * 100) : 0;
  const barras = "█".repeat(Math.round(porcentaje / 10)) + "░".repeat(10 - Math.round(porcentaje / 10));

  const body =
    `📊 *Capacidad del Bot*\n\n` +
    `${barras} ${porcentaje}%\n\n` +
    `👥 Activos: ${cap.activos}\n` +
    `📈 Límite actual: ${cap.limite}\n` +
    `✅ Disponibles: ${cap.disponibles}\n\n` +
    `Elegí el siguiente nivel del plan progresivo o ajustá manualmente.`;

  return {
    reply: "",
    nextStep: 95,
    interactive: {
      type: "list",
      body,
      buttonText: "Opciones",
      sections: [
        {
          title: "Plan progresivo",
          rows: PLAN_NIVELES.map((n) => ({
            id: n.id,
            title: n.titulo,
            description: n.desc,
          })),
        },
        {
          title: "Manual",
          rows: [
            { id: "manual", title: "✏️ Ajustar a otro número", description: "Escribir el límite" },
            { id: "0", title: "↩️ Volver al menú", description: "Regresar" },
          ],
        },
      ],
    },
  };
}

async function handleAjustarLimiteBot(respuesta: string): Promise<FlowResponse> {
  const trimmed = respuesta.trim();
  const cmd = trimmed.toLowerCase();

  // Volver al menú principal
  if (cmd === "0" || cmd === "volver" || cmd === "menu" || cmd === "menú" || cmd === "↩️ volver al menú" || cmd === "volver al menú" || cmd === "volver al menu" || cmd === "regresar") {
    return handleBienvenida();
  }

  // Atajo del plan progresivo: "set:N"
  if (trimmed.startsWith("set:")) {
    const n = parseInt(trimmed.slice(4), 10);
    if (Number.isFinite(n) && n >= 0 && n <= 50000) {
      await ajustarLimiteDonantes(n);
      const cap = await getCapacidad();
      const etiqueta = n >= 50000 ? "*100%* (sin tope efectivo)" : `*${n}* donantes`;
      return {
        reply:
          `✅ Plan progresivo aplicado: límite ahora ${etiqueta}.\n\n` +
          `📊 Activos: ${cap.activos} / ${cap.limite}\n` +
          `✅ Disponibles: ${cap.disponibles}\n\n` +
          `Recordá: las donantes que YA están adentro siguen adentro. Las nuevas\n` +
          `que escriban irán entrando hasta llegar al nuevo cap.\n\n` +
          `Monitoreá WhatsApp Web los próximos minutos. Si todo va bien, en 24h\n` +
          `volvé a este menú y subí al siguiente nivel.`,
        nextStep: 99,
      };
    }
  }

  // Pedido manual (botón "manual" o texto sin número)
  if (trimmed === "manual" || !/\d/.test(trimmed)) {
    return {
      reply:
        `✏️ Escribí el nuevo límite como número (ej: 75).\n\n` +
        `Rango válido: 0 a 50000.\n` +
        `Tip: 0 = nadie nuevo entra (las que están adentro siguen).`,
      nextStep: 95,
    };
  }

  // Texto con número: "ajustar 1500" o "1500"
  const match = trimmed.match(/\d+/);
  if (!match) {
    return {
      reply: `❌ No entendí el número. Escribí solo el número (ej: 75).`,
      nextStep: 95,
    };
  }
  const nuevoLimite = parseInt(match[0], 10);
  if (nuevoLimite < 0 || nuevoLimite > 50000) {
    return {
      reply: `⚠️ El límite debe estar entre 0 y 50000.`,
      nextStep: 95,
    };
  }
  await ajustarLimiteDonantes(nuevoLimite);
  const cap = await getCapacidad();
  return {
    reply:
      `✅ Límite actualizado a *${nuevoLimite}* donantes.\n\n` +
      `📊 Activos: ${cap.activos} / ${cap.limite}\n` +
      `✅ Disponibles: ${cap.disponibles}`,
    nextStep: 99,
  };
}


// ════════════════════════════════════════════════════════════
// GESTIONAR IA — Hub unificado de gestión de conversaciones IA
// ════════════════════════════════════════════════════════════

// ── Menú principal del hub IA ──
function handleGestionarIAMenu(): FlowResponse {
  return {
    reply: "",
    nextStep: 100,
    interactive: {
      type: "list",
      body: "🧠 *Gestión de IA y Conversaciones*\n\n¿Qué querés hacer?",
      buttonText: "Ver opciones",
      sections: [{
        title: "Diagnóstico",
        rows: [
          { id: "simular", title: "🔬 Simular clasificación", description: "Probar cómo clasifica la IA un mensaje" },
          { id: "escalaciones", title: "🚨 Escalaciones activas", description: "Ver y resolver donantes escaladas" },
          { id: "feedback", title: "📊 Feedback IA", description: "Fallos e interpretaciones recientes" },
        ],
      }, {
        title: "Entrenamiento",
        rows: [
          { id: "entrenar", title: "📝 Agregar ejemplo", description: "Enseñar clasificación al bot" },
          { id: "ejemplos", title: "📋 Ver ejemplos", description: "Listar, activar o desactivar" },
          { id: "reclasificar", title: "🔄 Reclasificar fallos", description: "Corregir IA y entrenar automaticamente" },
        ],
      }, {
        title: "Navegación",
        rows: [
          { id: "0", title: "↩️ Volver al menú", description: "Panel principal" },
        ],
      }],
    },
  };
}

// ── Hub IA — dispatcher ──
async function handleGestionarIA(respuesta: string, state: ConversationState): Promise<FlowResponse> {
  const cmd = respuesta.toLowerCase().trim();

  if (cmd === "0" || cmd === "volver" || cmd === "menu" || cmd === "menú" || cmd === "volver al menú" || cmd === "volver al menu") return handleBienvenida();
  if (cmd === "salir" || cmd === "finalizar") return { reply: "✅ Sesión finalizada.", endFlow: true };

  switch (cmd) {
    case "simular":
    case "simular clasificación":
    case "simular clasificacion":
    case "🔬 simular clasificación":
      return {
        reply: "🔬 *Simular clasificación IA*\n\nEscribí el mensaje que querés probar:\n\n(ej: \"no pasaron a retirar mi bidón\")\n\n*0* para volver.",
        nextStep: 101,
      };

    case "escalaciones":
    case "escalaciones activas":
    case "🚨 escalaciones activas":
      return await handleVerEscalaciones("ver", state);

    case "feedback":
    case "feedback ia":
    case "📊 feedback ia":
      return await handleRevisarFeedbackIA("ver", state);

    case "entrenar":
    case "agregar ejemplo":
    case "📝 agregar ejemplo":
      return handleEntrenarIA();

    case "ejemplos":
    case "ver ejemplos":
    case "📋 ver ejemplos":
      return await handleVerEjemplosIA("ver", state);

    case "reclasificar":
    case "reclasificar fallos":
    case "🔄 reclasificar fallos":
      return await handleReclasificarFeedback("ver", state);

    default:
      return handleGestionarIAMenu();
  }
}

// ── Simular clasificación IA ──
async function handleSimularClasificacion(respuesta: string, state: ConversationState): Promise<FlowResponse> {
  const cmd = respuesta.toLowerCase().trim();
  if (cmd === "0" || cmd === "volver" || cmd === "menu" || cmd === "↩️ volver") return handleGestionarIAMenu();

  // Botón "Probar otro" → re-prompt
  if (cmd === "otro" || cmd === "🔬 probar otro") {
    return {
      reply: "🔬 Escribí otro mensaje para probar:\n\n*0* para volver.",
      nextStep: 101,
    };
  }

  // Botón "Entrenar con este" → ir al wizard con datos pre-cargados
  if (cmd === "entrenar_este" || cmd === "📝 entrenar con este") {
    const ultimoMsg = state.data?.ultimoMensajeSimulado;
    const ultimoResult = state.data?.ultimoResultadoSimulado;
    if (ultimoMsg) {
      return {
        reply: "",
        nextStep: 91,
        data: { iaTrainingStep: "respuesta", iaMensaje: ultimoMsg },
        interactive: {
          type: "list",
          body: `📝 *Entrenar IA*\n\nMensaje: "${ultimoMsg.slice(0, 60)}"\nIA detectó: ${ultimoResult?.intent || "?"}\n\n¿Cuál es la intención CORRECTA?`,
          buttonText: "Elegir intención",
          sections: [{
            title: "Intenciones",
            rows: [
              { id: "reclamo", title: "Reclamo" },
              { id: "consulta", title: "Consulta" },
              { id: "aviso", title: "Aviso" },
              { id: "baja", title: "Baja" },
              { id: "hablar_persona", title: "Hablar persona" },
              { id: "saludo", title: "Saludo" },
              { id: "agradecimiento", title: "Agradecimiento" },
              { id: "irrelevante", title: "Irrelevante" },
              { id: "confirmar_difusion", title: "Confirmar difusión" },
            ],
          }],
        },
      };
    }
    return handleGestionarIAMenu();
  }

  // El usuario envió un mensaje a clasificar
  try {
    const result = await classifyIntent(respuesta, { timeoutMs: 10000 });

    const sentimentEmoji: Record<string, string> = {
      calm: "😊",
      frustrated: "😤",
      angry: "🤬",
    };

    const confidenceEmoji: Record<string, string> = {
      high: "🟢",
      medium: "🟡",
      low: "🔴",
    };

    const entities = result.entities.length > 0
      ? result.entities.map((e) => `  • ${e.type}: ${e.value}`).join("\n")
      : "  (ninguna)";

    const body =
      `🔬 *Resultado de clasificación*\n\n` +
      `💬 Mensaje: "${respuesta.slice(0, 80)}"\n\n` +
      `🎯 Intent: *${result.intent}*\n` +
      `${confidenceEmoji[result.confidence] || "⚪"} Confianza: *${result.confidence}*\n` +
      `${sentimentEmoji[result.sentiment] || "😐"} Sentimiento: *${result.sentiment}*\n` +
      `🙋 Necesita humano: *${result.needsHuman ? "SÍ" : "No"}*\n\n` +
      `📦 Entidades:\n${entities}\n\n` +
      `${result.confidence === "low" ? "⚠️ Baja confianza — considerá agregar un ejemplo de entrenamiento.\n\n" : ""}` +
      `Escribí otro mensaje para probar, o *0* para volver.`;

    return {
      reply: "",
      nextStep: 101,
      interactive: {
        type: "buttons",
        body,
        buttons: [
          { id: "entrenar_este", title: "📝 Entrenar con este" },
          { id: "otro", title: "🔬 Probar otro" },
          { id: "0", title: "↩️ Volver" },
        ],
      },
      data: { ...state.data, ultimoMensajeSimulado: respuesta, ultimoResultadoSimulado: result },
    };
  } catch (err) {
    logger.error({ err }, "Error simulando clasificación IA");
    return {
      reply: `❌ Error al clasificar: ${(err as Error).message}\n\nProbá de nuevo o escribí *0* para volver.`,
      nextStep: 101,
    };
  }
}

// ── Reclasificar desde feedback IA ──
async function handleReclasificarFeedback(respuesta: string, state: ConversationState): Promise<FlowResponse> {
  const cmd = respuesta.toLowerCase().trim();

  if (cmd === "0" || cmd === "volver" || cmd === "menu" || cmd === "menú") return handleGestionarIAMenu();
  if (cmd === "salir" || cmd === "finalizar") return { reply: "✅ Sesión finalizada.", endFlow: true };

  // Si el usuario seleccionó un número de la lista de feedbacks
  const reclasificarIds: Array<{ id: number; msg: string; original: string }> = state.data?.reclasificarIds || [];
  const idx = parseInt(respuesta) - 1;
  if (!isNaN(idx) && idx >= 0 && idx < reclasificarIds.length) {
    const selected = reclasificarIds[idx];
    return {
      reply: "",
      nextStep: 102,
      data: {
        ...state.data,
        reclasificarFeedbackId: selected.id,
        reclasificarMsg: selected.msg,
        reclasificarOriginal: selected.original,
      },
      interactive: {
        type: "list",
        body: `🔄 Mensaje: "${(selected.msg || "").slice(0, 60)}"\n\nLa IA clasificó como: *${selected.original}*\n\n¿Cuál es la intención CORRECTA?`,
        buttonText: "Elegir intención",
        sections: [{
          title: "Intenciones",
          rows: [
            { id: "reclamo", title: "Reclamo" },
            { id: "consulta", title: "Consulta" },
            { id: "aviso", title: "Aviso" },
            { id: "baja", title: "Baja" },
            { id: "hablar_persona", title: "Hablar persona" },
            { id: "saludo", title: "Saludo" },
            { id: "agradecimiento", title: "Agradecimiento" },
            { id: "irrelevante", title: "Irrelevante" },
            { id: "confirmar_difusion", title: "Confirmar difusión" },
          ],
        }],
      },
    };
  }

  // Si viene con un ID de feedback a corregir (ya seleccionó de la lista)
  const feedbackId = state.data?.reclasificarFeedbackId;
  const feedbackMsg = state.data?.reclasificarMsg;

  if (feedbackId && feedbackMsg) {
    // El usuario envió la intención correcta
    const VALID_INTENTS = ["reclamo", "consulta", "aviso", "baja", "hablar_persona", "saludo", "agradecimiento", "irrelevante", "confirmar_difusion", "menu_opcion"];

    if (!VALID_INTENTS.includes(cmd)) {
      return {
        reply: "",
        nextStep: 102,
        data: state.data,
        interactive: {
          type: "list",
          body: `🔄 Mensaje: "${feedbackMsg.slice(0, 60)}"\n\n¿Cuál es la intención CORRECTA?`,
          buttonText: "Elegir intención",
          sections: [{
            title: "Intenciones",
            rows: [
              { id: "reclamo", title: "Reclamo" },
              { id: "consulta", title: "Consulta" },
              { id: "aviso", title: "Aviso" },
              { id: "baja", title: "Baja" },
              { id: "hablar_persona", title: "Hablar persona" },
              { id: "saludo", title: "Saludo" },
              { id: "agradecimiento", title: "Agradecimiento" },
              { id: "irrelevante", title: "Irrelevante" },
              { id: "confirmar_difusion", title: "Confirmar difusión" },
            ],
          }],
        },
      };
    }

    // Guardar corrección + auto-crear training example
    try {
      await db.update(iaFeedback).set({
        revisado: true,
        intencionCorrecta: cmd,
      }).where(eq(iaFeedback.id, feedbackId));

      const trainingId = await addTrainingExample({
        mensajeUsuario: feedbackMsg,
        intencionCorrecta: cmd,
        contexto: `Auto-reclasificado desde admin. Original: ${state.data?.reclasificarOriginal || "?"}`,
        creadoPor: state.phone,
        prioridad: 8,
      });

      return {
        reply: "",
        nextStep: 100,
        interactive: {
          type: "buttons",
          body:
            `✅ *Reclasificación guardada*\n\n` +
            `💬 "${feedbackMsg.slice(0, 60)}"\n` +
            `❌ Antes: ${state.data?.reclasificarOriginal}\n` +
            `✅ Ahora: *${cmd}*\n\n` +
            `📝 Training example #${trainingId} creado automáticamente.\n` +
            `La IA va a usar este ejemplo en futuras clasificaciones.`,
          buttons: [
            { id: "reclasificar", title: "🔄 Reclasificar otro" },
            { id: "0", title: "↩️ Volver a IA" },
          ],
        },
      };
    } catch (err) {
      logger.error({ err }, "Error reclasificando feedback");
      return { reply: "❌ Error al guardar. Intentá de nuevo.", nextStep: 100 };
    }
  }

  // Mostrar últimos feedbacks mal clasificados para corregir
  const malClasificados = await db
    .select({
      id: iaFeedback.id,
      telefono: iaFeedback.telefono,
      mensajeOriginal: iaFeedback.mensajeOriginal,
      intencionDetectada: iaFeedback.intencionDetectada,
      createdAt: iaFeedback.createdAt,
    })
    .from(iaFeedback)
    .where(eq(iaFeedback.revisado, false))
    .orderBy(desc(iaFeedback.createdAt))
    .limit(8);

  if (malClasificados.length === 0) {
    return {
      reply: "",
      nextStep: 100,
      interactive: {
        type: "buttons",
        body: "✅ No hay mensajes pendientes de reclasificación.\n\nTodos los feedbacks fueron revisados.",
        buttons: [
          { id: "0", title: "↩️ Volver a IA" },
        ],
      },
    };
  }

  let body = `🔄 *Reclasificar mensajes* (${malClasificados.length} pendientes)\n\n`;
  for (const [i, f] of malClasificados.entries()) {
    const hora = f.createdAt
      ? new Date(f.createdAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })
      : "?";
    body += `*${i + 1}.* "${(f.mensajeOriginal || "").slice(0, 50)}"\n`;
    body += `   IA dijo: ${f.intencionDetectada || "?"} · ${hora}\n\n`;
  }
  body += "Escribí el *número* del mensaje para corregir, o *0* para volver.";

  return {
    reply: body,
    nextStep: 102,
    data: { reclasificarIds: malClasificados.map((f) => ({ id: f.id, msg: f.mensajeOriginal, original: f.intencionDetectada })) },
  };
}

// ── Ver escalaciones activas ──
async function handleVerEscalaciones(respuesta: string, state: ConversationState): Promise<FlowResponse> {
  const cmd = respuesta.toLowerCase().trim();

  if (cmd === "0" || cmd === "volver" || cmd === "menu" || cmd === "menú") return handleGestionarIAMenu();
  if (cmd === "salir" || cmd === "finalizar") return { reply: "✅ Sesión finalizada.", endFlow: true };

  // Si seleccionó un número, ir a resolver
  const idx = parseInt(respuesta) - 1;
  const ids: Array<{ phone: string; reason: string }> = state.data?.escalacionesIds || [];

  if (!isNaN(idx) && idx >= 0 && idx < ids.length) {
    const esc = ids[idx];
    // Buscar último mensaje del donante
    const lastMsgs = await db
      .select({ contenido: mensajesLog.contenido, direccion: mensajesLog.direccion, createdAt: mensajesLog.createdAt })
      .from(mensajesLog)
      .where(eq(mensajesLog.telefono, esc.phone))
      .orderBy(desc(mensajesLog.createdAt))
      .limit(6);

    let historial = "Sin historial reciente.";
    if (lastMsgs.length > 0) {
      historial = lastMsgs
        .reverse()
        .map((m) => {
          const dir = m.direccion === "entrante" ? "👤" : "🤖";
          return `${dir} ${(m.contenido || "").slice(0, 60)}`;
        })
        .join("\n");
    }

    // Buscar nombre del donante
    const [donante] = await db
      .select({ nombre: donantes.nombre, direccion: donantes.direccion, estado: donantes.estado })
      .from(donantes)
      .where(eq(donantes.telefono, esc.phone))
      .limit(1);

    const nombre = donante?.nombre || "Desconocido";
    const dir = donante?.direccion || "Sin dirección";

    return {
      reply: "",
      nextStep: 104,
      data: { ...state.data, resolverPhone: esc.phone, resolverNombre: nombre },
      interactive: {
        type: "buttons",
        body:
          `🚨 *Escalación #${idx + 1}*\n\n` +
          `👤 ${nombre}\n` +
          `📱 ${esc.phone}\n` +
          `📍 ${dir}\n` +
          `⚠️ Razón: *${esc.reason}*\n\n` +
          `📋 *Últimos mensajes:*\n${historial}\n\n` +
          `¿Qué querés hacer?`,
        buttons: [
          { id: "resolver", title: "✅ Resolver" },
          { id: "volver_lista", title: "↩️ Volver a lista" },
        ],
      },
    };
  }

  // Mostrar lista de escalaciones activas
  const escalaciones = await db
    .select({
      phone: humanEscalations.phone,
      reason: humanEscalations.reason,
      escalatedAt: humanEscalations.escalatedAt,
    })
    .from(humanEscalations)
    .where(eq(humanEscalations.estado, "activa"))
    .orderBy(desc(humanEscalations.escalatedAt))
    .limit(10);

  if (escalaciones.length === 0) {
    return {
      reply: "",
      nextStep: 100,
      interactive: {
        type: "buttons",
        body: "✅ No hay escalaciones activas.\n\nTodas las donantes están siendo atendidas por el bot.",
        buttons: [
          { id: "0", title: "↩️ Volver a IA" },
        ],
      },
    };
  }

  // Enriquecer con nombres de donantes
  const phonesStr = escalaciones.map((e) => `'${e.phone}'`).join(",");

  let body = `🚨 *Escalaciones activas* (${escalaciones.length})\n\n`;

  for (const [i, esc] of escalaciones.entries()) {
    const hora = esc.escalatedAt
      ? new Date(esc.escalatedAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })
      : "?";

    const reasonEmoji: Record<string, string> = {
      frustration: "😤",
      multiple_issues: "📋",
      ia_fail: "🤖",
      user_request: "🙋",
      system_error: "❌",
    };
    const emoji = reasonEmoji[esc.reason] || "⚠️";

    body += `*${i + 1}.* ${emoji} ${esc.phone}\n`;
    body += `   ${esc.reason} · ${hora}\n\n`;
  }

  body += "Escribí el *número* para ver detalle y resolver, o *0* para volver.";

  return {
    reply: body,
    nextStep: 103,
    data: { escalacionesIds: escalaciones.map((e) => ({ phone: e.phone, reason: e.reason })) },
  };
}

// ── Resolver escalación ──
async function handleResolverEscalacion(respuesta: string, state: ConversationState): Promise<FlowResponse> {
  const cmd = respuesta.toLowerCase().trim();

  if (cmd === "volver_lista" || cmd === "volver" || cmd === "↩️ volver a lista") {
    return await handleVerEscalaciones("ver", state);
  }
  if (cmd === "0" || cmd === "menu") return handleGestionarIAMenu();

  if (cmd === "resolver" || cmd === "✅ resolver") {
    const phone = state.data?.resolverPhone;
    const nombre = state.data?.resolverNombre || "Donante";
    if (!phone) return handleGestionarIAMenu();

    try {
      await resolveHumanEscalation(phone, state.phone);

      return {
        reply: "",
        nextStep: 100,
        interactive: {
          type: "buttons",
          body:
            `✅ *Escalación resuelta*\n\n` +
            `👤 ${nombre}\n` +
            `📱 ${phone}\n\n` +
            `El bot volverá a atender a esta donante automáticamente.\n` +
            `Si vuelve a escribir, será procesada por la IA normalmente.`,
          buttons: [
            { id: "escalaciones", title: "🚨 Ver más escalaciones" },
            { id: "0", title: "↩️ Volver a IA" },
          ],
        },
      };
    } catch (err) {
      logger.error({ err, phone }, "Error resolviendo escalación");
      return { reply: "❌ Error al resolver. Intentá de nuevo.", nextStep: 103 };
    }
  }

  return await handleVerEscalaciones("ver", state);
}
