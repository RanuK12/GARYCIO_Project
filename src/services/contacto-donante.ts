/**
 * Auto-registro de contacto de donantes y lookup de rol por teléfono.
 *
 * Cuando un donante envía un mensaje al bot:
 * - Si su teléfono ya está en la tabla donantes → actualiza updatedAt
 * - Si no existe → crea un registro mínimo con estado "nueva" para revisión admin
 *
 * lookupRolPorTelefono: dado un número, devuelve "chofer" | "peon" | "visitadora" | "admin" | "donante" | "desconocido"
 */

import { db } from "../database";
import { donantes, choferes, peones, visitadoras } from "../database/schema";
import { eq } from "drizzle-orm";
import { logger } from "../config/logger";
import { env } from "../config/env";

export type RolUsuario = "admin" | "chofer" | "peon" | "visitadora" | "donante" | "desconocido";

/**
 * Determina el rol de un número de teléfono consultando la DB.
 * Orden de prioridad: admin > chofer > peón > visitadora > donante > desconocido
 *
 * Nota: La consulta se hace en paralelo para minimizar latencia.
 */
export async function lookupRolPorTelefono(telefono: string): Promise<RolUsuario> {
  // Admin: solo env vars, sin DB
  const adminPhones = (env.ADMIN_PHONES || "").split(",").map((p) => p.trim()).filter(Boolean);
  if (adminPhones.includes(telefono) || telefono === env.CEO_PHONE) {
    return "admin";
  }

  // Consultar tablas de personal y donantes en paralelo
  const [chofer, peon, visitadora, donante] = await Promise.all([
    db.select({ id: choferes.id }).from(choferes).where(eq(choferes.telefono, telefono)).limit(1),
    db.select({ id: peones.id }).from(peones).where(eq(peones.telefono, telefono)).limit(1),
    db.select({ id: visitadoras.id }).from(visitadoras).where(eq(visitadoras.telefono, telefono)).limit(1),
    db.select({ id: donantes.id, estado: donantes.estado }).from(donantes).where(eq(donantes.telefono, telefono)).limit(1),
  ]);

  if (chofer.length > 0) return "chofer";
  if (peon.length > 0) return "peon";
  if (visitadora.length > 0) return "visitadora";
  if (donante.length > 0) return "donante";
  return "desconocido";
}

/**
 * Registra o actualiza el contacto de un donante cuando envía un mensaje.
 * No interfiere con el flujo normal del bot.
 */
export async function registrarContactoDonante(
  telefono: string,
  mensaje: string,
): Promise<{ esNuevo: boolean }> {
  // Buscar si ya existe en la tabla
  const existente = await db
    .select({ id: donantes.id, nombre: donantes.nombre })
    .from(donantes)
    .where(eq(donantes.telefono, telefono))
    .limit(1);

  if (existente.length > 0) {
    // Ya existe — actualizar timestamp de última interacción
    await db
      .update(donantes)
      .set({ updatedAt: new Date() })
      .where(eq(donantes.id, existente[0].id));

    return { esNuevo: false };
  }

  // No existe — verificar que no sea un chofer, peón, visitadora o admin
  // (evitar registrar personal operativo como donantes)
  if (await esNumeroOperativo(telefono)) {
    return { esNuevo: false };
  }

  // Crear registro mínimo con estado "nueva"
  await db.insert(donantes).values({
    nombre: "Contacto nuevo (pendiente)",
    telefono,
    direccion: "Por completar",
    estado: "nueva",
    donandoActualmente: false,
    notas: `Auto-registrado al contactar el bot. Primer mensaje: "${mensaje.slice(0, 100)}"`,
  });

  logger.info({ telefono }, "Nuevo contacto de donante registrado automáticamente");
  return { esNuevo: true };
}

/**
 * Verifica si un número pertenece al personal operativo (chofer, admin, etc.)
 * para evitar registrarlo como donante.
 */
async function esNumeroOperativo(telefono: string): Promise<boolean> {
  // Verificar contra admin phones
  const adminPhones = (env.ADMIN_PHONES || "").split(",").map((p) => p.trim());
  if (adminPhones.includes(telefono) || telefono === env.CEO_PHONE) {
    return true;
  }

  // Verificar contra tablas de personal operativo
  const [chofer] = await db.select({ id: choferes.id }).from(choferes).where(eq(choferes.telefono, telefono)).limit(1);
  if (chofer) return true;

  const [peon] = await db.select({ id: peones.id }).from(peones).where(eq(peones.telefono, telefono)).limit(1);
  if (peon) return true;

  const [visitadora] = await db.select({ id: visitadoras.id }).from(visitadoras).where(eq(visitadoras.telefono, telefono)).limit(1);
  if (visitadora) return true;

  return false;
}
