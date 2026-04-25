/**
 * P0.5 — Mapper centralizado IA → enum DB.
 * La IA devuelve valores que NO existen en los enums de PostgreSQL.
 * Cualquier insert en DB debe pasar por estos mappers para evitar `invalid input value for enum`.
 */

import { z } from "zod";

export type TipoReclamoDB = "regalo" | "falta_bidon" | "nueva_pelela" | "otro";
export type TipoAvisoDB = "vacaciones" | "enfermedad" | "medicacion";

const RECLAMO_MAP: Record<string, TipoReclamoDB> = {
  regalo: "regalo",
  falta_bidon: "falta_bidon",
  falta_bidon_vacio: "falta_bidon",
  no_pasaron: "falta_bidon",
  pelela: "nueva_pelela",
  nueva_pelela: "nueva_pelela",
  bidon_sucio: "otro",
  otro: "otro",
};

const AVISO_MAP: Record<string, TipoAvisoDB | null> = {
  vacaciones: "vacaciones",
  enfermedad: "enfermedad",
  medicacion: "medicacion",
  // Valores IA que NO son ausencia (no deben insertarse como aviso)
  mudanza: null,
  cambio_direccion: null,
  cambio_telefono: null,
  general: null,
};

export function mapTipoReclamoIaToDb(value: string | undefined | null): TipoReclamoDB {
  if (!value) return "otro";
  const key = value.toLowerCase().trim();
  return RECLAMO_MAP[key] ?? "otro";
}

export function mapTipoAvisoIaToDb(value: string | undefined | null): TipoAvisoDB | null {
  if (!value) return null;
  const key = value.toLowerCase().trim();
  return AVISO_MAP[key] ?? null;
}

export const classifierResultSchema = z.object({
  intent: z.enum([
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
  ]),
  entities: z
    .array(z.object({ type: z.string(), value: z.string() }))
    .default([]),
  needsHuman: z.boolean().default(false),
  sentiment: z.enum(["calm", "frustrated", "angry"]).default("calm"),
  confidence: z.enum(["high", "medium", "low"]).default("low"),
});

export type ValidatedClassifierResult = z.infer<typeof classifierResultSchema>;
