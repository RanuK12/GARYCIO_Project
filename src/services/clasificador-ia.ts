import { logger } from "../config/logger";
import { env } from "../config/env";
import { db } from "../database";
import { donantes, reclamos, avisos, zonas, choferes, zonaChoferes, difusionEnvios, iaFeedback } from "../database/schema";
import { eq, and } from "drizzle-orm";

// ── Tipos ────────────────────────────────────────────────
export type Intencion =
  | "confirmar_difusion"
  | "reclamo"
  | "aviso"
  | "consulta"
  | "baja"
  | "hablar_persona"
  | "saludo"
  | "agradecimiento"
  | "irrelevante"
  | "menu_opcion";

export interface RespuestaIA {
  intencion: Intencion;
  respuesta: string;          // Texto para enviar a la donante
  urgencia?: "alta" | "media" | "baja";
  datosExtraidos?: {
    tipoReclamo?: string;
    tipoAviso?: string;
    fechaInicio?: string;
    fechaFin?: string;
    descripcion?: string;
    nuevaDireccion?: string;
    nuevoTelefono?: string;
  };
}

// ── Datos de la donante para contexto ────────────────────
interface DatosDonante {
  id: number;
  nombre: string;
  direccion: string;
  diasRecoleccion: string | null;
  zonaNombre: string | null;
  choferNombre: string | null;
  estado: string;
  tieneDifusionPendiente: boolean;
}

async function obtenerDatosDonante(phone: string): Promise<DatosDonante | null> {
  try {
    const phoneSinPlus = phone.startsWith("+") ? phone.slice(1) : phone;
    const phoneConPlus = phone.startsWith("+") ? phone : `+${phone}`;

    // Buscar donante
    let donanteRow = await db
      .select({
        id: donantes.id,
        nombre: donantes.nombre,
        direccion: donantes.direccion,
        diasRecoleccion: donantes.diasRecoleccion,
        zonaId: donantes.zonaId,
        estado: donantes.estado,
      })
      .from(donantes)
      .where(eq(donantes.telefono, phoneSinPlus))
      .limit(1);

    if (donanteRow.length === 0) {
      donanteRow = await db
        .select({
          id: donantes.id,
          nombre: donantes.nombre,
          direccion: donantes.direccion,
          diasRecoleccion: donantes.diasRecoleccion,
          zonaId: donantes.zonaId,
          estado: donantes.estado,
        })
        .from(donantes)
        .where(eq(donantes.telefono, phoneConPlus))
        .limit(1);
    }

    if (donanteRow.length === 0) return null;

    const d = donanteRow[0];

    // Buscar zona y chofer
    let zonaNombre: string | null = null;
    let choferNombre: string | null = null;

    if (d.zonaId) {
      const zonaRow = await db
        .select({ nombre: zonas.nombre })
        .from(zonas)
        .where(eq(zonas.id, d.zonaId))
        .limit(1);
      zonaNombre = zonaRow[0]?.nombre || null;

      const choferRow = await db
        .select({ nombre: choferes.nombre })
        .from(zonaChoferes)
        .innerJoin(choferes, eq(zonaChoferes.choferId, choferes.id))
        .where(and(eq(zonaChoferes.zonaId, d.zonaId), eq(zonaChoferes.activo, true)))
        .limit(1);
      choferNombre = choferRow[0]?.nombre || null;
    }

    // Verificar difusión pendiente
    let tieneDifusionPendiente = false;
    const pendiente = await db
      .select({ id: difusionEnvios.id })
      .from(difusionEnvios)
      .where(and(eq(difusionEnvios.confirmado, false), eq(difusionEnvios.telefono, phoneSinPlus)))
      .limit(1);
    tieneDifusionPendiente = pendiente.length > 0;

    return {
      id: d.id,
      nombre: d.nombre,
      direccion: d.direccion,
      diasRecoleccion: d.diasRecoleccion,
      zonaNombre,
      choferNombre,
      estado: d.estado as string,
      tieneDifusionPendiente,
    };
  } catch (err) {
    logger.error({ phone, err }, "Error obteniendo datos de donante para IA");
    return null;
  }
}

// ── System Prompt para el asistente conversacional ───────
function buildSystemPrompt(datos: DatosDonante | null): string {
  const contexto = datos
    ? `\nCONTEXTO DE LA DONANTE:
- Nombre: ${datos.nombre}
- Dirección: ${datos.direccion}
- Días de recolección: ${datos.diasRecoleccion || "No asignados"}
- Zona: ${datos.zonaNombre || "Sin zona"}
- Chofer asignado: ${datos.choferNombre || "Sin chofer"}
- Estado: ${datos.estado}
- Tiene difusión pendiente de confirmar: ${datos.tieneDifusionPendiente ? "SÍ" : "NO"}`
    : "\nNo se encontraron datos de esta donante en el sistema.";

  return `Sos un asistente virtual de WhatsApp para GARYCIO, una empresa de recolección de residuos reciclables (aceite usado, bidones). Tu nombre es "el asistente de GARYCIO".

PERSONALIDAD:
- Cordial, profesional y respetuoso. Tratá a las donantes con mucha consideración — la mayoría son personas mayores.
- Hablás en argentino (vos, "querés", "podés") pero siempre con respeto, NUNCA uses jerga ni expresiones informales como "qué garrón", "re piola", "buenísimo", etc.
- Respuestas CORTAS (máximo 3 oraciones). Las donantes no leen mensajes largos.
- Usá emojis con moderación (máximo 1 por mensaje, preferiblemente ninguno).
- NUNCA uses lenguaje técnico. Hablá simple y claro.
- Si la donante escribe mal (faltas de ortografía, abreviaciones, etc.), entendé igual y respondé con normalidad sin corregirla.
- Siempre agradecé su participación y colaboración. Son donantes voluntarias.
${contexto}

TU TRABAJO:
Analizá el mensaje y respondé con un JSON con esta estructura exacta:
{
  "intencion": "...",
  "respuesta": "...",
  "urgencia": "alta|media|baja",
  "datosExtraidos": { ... }
}

INTENCIONES POSIBLES:
- "confirmar_difusion": Quiere confirmar que recibió el aviso de recolección. Respondé algo breve y cálido como "Recepción confirmada, te esperamos el [días]. Muchas gracias por tu colaboración."
- "reclamo": Tiene un problema con el servicio. Respondé con comprensión y respeto, pedile disculpas por la molestia, decile que ya le avisaste al equipo y que lo van a resolver. Extraé el tipo: "no_pasaron", "falta_bidon", "bidon_sucio", "pelela", "regalo", "otro".
  - Urgencia ALTA: si dice que hace varios días/semanas que no pasan, o está muy molesta
  - Urgencia MEDIA: reclamo normal de un día
  - Urgencia BAJA: consulta menor (bidón sucio, pelela)
- "aviso": Avisa algo (vacaciones, enfermedad, cambio dirección/teléfono). Respondé con comprensión. Extraé tipo, fechas si las menciona, nueva dirección/teléfono.
- "consulta": Pregunta sobre el servicio. Respondé con los datos que tenés de la donante (días de recolección, zona, etc.). Si no tenés la info, decile que vas a consultar con el equipo y le avisan.
- "baja": Quiere dejar de participar. Respondé con respeto y calidez, agradecé su tiempo y decile que alguien del equipo se va a comunicar.
- "hablar_persona": Pide hablar con una persona. Decile que derivás su mensaje al equipo.
- "saludo": Solo saluda. Respondé con un saludo respetuoso y preguntale en qué la podés ayudar.
- "agradecimiento": Solo agradece. Respondé brevemente agradeciendo también, o dejá la respuesta vacía.
- "irrelevante": Mensaje sin sentido útil. Respuesta vacía.
- "menu_opcion": Elige opción de menú (1, 2, 3). Respondé mostrando las opciones: 1=Reclamo, 2=Aviso, 3=Consulta.

REGLAS CRÍTICAS:
- Respondé SOLO con el JSON, sin texto adicional.
- Si la donante escribe con errores ("ola zi quier0 suscrivirme", "no pasaron x mi ksa"), interpretá lo que quiere decir.
- NUNCA inventes datos que no tenés. Si no sabés sus días de recolección, decí "voy a consultar con el equipo y te avisamos".
- Si es reclamo, SIEMPRE incluí urgencia.
- En "datosExtraidos", solo incluí los campos que apliquen. No incluyas campos vacíos.
- NUNCA tutees a la donante. Siempre usá "vos" y "usted" indistintamente pero con respeto.`;
}

// ── Llamada a OpenAI ─────────────────────────────────────
export async function procesarMensajeIA(
  phone: string,
  mensaje: string,
  historial?: string[],
): Promise<RespuestaIA> {
  // Si no hay API key, usar fallback
  if (!env.AI_CLASSIFIER_ENABLED || !env.OPENAI_API_KEY) {
    return procesarFallback(phone, mensaje);
  }

  try {
    // Obtener datos de la donante para contexto
    const datos = await obtenerDatosDonante(phone);

    const userContent = historial?.length
      ? `Historial reciente:\n${historial.map((m) => `- ${m}`).join("\n")}\n\nMensaje actual: "${mensaje}"`
      : `Mensaje: "${mensaje}"`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: buildSystemPrompt(datos) },
          { role: "user", content: userContent },
        ],
        max_tokens: 300,
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      logger.error({ status: response.status }, "Error en API de OpenAI — usando fallback");
      guardarFeedback(phone, mensaje, null, null, true, `API error: ${response.status}`).catch(() => {});
      return procesarFallback(phone, mensaje);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };

    const rawContent = data.choices?.[0]?.message?.content?.trim();
    if (!rawContent) {
      guardarFeedback(phone, mensaje, null, null, true, "Respuesta vacía de OpenAI").catch(() => {});
      return procesarFallback(phone, mensaje);
    }

    const parsed = JSON.parse(rawContent) as RespuestaIA;

    // Validar intención
    const intencionesValidas: Intencion[] = [
      "confirmar_difusion", "reclamo", "aviso", "consulta",
      "baja", "hablar_persona", "saludo", "agradecimiento",
      "irrelevante", "menu_opcion",
    ];

    if (!intencionesValidas.includes(parsed.intencion)) {
      logger.warn({ parsed }, "IA devolvió intención no reconocida");
      guardarFeedback(phone, mensaje, parsed.intencion, parsed.respuesta, true, `Intención no válida: ${parsed.intencion}`).catch(() => {});
      return procesarFallback(phone, mensaje);
    }

    // Ejecutar acciones según intención (guardar en DB, etc.)
    await ejecutarAcciones(phone, parsed, datos);

    // Guardar feedback de TODAS las interacciones con IA (para aprender)
    guardarFeedback(phone, mensaje, parsed.intencion, parsed.respuesta, false, null, parsed.urgencia).catch(() => {});

    logger.info({
      phone,
      intencion: parsed.intencion,
      urgencia: parsed.urgencia,
      mensaje: mensaje.slice(0, 60),
    }, "Mensaje procesado por IA");

    return parsed;
  } catch (err) {
    logger.error({ err }, "Error procesando con IA — usando fallback");
    guardarFeedback(phone, mensaje, null, null, true, (err as Error).message).catch(() => {});
    return procesarFallback(phone, mensaje);
  }
}

// ── Guardar feedback para aprendizaje ─────────────────────
async function guardarFeedback(
  telefono: string,
  mensajeOriginal: string,
  intencion: string | null,
  respuesta: string | null,
  useFallback: boolean,
  errorDetalle: string | null,
  urgencia?: string | null,
): Promise<void> {
  try {
    await db.insert(iaFeedback).values({
      telefono,
      mensajeOriginal: mensajeOriginal.slice(0, 500),
      intencionDetectada: intencion,
      respuestaGenerada: respuesta?.slice(0, 500) || null,
      urgenciaDetectada: urgencia || null,
      useFallback,
      errorDetalle: errorDetalle?.slice(0, 200) || null,
    });
  } catch (err) {
    logger.error({ err }, "Error guardando feedback IA");
  }
}

// ── Acciones automáticas post-clasificación ──────────────
async function ejecutarAcciones(
  phone: string,
  resultado: RespuestaIA,
  datos: DatosDonante | null,
): Promise<void> {
  try {
    if (resultado.intencion === "reclamo" && datos) {
      // Guardar reclamo en DB automáticamente
      const tipoMap: Record<string, "regalo" | "falta_bidon" | "nueva_pelela" | "otro"> = {
        no_pasaron: "falta_bidon",
        falta_bidon: "falta_bidon",
        bidon_sucio: "otro",
        pelela: "nueva_pelela",
        regalo: "regalo",
        otro: "otro",
      };
      const gravedadMap: Record<string, "leve" | "moderado" | "grave" | "critico"> = {
        baja: "leve",
        media: "moderado",
        alta: "grave",
      };

      const tipo = tipoMap[resultado.datosExtraidos?.tipoReclamo || "otro"] || "otro";
      const gravedad = gravedadMap[resultado.urgencia || "media"] || "moderado";

      await db.insert(reclamos).values({
        donanteId: datos.id,
        tipo,
        descripcion: resultado.datosExtraidos?.descripcion || null,
        estado: "pendiente",
        gravedad,
      });

      logger.info({ phone, tipo, gravedad }, "Reclamo guardado automáticamente por IA");
    }

    if (resultado.intencion === "aviso" && datos && resultado.datosExtraidos?.tipoAviso) {
      const tipoMap: Record<string, "vacaciones" | "enfermedad" | "medicacion"> = {
        vacaciones: "vacaciones",
        enfermedad: "enfermedad",
        medicacion: "medicacion",
      };
      const tipo = tipoMap[resultado.datosExtraidos.tipoAviso];
      if (tipo) {
        const hoy = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
        await db.insert(avisos).values({
          donanteId: datos.id,
          tipo,
          fechaInicio: resultado.datosExtraidos.fechaInicio || hoy,
          fechaFin: resultado.datosExtraidos.fechaFin || null,
          notas: resultado.datosExtraidos.descripcion || null,
        });
        logger.info({ phone, tipo }, "Aviso guardado automáticamente por IA");
      }
    }

    if (resultado.intencion === "confirmar_difusion" && datos?.tieneDifusionPendiente) {
      const phoneSinPlus = phone.startsWith("+") ? phone.slice(1) : phone;
      await db
        .update(difusionEnvios)
        .set({ confirmado: true, fechaConfirmacion: new Date() })
        .where(and(eq(difusionEnvios.confirmado, false), eq(difusionEnvios.telefono, phoneSinPlus)));
      logger.info({ phone }, "Difusión confirmada automáticamente por IA");
    }
  } catch (err) {
    logger.error({ phone, err }, "Error ejecutando acciones post-IA");
  }
}

// ── Mantener clasificador simple como export para backwards compat ──
export async function clasificarIntencion(
  mensaje: string,
  historial?: string[],
): Promise<Intencion> {
  const resultado = clasificarFallback(mensaje);
  return resultado;
}

// ── Fallback sin IA ──────────────────────────────────────
function procesarFallback(phone: string, mensaje: string): RespuestaIA {
  const intencion = clasificarFallback(mensaje);

  const respuestas: Record<Intencion, string> = {
    confirmar_difusion: "Recepcion confirmada. Te esperamos en los dias indicados. Recorda tener el bidon listo.",
    reclamo: "Tomamos nota de tu reclamo. Ya le avisamos al equipo para que lo resuelvan lo antes posible.",
    aviso: "Registramos tu aviso. Le vamos a avisar al recolector de tu zona.",
    consulta: "Recibimos tu consulta. Te respondemos a la brevedad.",
    baja: "Lamentamos que quieras dejar de participar. Una persona de nuestro equipo se va a comunicar con vos.",
    hablar_persona: "Tu mensaje fue derivado a nuestro equipo. Una persona se va a comunicar con vos a la brevedad.",
    saludo: "Hola! Soy el asistente de GARYCIO. En que te puedo ayudar?\n\n*1* - Tengo un reclamo\n*2* - Quiero dar un aviso\n*3* - Otra consulta",
    agradecimiento: "",
    irrelevante: "",
    menu_opcion: "En que te puedo ayudar?\n\n*1* - Tengo un reclamo\n*2* - Quiero dar un aviso\n*3* - Otra consulta",
  };

  return {
    intencion,
    respuesta: respuestas[intencion],
    urgencia: intencion === "reclamo" ? "media" : undefined,
  };
}

function clasificarFallback(mensaje: string): Intencion {
  const lower = mensaje.trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  if (/^[1-4]$/.test(lower)) return "menu_opcion";

  const titulos = ["tengo un reclamo", "dar un aviso", "otra consulta", "panel de admin", "confirmar recepcion"];
  if (titulos.includes(lower)) return "menu_opcion";

  // Confirmaciones de difusión flexibles
  if (["recibido", "confirmo", "entendido", "recibi", "confirmado"].includes(lower)) return "confirmar_difusion";
  if (/^[,.\s]*1[,.\s]*(recibido|recibi|ok|si|listo|gracias|dale|bueno|bien|confirmado|confirmo|mensaje|el mensaje)?/i.test(lower)) return "confirmar_difusion";

  const reclamoPatterns = [
    "no pasaron", "no vinieron", "no paso", "no vino",
    "no recolectaron", "no me recolectaron", "falta el bidon",
    "reclamo", "queja", "el camion no paso", "no pasaron por mi casa",
    "no vinieron a buscar", "bidon sucio", "pelela",
  ];
  if (reclamoPatterns.some((p) => lower.includes(p))) return "reclamo";

  const bajaPatterns = [
    "darme de baja", "quiero bajar", "dejar de donar",
    "no quiero donar", "no voy a donar", "dame de baja",
    "cancelar", "no participo",
  ];
  if (bajaPatterns.some((p) => lower.includes(p))) return "baja";

  const personaPatterns = [
    "hablar con una persona", "hablar con alguien",
    "quiero un humano", "atencion humana",
  ];
  if (personaPatterns.some((p) => lower.includes(p))) return "hablar_persona";

  const avisoPatterns = [
    "vacaciones", "suspender", "no voy a estar",
    "enferm", "mudanza", "cambio de direccion", "cambio de telefono",
    "me mude", "no estoy",
  ];
  if (avisoPatterns.some((p) => lower.includes(p))) return "aviso";

  if (/^(gracias?|muchas gracias|mil gracias|ok gracias|perfecto gracias)$/i.test(lower)) return "agradecimiento";
  if (/^(hola|ola|buen ?dia|buenos ?dias|buenas ?(tardes|noches))$/i.test(lower)) return "saludo";
  if (/^(ok|okey|oki|dale|bueno|bien|listo|si|no|ya|jaja|jeje|jejeje|jajaja)$/i.test(lower)) return "irrelevante";
  if (/^[\p{Emoji_Presentation}\p{Emoji}\uFE0F\u200D]{1,6}$/u.test(lower)) return "irrelevante";

  return "consulta";
}
