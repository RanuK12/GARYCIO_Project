import { FlowHandler, ConversationState, FlowResponse } from "./types";

/**
 * Flow para visitadoras.
 * Por ahora solo tienen una opción: cargar nueva donante.
 *
 * Steps:
 * 0  - Identificación
 * 1  - Menú principal
 * 10 - Nueva donante: nombre y apellido
 * 11 - Nueva donante: dirección
 * 12 - Nueva donante: teléfono
 * 13 - Nueva donante: fecha de nacimiento
 * 14 - Nueva donante: confirmar
 * 99 - Volver o finalizar
 */
export const visitadoraFlow: FlowHandler = {
  name: "visitadora",
  keyword: ["visitadora", "visita"],

  async handle(state: ConversationState, message: string): Promise<FlowResponse> {
    const respuesta = message.trim();

    switch (state.step) {
      case 0: return handleIdentificacion(respuesta);
      case 1: return handleMenu(respuesta);
      case 10: return handleNuevaDonNombre(respuesta);
      case 11: return handleNuevaDonDireccion(respuesta, state);
      case 12: return handleNuevaDonTelefono(respuesta, state);
      case 13: return handleNuevaDonFechaNacimiento(respuesta, state);
      case 14: return handleNuevaDonConfirmar(respuesta, state);
      case 99: return handleVolverOFinalizar(respuesta);
      default:
        return { reply: "Sesión finalizada. Escribí *visitadora* para volver al menú.", endFlow: true };
    }
  },
};

// ── Identificación ──────────────────────────────────
function handleIdentificacion(respuesta: string): FlowResponse {
  if (respuesta.length < 2) {
    return {
      reply:
        "👩‍⚕️ *Registro de Visitadora*\n\n" +
        "Ingresá tu *nombre* para identificarte:",
      nextStep: 0,
    };
  }

  return {
    reply:
      `✅ Identificada como *${respuesta}*\n\n` +
      "¿Qué querés hacer?\n\n" +
      MENU_VISITADORA + "\n\n" +
      "Elegí una opción:",
    nextStep: 1,
    data: { nombreVisitadora: respuesta },
  };
}

// ── Menú ──────────────────────────────────
const MENU_VISITADORA =
  "*1* - Cargar nueva donante\n" +
  "*0* - Salir";

function handleMenu(respuesta: string): FlowResponse {
  if (respuesta === "0") {
    return {
      reply: "Sesión de visitadora finalizada. Escribí cualquier cosa para volver al menú principal.",
      endFlow: true,
    };
  }

  if (respuesta === "1") {
    return {
      reply:
        "📋 *Cargar nueva donante*\n\n" +
        "Ingresá el *nombre y apellido* de la nueva donante:\n\n" +
        "*0* - Volver",
      nextStep: 10,
    };
  }

  return {
    reply: "Opción no válida. Elegí *1* o *0*:",
    nextStep: 1,
  };
}

// ── Nueva donante ──────────────────────────────────
function handleNuevaDonNombre(respuesta: string): FlowResponse {
  if (respuesta === "0") {
    return { reply: "¿Qué querés hacer?\n\n" + MENU_VISITADORA + "\n\nElegí una opción:", nextStep: 1 };
  }
  if (respuesta.length < 3) {
    return { reply: "Ingresá el nombre y apellido completo:\n\n*0* - Volver", nextStep: 10 };
  }

  return {
    reply:
      `Donante: *${respuesta}*\n\n` +
      "Ingresá la *dirección completa* (calle, número, barrio):\n\n" +
      "*0* - Volver",
    nextStep: 11,
    data: { nuevaDonNombre: respuesta },
  };
}

function handleNuevaDonDireccion(respuesta: string, _state: ConversationState): FlowResponse {
  if (respuesta === "0") {
    return {
      reply: "📋 *Cargar nueva donante*\n\nIngresá el *nombre y apellido* de la nueva donante:\n\n*0* - Volver",
      nextStep: 10,
    };
  }
  if (respuesta.length < 5) {
    return { reply: "Necesitamos una dirección más completa (calle y número):\n\n*0* - Volver", nextStep: 11 };
  }

  return {
    reply:
      `📍 Dirección: *${respuesta}*\n\n` +
      "Ingresá el *número de teléfono* de la donante (o escribí *no tiene*):\n\n" +
      "*0* - Volver",
    nextStep: 12,
    data: { nuevaDonDireccion: respuesta },
  };
}

function handleNuevaDonTelefono(respuesta: string, _state: ConversationState): FlowResponse {
  if (respuesta === "0") {
    return {
      reply: "Ingresá la *dirección completa* (calle, número, barrio):\n\n*0* - Volver",
      nextStep: 11,
    };
  }
  const noTiene = ["no tiene", "no", "na", "-"].some((n) => respuesta.toLowerCase() === n);
  const telefono = noTiene ? null : respuesta;

  return {
    reply:
      `📱 Teléfono: *${telefono || "No tiene"}*\n\n` +
      "Ingresá la *fecha de nacimiento* de la donante (DD/MM/AAAA o DD/MM):\n" +
      "(si no la sabés, escribí *no sabe*)\n\n" +
      "*0* - Volver",
    nextStep: 13,
    data: { nuevaDonTelefono: telefono },
  };
}

function handleNuevaDonFechaNacimiento(respuesta: string, state: ConversationState): FlowResponse {
  if (respuesta === "0") {
    return {
      reply: "Ingresá el *número de teléfono* de la donante (o escribí *no tiene*):\n\n*0* - Volver",
      nextStep: 12,
    };
  }
  const lower = respuesta.toLowerCase();
  const noSabe = ["no sabe", "no se", "no sé", "no", "na", "-", "ns"].some((n) => lower === n);
  const fechaNac = noSabe ? null : respuesta;

  return {
    reply:
      `📋 *Confirmar nueva donante*\n\n` +
      `👤 Nombre: ${state.data.nuevaDonNombre}\n` +
      `📍 Dirección: ${state.data.nuevaDonDireccion}\n` +
      `📱 Teléfono: ${state.data.nuevaDonTelefono || "No tiene"}\n` +
      `🎂 Fecha de nacimiento: ${fechaNac || "No sabe"}\n\n` +
      "*1* - Confirmar | *2* - Cancelar",
    nextStep: 14,
    data: { nuevaDonFechaNac: fechaNac },
  };
}

function handleNuevaDonConfirmar(respuesta: string, state: ConversationState): FlowResponse {
  if (respuesta === "2") {
    return {
      reply: "Cancelado. ¿Querés hacer algo más?\n*1* - Sí\n*2* - No, finalizar",
      nextStep: 99,
    };
  }

  if (respuesta !== "1") {
    return { reply: "Elegí *1* (confirmar) o *2* (cancelar):", nextStep: 14 };
  }

  return {
    reply:
      "✅ *Nueva donante registrada*\n\n" +
      `👤 ${state.data.nuevaDonNombre}\n` +
      `📍 ${state.data.nuevaDonDireccion}\n` +
      `🎂 ${state.data.nuevaDonFechaNac || "Sin fecha de nacimiento"}\n\n` +
      "Se notificó a los administradores.\n\n" +
      "¿Querés cargar otra donante?\n*1* - Sí\n*2* - No, finalizar",
    nextStep: 99,
    data: { donanteRegistrada: true },
    notify: {
      target: "admin",
      message:
        `📋 *Nueva donante cargada por visitadora*\n\n` +
        `👩‍⚕️ Visitadora: ${state.data.nombreVisitadora}\n` +
        `👤 Nombre: ${state.data.nuevaDonNombre}\n` +
        `📍 Dirección: ${state.data.nuevaDonDireccion}\n` +
        `📱 Teléfono: ${state.data.nuevaDonTelefono || "No tiene"}\n` +
        `🎂 Fecha de nacimiento: ${state.data.nuevaDonFechaNac || "No sabe"}`,
    },
  };
}

// ── Volver o finalizar ──────────────────────────────────
function handleVolverOFinalizar(respuesta: string): FlowResponse {
  if (respuesta === "1") {
    return {
      reply: "¿Qué querés hacer?\n\n" + MENU_VISITADORA,
      nextStep: 1,
    };
  }
  return {
    reply: "✅ Sesión finalizada. ¡Buen trabajo! 💪",
    endFlow: true,
  };
}
