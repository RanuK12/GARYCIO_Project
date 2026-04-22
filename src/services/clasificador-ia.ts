/**
 * Router LLM Estricto — Clasificador de intenciones
 *
 * REGLAS DE DISEÑO:
 * - El LLM SOLO clasifica. NO genera respuestas conversacionales.
 * - NO toma decisiones de negocio.
 * - Si detecta enojo/frustración → needsHuman = true
 * - Si detecta múltiples intenciones → needsHuman = true
 * - Output estrictamente JSON. Sin markdown, sin explicaciones.
 *
 * Salida esperada:
 * {
 *   "intent": "...",
 *   "entities": [{"type":"...","value":"..."}],
 *   "needsHuman": boolean,
 *   "sentiment": "calm" | "frustrated" | "angry",
 *   "confidence": "high" | "medium" | "low"
 * }
 */

import { logger } from "../config/logger";
import { loadTrainingExamples, formatTrainingForPrompt } from "./ia-training";
import { env } from "../config/env";

export type Intent =
  | "confirmar_difusion"
  | "reclamo"
  | "aviso"
  | "consulta"
  | "baja"
  | "hablar_persona"
  | "saludo"
  | "agradecimiento"
  | "irrelevante"
  | "menu_opcion"
  | "multiple_issues";

export interface ClassifierResult {
  intent: Intent;
  entities: Array<{ type: string; value: string }>;
  needsHuman: boolean;
  sentiment: "calm" | "frustrated" | "angry";
  confidence: "high" | "medium" | "low";
}

const VALID_INTENTS: Intent[] = [
  "confirmar_difusion",
  "reclamo",
  "aviso",
  "consulta",
  "baja",
  "hablar_persona",
  "saludo",
  "agradecimiento",
  "irrelevante",
  "menu_opcion",
  "multiple_issues",
];

// ── System Prompt estricto (sin personalidad, sin creatividad) ──
const SYSTEM_PROMPT = `Sos un clasificador de intenciones para un bot de WhatsApp de GARYCIO (recolección de residuos reciclables).

REGLAS INQUEBRANTABLES:
1. Respondé SOLO con JSON válido. Sin markdown, sin texto extra, sin explicaciones.
2. NO generés respuestas para el usuario. Tu trabajo es CLASIFICAR, no conversar.
3. NO tomés decisiones de negocio (ej: "le aviso al chofer", "la doy de baja"). Solo clasificá.
4. Si detectás ENojo, frustración o sarcasmo agresivo → sentiment = "angry" y needsHuman = true.
5. Si el mensaje contiene DOS o MÁS intenciones distintas → intent = "multiple_issues" y needsHuman = true.
6. Si no entendés el mensaje → confidence = "low" y needsHuman = true.
7. NUNCA inventés datos. Si no estás seguro, confidence = "low".

INTENCIONES VALIDAS:
- "confirmar_difusion": confirma recepción de aviso de recolección (ej: "1", "recibido", "ok").
- "reclamo": problema con el servicio. Entities: tipoReclamo (no_pasaron|falta_bidon|bidon_sucio|pelela|regalo|otro).
- "aviso": avisa ausencia temporal (vacaciones|enfermedad|mudanza|cambio_direccion|cambio_telefono).
- "consulta": pregunta sobre el servicio.
- "baja": quiere dejar de participar.
- "hablar_persona": pide hablar con un humano.
- "saludo": solo saluda (hola, buen dia).
- "agradecimiento": solo agradece (gracias, ok).
- "irrelevante": mensaje sin sentido útil (emoji solo, jaja).
- "menu_opcion": elige opción de menú (1, 2, 3, 4).
- "multiple_issues": más de una intención en el mismo mensaje.

SENTIMIENTO:
- "calm": mensaje normal, educado.
- "frustrated": molestia leve, impaciencia.
- "angry": enojo explícito, mayúsculas, insultos, sarcasmo agresivo, "nunca pasan", "qué desastre".

ENTITIES:
Extraé solo lo que está EXPLÍCITO en el mensaje:
- tipoReclamo: para intent="reclamo"
- tipoAviso: para intent="aviso" (vacaciones|enfermedad|mudanza|cambio_direccion|cambio_telefono)
- fechaInicio, fechaFin: fechas mencionadas (formato ISO o texto como "desde el lunes")
- descripcion: texto libre relevante

OUTPUT EXACTO (JSON):
{
  "intent": "...",
  "entities": [{"type":"...","value":"..."}],
  "needsHuman": true|false,
  "sentiment": "calm|frustrated|angry",
  "confidence": "high|medium|low"
}`;

// ── Llamada a OpenAI ──
export async function classifyIntent(
  message: string,
  options?: { historial?: string[]; timeoutMs?: number },
): Promise<ClassifierResult> {
  if (!env.AI_CLASSIFIER_ENABLED || !env.OPENAI_API_KEY) {
    return classifyFallback(message);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options?.timeoutMs ?? 8000);

  try {
    const trainingExamples = await loadTrainingExamples();
    const trainingPrompt = formatTrainingForPrompt(trainingExamples);

    const systemPromptWithTraining = SYSTEM_PROMPT + trainingPrompt;

    const userContent = options?.historial?.length
      ? `Historial reciente:\n${options.historial.slice(-3).join("\n")}\n\nMensaje actual: "${message}"`
      : `Mensaje: "${message}"`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPromptWithTraining },
          { role: "user", content: userContent },
        ],
        max_tokens: 200,
        temperature: 0.0,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.error({ status: response.status }, "Error API OpenAI");
      return { ...classifyFallback(message), needsHuman: true, confidence: "low" };
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!raw) {
      return { ...classifyFallback(message), needsHuman: true, confidence: "low" };
    }

    const parsed = JSON.parse(raw) as Partial<ClassifierResult>;

    // Validar intent
    let intent: Intent = "consulta";
    let fallbackResult: ClassifierResult | null = null;
    if (VALID_INTENTS.includes(parsed.intent as Intent)) {
      intent = parsed.intent as Intent;
    } else {
      logger.warn({ intent: parsed.intent }, "Intent no válido de IA — usando fallback completo");
      fallbackResult = classifyFallback(message);
      intent = fallbackResult.intent;
    }

    // Si el intent era inválido, descartamos TODO el output del LLM y usamos el fallback 100%
    if (fallbackResult) {
      return fallbackResult;
    }

    return {
      intent,
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      needsHuman: !!parsed.needsHuman,
      sentiment: ["calm", "frustrated", "angry"].includes(parsed.sentiment as string)
        ? (parsed.sentiment as "calm" | "frustrated" | "angry")
        : "calm",
      confidence: ["high", "medium", "low"].includes(parsed.confidence as string)
        ? (parsed.confidence as "high" | "medium" | "low")
        : "low",
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      logger.warn("Timeout clasificando con IA");
    } else {
      logger.error({ err }, "Error clasificando con IA");
    }
    const fallback = classifyFallback(message);
    // Forzar escalación por fallo de IA, preservando el intent del fallback para routing
    return { ...fallback, needsHuman: true, confidence: "low", intent: fallback.intent };
  }
}

// ── Fallback por regex (rápido, sin red) ──
export function classifyFallback(message: string): ClassifierResult {
  const lower = message
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Detectar enojo/frustración agresiva primero
  const angryPatterns = [
    "hdp", "mierda", "carajo", "puto", "puta", "forro", "forra",
    "nunca pasan", "siempre igual", "que desastre", "una verguenza",
    "hace semanas", "hace meses", "estoy harta", "estoy harto",
    "no sirve para nada", "inutil", "incompetentes",
  ];
  const isAngry = angryPatterns.some((p) => lower.includes(p));

  // Múltiples intenciones: buscar combinaciones
  const hasReclamo = ["no pasaron", "no vinieron", "reclamo", "queja", "problema", "falta", "sucio"].some((p) => lower.includes(p));
  const hasAviso = ["vacaciones", "enferm", "mudanza", "cambio de direccion", "cambio de telefono", "no voy a estar"].some((p) => lower.includes(p));
  const hasBaja = ["darme de baja", "dejar de donar", "no quiero donar", "cancelar"].some((p) => lower.includes(p));

  const intentCount = [hasReclamo, hasAviso, hasBaja].filter(Boolean).length;
  if (intentCount >= 2) {
    return {
      intent: "multiple_issues",
      entities: [],
      needsHuman: true,
      sentiment: isAngry ? "angry" : "frustrated",
      confidence: "high",
    };
  }

  // Confirmación difusión
  if (/^[,.\s]*1[,\.\s]*$/.test(lower)) {
    return { intent: "confirmar_difusion", entities: [], needsHuman: false, sentiment: "calm", confidence: "high" };
  }
  if (["recibido", "confirmo", "entendido", "recibi", "confirmado"].includes(lower)) {
    return { intent: "confirmar_difusion", entities: [], needsHuman: false, sentiment: "calm", confidence: "high" };
  }

  // Menú numérico
  if (/^[1-4]$/.test(lower)) return { intent: "menu_opcion", entities: [], needsHuman: false, sentiment: "calm", confidence: "high" };

  // Reclamo
  if (["no pasaron", "no vinieron", "no paso", "reclamo", "queja", "falta el bidon", "bidon sucio", "pelela"].some((p) => lower.includes(p))) {
    return {
      intent: "reclamo",
      entities: [{ type: "tipoReclamo", value: "otro" }],
      needsHuman: isAngry,
      sentiment: isAngry ? "angry" : "frustrated",
      confidence: "high",
    };
  }

  // Baja
  if (["darme de baja", "quiero bajar", "dejar de donar", "no quiero donar", "dame de baja", "cancelar"].some((p) => lower.includes(p))) {
    return { intent: "baja", entities: [], needsHuman: true, sentiment: isAngry ? "angry" : "calm", confidence: "high" };
  }

  // Hablar persona
  if (["hablar con una persona", "hablar con alguien", "quiero un humano", "atencion humana"].some((p) => lower.includes(p))) {
    return { intent: "hablar_persona", entities: [], needsHuman: true, sentiment: "calm", confidence: "high" };
  }

  // Aviso
  if (["vacaciones", "suspender", "no voy a estar", "enferm", "mudanza", "cambio de direccion", "cambio de telefono"].some((p) => lower.includes(p))) {
    return { intent: "aviso", entities: [{ type: "tipoAviso", value: "general" }], needsHuman: false, sentiment: "calm", confidence: "high" };
  }

  // Saludo
  if (/^(hola|ola|buen ?dia|buenos ?dias|buenas ?(tardes|noches))$/i.test(lower)) {
    return { intent: "saludo", entities: [], needsHuman: false, sentiment: "calm", confidence: "high" };
  }

  // Agradecimiento / irrelevante
  if (/^(gracias?|muchas gracias|mil gracias|ok|okey|oki|dale|bueno|bien|listo|si|no|ya|jaja|jeje)$/i.test(lower)) {
    return { intent: "agradecimiento", entities: [], needsHuman: false, sentiment: "calm", confidence: "high" };
  }
  if (/^[\p{Emoji_Presentation}\p{Emoji}\uFE0F\u200D]{1,6}$/u.test(lower)) {
    return { intent: "irrelevante", entities: [], needsHuman: false, sentiment: "calm", confidence: "high" };
  }

  // Default
  return {
    intent: "consulta",
    entities: [],
    needsHuman: isAngry,
    sentiment: isAngry ? "angry" : "calm",
    confidence: "low",
  };
}
