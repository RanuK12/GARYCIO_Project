/**
 * Respuesta IA Contextual — Generador de respuestas naturales
 *
 * Genera respuestas conversacionales usando IA contextual para:
 * - saludo, consulta, agradecimiento, aviso, reclamo, confirmar_difusion, menu_opcion
 *
 * Usa los templates aprobados como guía de estilo en el system prompt
 * e inyecta training examples activos de la DB para mayor precisión.
 */

import { env } from "../config/env";
import { logger } from "../config/logger";
import { db } from "../database";
import { donantes } from "../database/schema";
import { eq } from "drizzle-orm";
import { loadTrainingExamples } from "./ia-training";

export interface ContextoRespuesta {
  phone: string;
  message: string;
  intent: string;
  historial?: string[];
  donante?: {
    nombre: string;
    direccion?: string | null;
    diasRecoleccion?: string | null;
    estado?: string | null;
    fechaAlta?: string | null;
  } | null;
}

// Templates aprobados por el dueño — guía de estilo para la IA
const TEMPLATES_GUIA = `
EJEMPLOS DE TONO Y ESTILO (aprobados por la empresa):

1. Problemas logísticos (no pasaron, demora):
   "Buen día! Somos una empresa de recolección nueva, los chicos están aprendiendo nuevos recorridos. Estamos haciendo todo lo posible para mejorar. Tu colaboración es muy importante para nosotros."

2. Disculpas por inconvenientes:
   "Entendemos por la situación que estás pasando y lo lamentamos mucho. Estamos trabajando para resolverlo a la brevedad. Gracias por tu paciencia."

3. Consultas de horario:
   "Por ahora no tenemos un horario aproximado, pero pasamos entre las 6am y 4pm. Si tenés urgencia, avísanos y tratamos de coordinar."

4. Agradecimientos:
   "Le agradecemos su inestimable colaboración! Seguinos escribiendo si necesitás algo."

5. Saludos:
   "Hola! Soy el asistente de GARYCIO. ¿En qué te puedo ayudar?"

6. Avisos (vacaciones, ausencia):
   "Gracias por avisar! Lo registramos y le avisamos al recolector de tu zona."

7. Donante frustrada / enojada (primer reclamo):
   "Entendemos tu frustración y te pedimos disculpas. Ya notificamos al equipo de recolección sobre tu caso. Vamos a hacer todo lo posible para que no vuelva a pasar."

8. Donante insistente (ya reclamó antes):
   "Tenés razón en estar molesta. Tu reclamo ya fue registrado y el equipo está al tanto. Te aseguramos que vamos a resolverlo. Si preferís hablar con una persona del equipo, decinos y te contactamos."

9. Donante que dice "ya soy donante" o "ya estoy registrada":
   "Disculpá la confusión. Puede que tu número haya cambiado en nuestro sistema. Le avisamos al equipo para que verifiquen tus datos y te contacten."

10. Donante que pide hablar con persona:
    "Entendido! Le avisamos a nuestro equipo para que se comuniquen con vos. Mientras tanto, si hay algo en lo que pueda ayudarte, escribíme."

11. Mensajes múltiples / temas mezclados:
    "Gracias por tu mensaje. Voy a responder punto por punto..."
`;

// System prompt base
function buildSystemPrompt(
  datosStr: string,
  historialStr: string,
  trainingStr: string,
  intent: string,
  mensaje: string,
): string {
  return `Sos el asistente de GARYCIO, una empresa argentina de recolección de residuos reciclables (orina para laboratorios).

TU ROL:
- Atender donantes de manera cálida, profesional y empática
- Ser claro y breve (máximo 2-3 párrafos cortos)
- Usar español argentino informal (voseo: "tenés", "podés", "escribinos")
- No inventar datos. Si no sabés algo, decí que un encargado se va a contactar.
- Usar emojis con moderación (1-2 por mensaje máximo)

${TEMPLATES_GUIA}

${trainingStr ? `EJEMPLOS DE ENTRENAMIENTO ADICIONALES:\n${trainingStr}\n` : ""}

DATOS DEL DONANTE EN NUESTRO SISTEMA:
${datosStr}

HISTORIAL RECIENTE DE LA CONVERSACIÓN:
${historialStr}

INTENCIÓN CLASIFICADA: ${intent}

REGLAS CRÍTICAS:
- NO uses markdown ni asteriscos (*) en las respuestas
- No mencionés "templates", "IA", "inteligencia artificial" ni "sistema"
- Si tenés los datos del donante (nombre, dirección, días), USÁLOS en la respuesta
- Si el donante ya existe, NUNCA le preguntes si dona o si está registrado
- Para "menu_opcion", el reply puede ser corto porque el menú va en botones aparte
- Para "confirmar_difusion", confirmá la recepción y recordá los días si los tenés
- Para "reclamo", reconocé el problema, mostrá empatía, y asegurá que el equipo fue notificado
- Para "saludo", si tenés el nombre usalo. Si no, saludá genéricamente.
- Respondé en 1-3 líneas máximo. No hagas párrafos largos.

REGLAS PARA FRUSTRACIÓN E INSISTENCIA:
- Si la persona parece enojada o frustrada, respondé con MÁS empatía, no menos
- Reconocé su frustración explícitamente ("Tenés razón", "Entendemos tu molestia")
- Dales información concreta: que su reclamo ya fue registrado, que el equipo fue notificado
- Si insisten, NO repitas la misma respuesta. Dales algo NUEVO (ej: "Le vamos a pedir al encargado que te contacte personalmente")
- NUNCA ignores su enojo. NUNCA respondas con frases genéricas vacías.
- Si piden hablar con una persona, deciles que le avisás al equipo para que se comuniquen
- Si dicen que quieren dejar de donar, mostrá empatía y deciles que le avisás al equipo

MENSAJE ACTUAL DEL DONANTE: "${mensaje}"

Tu respuesta (solo el texto, sin markdown):`;
}

// Cache simple en memoria para respuestas (TTL 5 min)
const cache = new Map<string, { respuesta: string; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX = 500;

// Limpieza periódica del cache (cada 15 min)
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, value] of cache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      cache.delete(key);
      cleaned++;
    }
  }
  if (cache.size > CACHE_MAX) {
    const sorted = [...cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toRemove = sorted.slice(0, cache.size - CACHE_MAX);
    for (const [key] of toRemove) {
      cache.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.debug({ cleaned, remaining: cache.size }, "Cache de respuestas IA limpiado");
  }
}, 15 * 60 * 1000);

/**
 * Genera respuesta contextual usando IA.
 * Busca datos reales del donante en la DB, inyecta training examples activos,
 * y genera una respuesta natural y empática.
 */
export async function generarRespuestaContextual(ctx: ContextoRespuesta): Promise<string> {
  // Si IA no está habilitada o no hay key, usar template fallback
  if (!env.AI_CLASSIFIER_ENABLED || !env.OPENAI_API_KEY) {
    logger.debug({ intent: ctx.intent }, "IA no habilitada, usando fallback");
    return generarRespuestaFallback(ctx);
  }

  // Chequear cache
  const cacheKey = `${ctx.phone}:${ctx.intent}:${ctx.message.slice(0, 50)}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    logger.debug({ cacheKey }, "Respuesta cache hit");
    return cached.respuesta;
  }

  // Buscar datos del donante en la DB
  let donanteInfo = ctx.donante;
  if (!donanteInfo) {
    try {
      const [d] = await db
        .select({
          nombre: donantes.nombre,
          direccion: donantes.direccion,
          diasRecoleccion: donantes.diasRecoleccion,
          estado: donantes.estado,
          fechaAlta: donantes.fechaAlta,
        })
        .from(donantes)
        .where(eq(donantes.telefono, ctx.phone))
        .limit(1);
      donanteInfo = d ?? null;
    } catch (err) {
      logger.error({ err }, "Error buscando donante para respuesta contextual");
      donanteInfo = null;
    }
  }

  // Formatear historial
  const historialStr = ctx.historial && ctx.historial.length > 0
    ? ctx.historial.join("\n")
    : "Sin historial reciente";

  // Formatear datos del donante
  let datosStr: string;
  if (donanteInfo) {
    const parts = [`Nombre: ${donanteInfo.nombre || "No registrado"}`];
    if (donanteInfo.direccion) parts.push(`Dirección: ${donanteInfo.direccion}`);
    if (donanteInfo.diasRecoleccion) parts.push(`Días de recolección: ${donanteInfo.diasRecoleccion}`);
    if (donanteInfo.estado) parts.push(`Estado: ${donanteInfo.estado}`);
    if (donanteInfo.fechaAlta) parts.push(`Fecha de alta: ${donanteInfo.fechaAlta}`);
    datosStr = parts.join("\n");
  } else {
    datosStr = "No hay datos del donante en el sistema (posiblemente nuevo)";
  }

  // Cargar training examples activos de la DB
  let trainingStr = "";
  try {
    const examples = await loadTrainingExamples();
    if (examples.length > 0) {
      // Filtrar los que tienen respuesta esperada (útiles para guiar estilo)
      const conRespuesta = examples.filter((e) => e.respuestaEsperada);
      const sinRespuesta = examples.filter((e) => !e.respuestaEsperada);

      if (conRespuesta.length > 0) {
        trainingStr += conRespuesta
          .slice(0, 8)
          .map((e) => `Usuario: "${e.mensajeUsuario}" → Intención: ${e.intencionCorrecta} → Respuesta: "${e.respuestaEsperada}"`)
          .join("\n");
      }
      if (sinRespuesta.length > 0) {
        trainingStr += "\n" + sinRespuesta
          .slice(0, 5)
          .map((e) => `Usuario: "${e.mensajeUsuario}" → Intención correcta: ${e.intencionCorrecta}`)
          .join("\n");
      }
    }
  } catch (err) {
    logger.debug({ err }, "No se pudieron cargar training examples para respuesta contextual");
  }

  // Construir prompt
  const userPrompt = buildSystemPrompt(datosStr, historialStr, trainingStr, ctx.intent, ctx.message);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: userPrompt }],
        max_tokens: 256,
        temperature: 0.6, // Un poco menos que 0.7 para mayor consistencia
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.error({ status: response.status, intent: ctx.intent }, "Error HTTP generando respuesta IA contextual");
      return generarRespuestaFallback(ctx);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const respuesta = data.choices?.[0]?.message?.content?.trim() || "";

    if (!respuesta) {
      return generarRespuestaFallback(ctx);
    }

    // Sanitizar: quitar markdown si la IA lo puso
    const respuestaLimpia = respuesta
      .replace(/\*\*/g, "")
      .replace(/\*/g, "")
      .replace(/#{1,3}\s/g, "")
      .replace(/```/g, "")
      .trim();

    // Guardar en cache
    cache.set(cacheKey, { respuesta: respuestaLimpia, timestamp: Date.now() });

    logger.info(
      { phone: ctx.phone, intent: ctx.intent, respuesta: respuestaLimpia.slice(0, 60) },
      "Respuesta generada por IA contextual",
    );
    return respuestaLimpia;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      logger.warn({ intent: ctx.intent, phone: ctx.phone }, "Timeout generando respuesta IA contextual (8s)");
    } else {
      logger.error({ err, intent: ctx.intent }, "Error generando respuesta IA contextual");
    }
    return generarRespuestaFallback(ctx);
  }
}

/**
 * Fallback rápido sin IA cuando la IA no está disponible o falla.
 */
function generarRespuestaFallback(ctx: ContextoRespuesta): string {
  const nombre = ctx.donante?.nombre?.split(" ")[0] || "";
  const saludo = nombre ? `Hola ${nombre}!` : "Hola!";

  const intentTemplates: Record<string, string> = {
    saludo: `${saludo} 👋 Soy el asistente de GARYCIO. ¿En qué te puedo ayudar?`,
    consulta: `${saludo} Recibimos tu consulta. Un encargado se va a comunicar con vos a la brevedad para ayudarte.`,
    agradecimiento: "Gracias a vos! 🙏 Tu colaboración es muy importante para nosotros.",
    aviso: "Recibimos tu aviso. Le vamos a avisar al recolector de tu zona. Gracias!",
    reclamo: "Entendemos tu preocupación y lamentamos el inconveniente. El equipo ya fue notificado y estamos trabajando para resolverlo.",
    irrelevante: "",
    confirmar_difusion: "Gracias por confirmar! Te esperamos en los días indicados.",
    menu_opcion: "",
    baja: "Lamentamos que quieras dejar de participar. Una persona de nuestro equipo se va a comunicar con vos.",
    hablar_persona: "Tu mensaje fue derivado a nuestro equipo. Una persona se va a comunicar con vos a la brevedad.",
    multiple_issues: "Veo que tenés varias cosas para contarnos. Te derivamos con un representante para que te ayude.",
  };

  return intentTemplates[ctx.intent] || "Gracias por tu mensaje. Te respondemos a la brevedad.";
}

/**
 * Limpia la cache de respuestas viejas.
 */
export function limpiarCacheRespuestas(): void {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      cache.delete(key);
    }
  }
  logger.debug("Cache de respuestas limpiada");
}
