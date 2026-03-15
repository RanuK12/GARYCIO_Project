import { FlowHandler, ConversationState, FlowResponse } from "./types";

/**
 * Flow de contacto inicial para donantes de zonas nuevas.
 * Objetivo: confirmar estado de donación, días de recolección y dirección exacta
 * para reorganizar los recorridos de los nuevos choferes.
 *
 * Pasos:
 * 0 - Saludo + preguntar si actualmente está donando
 * 1 - Qué días le pasan a recolectar
 * 2 - Pedir dirección exacta (calle, número, entre calles, piso/depto)
 * 3 - Confirmar todo y cerrar
 */
export const contactoInicialFlow: FlowHandler = {
  name: "contacto_inicial",
  keyword: [],

  async handle(state: ConversationState, message: string): Promise<FlowResponse> {
    const respuesta = message.trim().toLowerCase();

    switch (state.step) {
      case 0:
        return handleDonandoActualmente(respuesta, state);
      case 1:
        return handleDiasRecoleccion(respuesta, state);
      case 2:
        return handleDireccionExacta(respuesta, state, message.trim());
      case 3:
        return handleConfirmacion(respuesta, state);
      default:
        return { reply: "Gracias por tu tiempo. ¡Nos vemos pronto!", endFlow: true };
    }
  },
};

function handleDonandoActualmente(respuesta: string, state: ConversationState): FlowResponse {
  const afirmativas = ["si", "sí", "sep", "sip", "claro", "obvio", "dale", "1"];
  const negativas = ["no", "nop", "na", "nah", "2"];

  if (afirmativas.some((a) => respuesta.includes(a))) {
    return {
      reply:
        "¡Genial! 🙌 ¿Qué días te pasan a recolectar actualmente?\n\n" +
        "Podés decirme los días (ej: lunes y jueves) o si no te acordás decime \"no sé\".",
      nextStep: 1,
      data: { donandoActualmente: true },
    };
  }

  if (negativas.some((n) => respuesta.includes(n))) {
    return {
      reply:
        "Entendido, no hay problema. Si en algún momento querés retomar la donación " +
        "no dudes en escribirnos. ¡Gracias por tu tiempo!",
      endFlow: true,
      data: { donandoActualmente: false },
      notify: { target: "admin", message: "Donante indica que no está donando actualmente" },
    };
  }

  return {
    reply:
      "Disculpá, no entendí bien. ¿Actualmente estás donando?\n\n" +
      "Respondé *1* para SÍ o *2* para NO.",
    nextStep: 0,
  };
}

function handleDiasRecoleccion(respuesta: string, state: ConversationState): FlowResponse {
  const dias = extraerDias(respuesta);
  const noSabe = respuesta.includes("no s") || respuesta.includes("no me acuerdo") || respuesta.includes("ni idea");

  if (dias.length === 0 && !noSabe) {
    return {
      reply:
        "No pude identificar los días. ¿Podés decirme los días de la semana? " +
        "(ej: lunes, miércoles y viernes)\n\n" +
        "Si no te acordás, escribí \"no sé\".",
      nextStep: 1,
    };
  }

  const diasTexto = dias.length > 0 ? dias.join(", ") : "a confirmar";

  return {
    reply:
      `Perfecto, quedó registrado: *${diasTexto}*.\n\n` +
      "Ahora necesitamos tu *dirección exacta* para organizar los recorridos del nuevo recolector. " +
      "Por favor escribila con el mayor detalle posible:\n\n" +
      "📍 *Calle y número*\n" +
      "📍 *Entre calles* (si sabés)\n" +
      "📍 *Piso/Depto* (si aplica)\n" +
      "📍 *Barrio o localidad*\n\n" +
      "Ejemplo: _Av. Corrientes 1234, entre Uruguay y Talcahuano, 3° B, CABA_",
    nextStep: 2,
    data: { diasRecoleccion: diasTexto },
  };
}

function handleDireccionExacta(respuesta: string, state: ConversationState, mensajeOriginal: string): FlowResponse {
  // Validar que la dirección tenga al menos algo útil (mínimo 10 caracteres con un número)
  const tieneNumero = /\d/.test(respuesta);
  const largaSuficiente = respuesta.length >= 10;

  if (!tieneNumero || !largaSuficiente) {
    return {
      reply:
        "Necesitamos que la dirección sea lo más completa posible para armar los recorridos. " +
        "Por favor incluí *calle y número* como mínimo.\n\n" +
        "Ejemplo: _Av. San Martín 456, Caballito_",
      nextStep: 2,
    };
  }

  const diasTexto = state.data.diasRecoleccion || "a confirmar";

  return {
    reply:
      "Perfecto, te confirmo los datos:\n\n" +
      `🗓️ *Días de recolección:* ${diasTexto}\n` +
      `📍 *Dirección:* ${mensajeOriginal}\n\n` +
      "¿Está todo bien? Respondé *1* para confirmar o *2* para corregir algo.",
    nextStep: 3,
    data: { direccionExacta: mensajeOriginal },
  };
}

function handleConfirmacion(respuesta: string, state: ConversationState): FlowResponse {
  const confirma = ["si", "sí", "1", "sep", "sip", "correcto", "correcta", "bien", "ok", "dale"].some(
    (a) => respuesta.includes(a),
  );

  if (confirma) {
    return {
      reply:
        "¡Listo! Tus datos quedaron actualizados. 📋\n\n" +
        "Estamos reorganizando los recorridos y pronto vas a tener un nuevo recolector asignado. " +
        "Te vamos a avisar quién es y los días exactos de recolección.\n\n" +
        "Si tenés alguna duda o reclamo, escribinos por acá. ¡Gracias! 😊",
      endFlow: true,
      data: { confirmado: true },
      notify: {
        target: "admin",
        message: `Donante confirmó datos - Días: ${state.data.diasRecoleccion || "?"} - Dirección: ${state.data.direccionExacta || "?"}`,
      },
    };
  }

  // Quiere corregir → volver a pedir dirección
  return {
    reply:
      "Sin problema, empecemos de nuevo.\n\n" +
      "¿Qué días te pasan a recolectar actualmente?",
    nextStep: 1,
  };
}

function extraerDias(texto: string): string[] {
  const diasSemana: Record<string, string> = {
    lun: "Lunes",
    mar: "Martes",
    mie: "Miércoles",
    mié: "Miércoles",
    jue: "Jueves",
    vie: "Viernes",
    sab: "Sábado",
    sáb: "Sábado",
    dom: "Domingo",
  };

  const encontrados: string[] = [];
  const lower = texto.toLowerCase();

  for (const [abrev, nombre] of Object.entries(diasSemana)) {
    if (lower.includes(abrev)) {
      encontrados.push(nombre);
    }
  }

  return encontrados;
}
