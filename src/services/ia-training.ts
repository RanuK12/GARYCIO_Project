/**
 * IA Training Service
 * 
 * Sistema de few-shot learning para el clasificador IA.
 * Permite cargar ejemplos de entrenamiento desde la DB
 * y usarlos en el prompt del clasificador.
 */

import { db } from "../database";
import { iaTrainingExamples } from "../database/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { logger } from "../config/logger";
import type { Intent } from "./clasificador-ia";

export interface TrainingExample {
  id: number;
  mensajeUsuario: string;
  intencionCorrecta: string;
  respuestaEsperada: string | null;
  contexto: string | null;
  prioridad: number;
}

// Cache en memoria (TTL 5 minutos)
let cache: TrainingExample[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Cargar ejemplos activos de entrenamiento.
 */
export async function loadTrainingExamples(): Promise<TrainingExample[]> {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_TTL) {
    return cache;
  }

  try {
    const rows = await db
      .select({
        id: iaTrainingExamples.id,
        mensajeUsuario: iaTrainingExamples.mensajeUsuario,
        intencionCorrecta: iaTrainingExamples.intencionCorrecta,
        respuestaEsperada: iaTrainingExamples.respuestaEsperada,
        contexto: iaTrainingExamples.contexto,
        prioridad: iaTrainingExamples.prioridad,
      })
      .from(iaTrainingExamples)
      .where(eq(iaTrainingExamples.activo, true))
      .orderBy(desc(iaTrainingExamples.prioridad), desc(iaTrainingExamples.createdAt))
      .limit(20);

    cache = rows.map((r) => ({
      id: r.id,
      mensajeUsuario: r.mensajeUsuario,
      intencionCorrecta: r.intencionCorrecta,
      respuestaEsperada: r.respuestaEsperada,
      contexto: r.contexto,
      prioridad: r.prioridad ?? 0,
    }));

    cacheTime = now;
    logger.debug({ count: cache.length }, "Ejemplos de entrenamiento cargados");
    return cache;
  } catch (err) {
    logger.error({ err }, "Error cargando ejemplos de entrenamiento");
    return [];
  }
}

/**
 * Invalidar cache (llamar después de agregar/modificar ejemplos).
 */
export function invalidateTrainingCache(): void {
  cache = null;
  cacheTime = 0;
  logger.info("Cache de entrenamiento invalidada");
}

/**
 * Formatear ejemplos para inyectar en el system prompt.
 */
export function formatTrainingForPrompt(examples: TrainingExample[]): string {
  if (examples.length === 0) return "";

  let prompt = "\n\n--- EJEMPLOS DE ENTRENAMIENTO ---\n";
  prompt += "Usá estos ejemplos para guiar tu clasificación:\n\n";

  for (const ex of examples) {
    prompt += `Mensaje: "${ex.mensajeUsuario}"\n`;
    prompt += `Intención: "${ex.intencionCorrecta}"\n`;
    if (ex.contexto) {
      prompt += `Contexto: ${ex.contexto}\n`;
    }
    prompt += "\n";
  }

  prompt += "--- FIN EJEMPLOS ---\n";
  return prompt;
}

/**
 * Agregar un nuevo ejemplo de entrenamiento.
 */
export async function addTrainingExample(data: {
  mensajeUsuario: string;
  intencionCorrecta: string;
  respuestaEsperada?: string;
  contexto?: string;
  prioridad?: number;
  creadoPor?: string;
}): Promise<number> {
  const [result] = await db
    .insert(iaTrainingExamples)
    .values({
      mensajeUsuario: data.mensajeUsuario,
      intencionCorrecta: data.intencionCorrecta,
      respuestaEsperada: data.respuestaEsperada ?? null,
      contexto: data.contexto ?? null,
      activo: true,
      prioridad: data.prioridad ?? 0,
      creadoPor: data.creadoPor ?? null,
    })
    .returning({ id: iaTrainingExamples.id });

  invalidateTrainingCache();
  logger.info({ id: result.id, intencion: data.intencionCorrecta }, "Ejemplo de entrenamiento agregado");
  return result.id;
}

/**
 * Listar ejemplos (con paginación).
 */
export async function listTrainingExamples(options?: {
  activo?: boolean;
  intencion?: string;
  limit?: number;
  offset?: number;
}): Promise<{ examples: TrainingExample[]; total: number }> {
  const conditions = [];
  if (options?.activo !== undefined) conditions.push(eq(iaTrainingExamples.activo, options.activo));
  if (options?.intencion) conditions.push(eq(iaTrainingExamples.intencionCorrecta, options.intencion));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const examples = await db
    .select({
      id: iaTrainingExamples.id,
      mensajeUsuario: iaTrainingExamples.mensajeUsuario,
      intencionCorrecta: iaTrainingExamples.intencionCorrecta,
      respuestaEsperada: iaTrainingExamples.respuestaEsperada,
      contexto: iaTrainingExamples.contexto,
      prioridad: iaTrainingExamples.prioridad,
    })
    .from(iaTrainingExamples)
    .where(whereClause)
    .orderBy(desc(iaTrainingExamples.prioridad), desc(iaTrainingExamples.createdAt))
    .limit(options?.limit ?? 50)
    .offset(options?.offset ?? 0);

  const [{ count: total }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(iaTrainingExamples)
    .where(whereClause);

  return {
    examples: examples.map((r) => ({
      id: r.id,
      mensajeUsuario: r.mensajeUsuario,
      intencionCorrecta: r.intencionCorrecta,
      respuestaEsperada: r.respuestaEsperada,
      contexto: r.contexto,
      prioridad: r.prioridad ?? 0,
    })),
    total: Number(total),
  };
}

/**
 * Activar/desactivar ejemplo.
 */
export async function toggleTrainingExample(id: number, activo: boolean): Promise<void> {
  await db.update(iaTrainingExamples).set({ activo }).where(eq(iaTrainingExamples.id, id));
  invalidateTrainingCache();
}

/**
 * Eliminar ejemplo.
 */
export async function deleteTrainingExample(id: number): Promise<void> {
  await db.delete(iaTrainingExamples).where(eq(iaTrainingExamples.id, id));
  invalidateTrainingCache();
}
