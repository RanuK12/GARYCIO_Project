import { FlowHandler, ConversationState, FlowResponse, InteractiveMessage } from "./types";
import { db } from "../../database";
import { donantes, avisos } from "../../database/schema";
import { eq } from "drizzle-orm";
import { logger } from "../../config/logger";
import { mapTipoAvisoIaToDb } from "../../services/ia-enum-mapper";

/**
 * Flow de avisos de donantes.
 *
 * Menú:
 * 2-1  Vacaciones → ausencia por motivo personal → fecha de vuelta → notifica chofer
 * 2-2  Enfermedad → ¿cuándo volvés a donar? → notifica chofer
 * 2-3  Cambio de dirección → pedir nueva dirección
 * 2-4  Cambio de teléfono → pedir nuevo número
 *
 * Steps:
 * 0 - Menú de tipo de aviso (SIEMPRE se muestra)
 * 1 - Fecha de vuelta (vacaciones/enfermedad)
 * 2 - Pedir nueva dirección (cambio de dirección)
 * 3 - Pedir nuevo teléfono (cambio de teléfono)
 */
export const avisoFlow: FlowHandler = {
  name: "aviso",
  keyword: ["aviso", "vacaciones", "ausencia", "enfermedad", "medicacion", "medicación"],

  async handle(state: ConversationState, message: string): Promise<FlowResponse> {
    const respuesta = message.trim();

    switch (state.step) {
      case 0:
        return handleTipoAviso(respuesta);
      case 1:
        return await handleFechaVuelta(respuesta, state);
      case 2:
        return handleCambioDireccion(respuesta, state);
      case 3:
        return handleCambioTelefono(respuesta, state);
      default:
        return { reply: "¡Registrado! Te deseamos lo mejor.", endFlow: true };
    }
  },
};

const MENU_AVISO =
  "¿Por qué motivo nos querés avisar?\n\n" +
  "*1* - Me voy de vacaciones 🏖️\n" +
  "*2* - Aviso por enfermedad 🤒\n" +
  "*3* - Cambio de dirección 📍\n" +
  "*4* - Cambio de teléfono 📱\n" +
  "*0* - Volver al menú principal\n\n" +
  "Respondé con el número correspondiente.";

const MENU_AVISO_INTERACTIVE: InteractiveMessage = {
  type: "list",
  body: "¿Por qué motivo nos querés avisar?",
  buttonText: "Ver motivos",
  sections: [{
    rows: [
      { id: "1", title: "Me voy de vacaciones", description: "Ausencia por motivo personal" },
      { id: "2", title: "Aviso por enfermedad", description: "No puedo donar por salud" },
      { id: "3", title: "Cambio de dirección", description: "Nueva direccion de recoleccion" },
      { id: "4", title: "Cambio de teléfono", description: "Actualizar numero de contacto" },
    ],
  }],
};

// ── Paso 0: Elegir motivo ────────────────────────────────
function handleTipoAviso(respuesta: string): FlowResponse {
  // Primer acceso (mensaje vacío desde iniciarFlow) → mostrar lista interactiva
  if (respuesta === "") {
    return {
      reply: "",
      interactive: MENU_AVISO_INTERACTIVE,
      nextStep: 0,
    };
  }

  const lower = respuesta.toLowerCase();

  // Opción 0: Volver al menú principal
  if (lower === "0" || lower.includes("volver") || lower.includes("menu principal")) {
    return { reply: "", endFlow: true };
  }

  // Mapeo de número o título de botón → tipo
  let tipo: string | null = null;
  if (lower === "1" || lower.includes("vacaciones") || lower.includes("me voy")) tipo = "vacaciones";
  else if (lower === "2" || lower.includes("enfermedad") || lower.includes("salud")) tipo = "enfermedad";
  else if (lower === "3" || lower.includes("direccion") || lower.includes("dirección")) tipo = "cambio_direccion";
  else if (lower === "4" || lower.includes("telefono") || lower.includes("teléfono") || lower.includes("numero")) tipo = "cambio_telefono";

  if (!tipo) {
    return {
      reply: "",
      interactive: MENU_AVISO_INTERACTIVE,
      nextStep: 0,
    };
  }

  // Vacaciones → pedir fecha
  if (tipo === "vacaciones") {
    return {
      reply:
        "Registramos tu aviso por: *ausencia por motivo personal* 🏖️\n\n" +
        "¿Cuándo calculás que volvés?\n\n" +
        "Podés escribir:\n" +
        "• Una fecha: *15/04*, *el lunes*, *en 2 semanas*\n" +
        "• Cantidad de días: *3 días*, *una semana*\n" +
        "• Si no sabés: *no sé*",
      nextStep: 1,
      data: { tipoAviso: tipo },
    };
  }

  // Enfermedad → preguntar cuándo vuelve
  if (tipo === "enfermedad") {
    return {
      reply:
        "Lamentamos que no te sientas bien. 🤒\n\n" +
        "¿Cuándo querés que te volvamos a visitar?\n\n" +
        "Podés escribir:\n" +
        "• Una fecha: *15/04*, *el lunes*\n" +
        "• Cantidad de días: *3 días*, *una semana*\n" +
        "• Si no sabés: *no sé*",
      nextStep: 1,
      data: { tipoAviso: tipo },
    };
  }

  // Cambio de dirección
  if (tipo === "cambio_direccion") {
    return {
      reply:
        "📍 *Cambio de dirección*\n\n" +
        "Escribí tu *nueva dirección completa* (calle, número, entre calles, barrio):",
      nextStep: 2,
      data: { tipoAviso: tipo },
    };
  }

  // Cambio de teléfono
  return {
    reply:
      "📱 *Cambio de teléfono*\n\n" +
      "Escribí tu *nuevo número de teléfono*:",
    nextStep: 3,
    data: { tipoAviso: tipo },
  };
}

// ── Paso 1: Fecha de vuelta (vacaciones / enfermedad) ─────────────────
async function handleFechaVuelta(respuesta: string, state: ConversationState): Promise<FlowResponse> {
  const lower = respuesta.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const noSabe = ["no s", "no se", "ni idea", "no tengo", "no sabe"].some((n) => lower.includes(n));
  const fechaParseada = noSabe ? null : parsearFecha(lower, respuesta);

  const mensajeVuelta = fechaParseada
    ? `Te esperamos de vuelta el *${fechaParseada}*. Ese día le vamos a avisar a tu recolector para que retome el paso.`
    : "Cuando sepas cuándo vas a estar disponible, avisanos por acá y lo coordinamos con el recolector.";

  const tipo = state.data.tipoAviso || "general";

  // Guardar aviso en DB
  await guardarAvisoEnDB(state.phone, tipo, fechaParseada);

  return {
    reply:
      `¡Listo! Tu aviso quedó registrado. 📝\n\n` +
      `${mensajeVuelta}\n\n` +
      getTipoPorMotivo(tipo),
    endFlow: true,
    data: { fechaVuelta: fechaParseada },
    notify: {
      target: "chofer",
      message: formatNotificacionChofer(state, fechaParseada),
    },
  };
}

// ── Paso 2: Cambio de dirección ─────────────────
function handleCambioDireccion(respuesta: string, state: ConversationState): FlowResponse {
  if (respuesta.length < 5) {
    return {
      reply: "Necesitamos una dirección más completa. Por favor escribila con calle y número:",
      nextStep: 2,
    };
  }

  return {
    reply:
      `✅ *Dirección actualizada*\n\n` +
      `📍 Nueva dirección: *${respuesta}*\n\n` +
      "Le vamos a avisar al recolector de tu zona sobre el cambio. ¡Gracias!",
    endFlow: true,
    data: { nuevaDireccion: respuesta },
    notify: {
      target: "admin",
      message:
        `📍 *Cambio de dirección*\n\n` +
        `📱 Donante: ${state.phone}\n` +
        `📍 Nueva dirección: ${respuesta}\n\n` +
        `Actualizar en el sistema y avisar al chofer.`,
    },
  };
}

// ── Paso 3: Cambio de teléfono ─────────────────
function handleCambioTelefono(respuesta: string, state: ConversationState): FlowResponse {
  const cleaned = respuesta.replace(/[\s\-().]/g, "");
  if (cleaned.length < 8 || !/\d{8,}/.test(cleaned)) {
    return {
      reply: "No parece un número de teléfono válido. Ingresá un número con al menos 8 dígitos:",
      nextStep: 3,
    };
  }

  return {
    reply:
      `✅ *Teléfono actualizado*\n\n` +
      `📱 Nuevo teléfono: *${respuesta}*\n\n` +
      "Lo actualizamos en el sistema. ¡Gracias!",
    endFlow: true,
    data: { nuevoTelefono: respuesta },
    notify: {
      target: "admin",
      message:
        `📱 *Cambio de teléfono*\n\n` +
        `📱 Donante actual: ${state.phone}\n` +
        `📱 Nuevo teléfono: ${respuesta}\n\n` +
        `Actualizar en el sistema.`,
    },
  };
}

function getTipoPorMotivo(tipo: string): string {
  switch (tipo) {
    case "enfermedad":
      return "¡Que te mejores pronto! 💪";
    case "vacaciones":
      return "¡Que disfrutes! 🌞";
    default:
      return "Ante cualquier duda, escribinos por acá. ¡Hasta pronto!";
  }
}

function formatNotificacionChofer(state: ConversationState, fechaVuelta: string | null): string {
  const tipo = state.data.tipoAviso || "general";
  const labels: Record<string, string> = {
    vacaciones: "Ausencia por motivo personal",
    enfermedad: "Enfermedad",
  };

  return (
    `📢 *Aviso de donante*\n\n` +
    `Donante: ${state.phone}\n` +
    `Motivo: ${labels[tipo] || tipo}\n` +
    `Vuelta estimada: ${fechaVuelta || "Sin fecha definida"}\n\n` +
    `⚠️ No pasar a recolectar hasta nuevo aviso.`
  );
}

// ── Parser de fechas completo ────────────────────────────
function parsearFecha(lower: string, original: string): string | null {
  // Formato DD/MM o DD/MM/YYYY o DD-MM
  const regexFecha = /(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/;
  const matchFecha = original.match(regexFecha);
  if (matchFecha) {
    const dia = matchFecha[1].padStart(2, "0");
    const mes = matchFecha[2].padStart(2, "0");
    const anio = matchFecha[3]
      ? matchFecha[3].length === 2
        ? `20${matchFecha[3]}`
        : matchFecha[3]
      : new Date().getFullYear().toString();
    return `${dia}/${mes}/${anio}`;
  }

  // "N días" o "N dia"
  const regexDias = /(\d+)\s*d[ií]a/i;
  const matchDias = lower.match(regexDias);
  if (matchDias) {
    const dias = parseInt(matchDias[1], 10);
    const fecha = new Date();
    fecha.setDate(fecha.getDate() + dias);
    return fecha.toLocaleDateString("es-AR");
  }

  // "una semana", "1 semana", "2 semanas"
  const regexSemanas = /(\d+|una?|dos|tres|cuatro)\s*semana/i;
  const matchSemanas = lower.match(regexSemanas);
  if (matchSemanas) {
    const num = parsearNumeroEspanol(matchSemanas[1]);
    const fecha = new Date();
    fecha.setDate(fecha.getDate() + num * 7);
    return fecha.toLocaleDateString("es-AR");
  }

  // "una quincena" / "quince días"
  if (lower.includes("quincena") || /quince\s*d[ií]a/.test(lower)) {
    const fecha = new Date();
    fecha.setDate(fecha.getDate() + 15);
    return fecha.toLocaleDateString("es-AR");
  }

  // "un mes" / "1 mes"
  const regexMes = /(\d+|un?o?a?)\s*mes/i;
  const matchMes = lower.match(regexMes);
  if (matchMes) {
    const num = parsearNumeroEspanol(matchMes[1]);
    const fecha = new Date();
    fecha.setMonth(fecha.getMonth() + num);
    return fecha.toLocaleDateString("es-AR");
  }

  // Día de la semana: "el lunes", "el viernes"
  const diasSemana: Record<string, number> = {
    lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 0,
  };
  for (const [nombre, num] of Object.entries(diasSemana)) {
    if (lower.includes(nombre)) {
      const hoy = new Date();
      const hoyDia = hoy.getDay();
      let diff = num - hoyDia;
      if (diff <= 0) diff += 7;
      hoy.setDate(hoy.getDate() + diff);
      return hoy.toLocaleDateString("es-AR");
    }
  }

  return null;
}

// ── Guardar aviso en DB ──────────────────────────────
async function guardarAvisoEnDB(phone: string, tipo: string, fechaVuelta: string | null): Promise<void> {
  try {
    const tipoEnum = mapTipoAvisoIaToDb(tipo);
    if (!tipoEnum) return; // cambio_direccion y cambio_telefono no son avisos de ausencia

    const donanteRow = await db
      .select({ id: donantes.id })
      .from(donantes)
      .where(eq(donantes.telefono, phone))
      .limit(1);

    // Intentar sin +
    let donanteId: number | null = donanteRow[0]?.id ?? null;
    if (!donanteId) {
      const phoneSinPlus = phone.startsWith("+") ? phone.slice(1) : phone;
      const retry = await db
        .select({ id: donantes.id })
        .from(donantes)
        .where(eq(donantes.telefono, phoneSinPlus))
        .limit(1);
      donanteId = retry[0]?.id ?? null;
    }

    if (!donanteId) {
      logger.warn({ phone }, "No se encontró donante para guardar aviso");
      return;
    }

    const hoy = new Date().toISOString().split("T")[0];

    // Parsear fechaVuelta a formato ISO si viene como DD/MM/YYYY
    let fechaFinISO: string | null = null;
    if (fechaVuelta) {
      const parts = fechaVuelta.split("/");
      if (parts.length === 3) {
        fechaFinISO = `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
    }

    await db.insert(avisos).values({
      donanteId,
      tipo: tipoEnum,
      fechaInicio: hoy,
      fechaFin: fechaFinISO,
      notas: fechaVuelta ? `Vuelve: ${fechaVuelta}` : "Sin fecha de vuelta definida",
    });

    logger.info({ phone, tipo: tipoEnum, fechaVuelta }, "Aviso guardado en DB");
  } catch (err) {
    logger.error({ phone, err }, "Error guardando aviso en DB");
  }
}

function parsearNumeroEspanol(texto: string): number {
  const mapa: Record<string, number> = {
    un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  };
  const n = parseInt(texto, 10);
  if (!isNaN(n)) return n;
  return mapa[texto.toLowerCase()] || 1;
}
