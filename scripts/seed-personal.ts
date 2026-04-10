/**
 * Seed del personal operativo: choferes y peones.
 * Usar con: npx ts-node scripts/seed-personal.ts
 *
 * - Usa onConflictDoUpdate para que sea idempotente (se puede correr varias veces sin duplicar)
 * - Los teléfonos se normalizan: se saca el "+" para coincidir con el formato del bot
 *
 * ADMINS (van en .env, no en DB):
 *   CEO_PHONE=5491126330388       → Stefano Gargiulo
 *   ADMIN_PHONES=5491126330388,393445721753  → Stefano + Emilio Ranucoli
 */

import { config } from "dotenv";
config();

import { db } from "../src/database";
import { choferes, peones } from "../src/database/schema";
import { sql } from "drizzle-orm";

// ── Normaliza teléfono: saca el + inicial ─────────────────
function tel(raw: string): string {
  return raw.replace(/^\+/, "").trim();
}

// ════════════════════════════════════════════
// CHOFERES
// ════════════════════════════════════════════
const CHOFERES = [
  { id: 1, nombre: "JAIME BARRIOS",  telefono: tel("+5491132425209") },
  { id: 2, nombre: "MATIAS BIELIK",  telefono: tel("+5491158599344") },
  { id: 3, nombre: "CARLOS VERA",    telefono: tel("+5491166044005") },
];

// ════════════════════════════════════════════
// PEONES
// ════════════════════════════════════════════
const PEONES = [
  { id: 1,  nombre: "GUSTAVO CEJAS",       telefono: tel("+5491128989410") },
  { id: 2,  nombre: "CLAUDIO VELAZQUEZ",   telefono: tel("+5491171276920") },
  { id: 3,  nombre: "CRISTIAN CARBALLO",   telefono: tel("+5491131696780") },
  { id: 4,  nombre: "FRANCO CHAVEZ",       telefono: tel("+5491169646026") },
  { id: 5,  nombre: "AARON CORREA",        telefono: tel("+5491167332164") },
  { id: 6,  nombre: "JULIAN MONTEMURRO",   telefono: tel("+5491167854816") },
  { id: 7,  nombre: "FABIAN OJEDA",        telefono: tel("+5491124754948") },
  { id: 8,  nombre: "KEVIN ARAGON",        telefono: tel("+5491161017127") },
  { id: 9,  nombre: "CIRO CAMPERO",        telefono: tel("+5491170820400") },
  { id: 10, nombre: "CRISTIAN GUERRERO",   telefono: tel("+5491125665496") },
];

async function main() {
  console.log("🌱 Iniciando seed de personal operativo...\n");

  // ── Choferes ─────────────────────────────
  console.log("🚛 Cargando choferes...");
  for (const c of CHOFERES) {
    await db
      .insert(choferes)
      .values({ nombre: c.nombre, telefono: c.telefono, activo: true })
      .onConflictDoUpdate({
        target: choferes.telefono,
        set: { nombre: c.nombre, activo: true },
      });
    console.log(`  ✓ Chofer ${c.id}: ${c.nombre} (${c.telefono})`);
  }

  // ── Peones ───────────────────────────────
  console.log("\n👷 Cargando peones...");
  for (const p of PEONES) {
    await db
      .insert(peones)
      .values({ nombre: p.nombre, telefono: p.telefono, activo: true })
      .onConflictDoUpdate({
        target: peones.telefono,
        set: { nombre: p.nombre, activo: true },
      });
    console.log(`  ✓ Peón ${p.id}: ${p.nombre} (${p.telefono})`);
  }

  // ── Resumen ──────────────────────────────
  const [totalChoferes] = await db.execute(sql`SELECT COUNT(*) FROM choferes WHERE activo = true`);
  const [totalPeones]   = await db.execute(sql`SELECT COUNT(*) FROM peones   WHERE activo = true`);

  console.log("\n✅ Seed completado:");
  console.log(`   Choferes activos: ${(totalChoferes as any).count}`);
  console.log(`   Peones activos:   ${(totalPeones as any).count}`);
  console.log("\n🔑 Números ya reconocidos por el bot al primer mensaje:");
  [...CHOFERES, ...PEONES].forEach(p => console.log(`   ${p.telefono}`));

  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Error en seed:", err);
  process.exit(1);
});
