/**
 * Script para importar donantes desde el Excel real (F91 corregido.xlsx).
 *
 * Columnas del Excel:
 * ID, Nombre, Apellido, DNI, Fecha de nacimiento, Celular,
 * Calle, Número, Entrecalle 1, Entrecalle 2, Localidad, Provincia,
 * Latitud, Longitud, Fecha de Alta
 *
 * Uso: npx tsx scripts/importar-donantes-excel.ts <archivo.xlsx>
 */

import XLSX from "xlsx";
import { db } from "../src/database";
import { donantes, zonas } from "../src/database/schema";
import { eq } from "drizzle-orm";
import { logger } from "../src/config/logger";

// ── Mapeo de localidad → zona ──
// Basado en el mapa "F91 ZONA SUR" con ~8400 donantes
const LOCALIDAD_ZONA: Record<string, string> = {
  "rafael calzada": "Zona Sur - Rafael Calzada",
  "san francisco solano": "Zona Sur - San Fco. Solano",
  "temperley": "Zona Sur - Temperley",
  "monte chingolo": "Zona Sur - Monte Chingolo",
  "san josé": "Zona Sur - San José",
  "josé mármol": "Zona Sur - José Mármol",
  "claypole": "Zona Sur - Claypole",
  "lomas de zamora": "Zona Sur - Lomas de Zamora",
  "lanús": "Zona Sur - Lanús",
  "banfield": "Zona Sur - Banfield",
  "remedios de escalada": "Zona Sur - Escalada",
  "gerli": "Zona Sur - Gerli",
  "gdor. costa": "Zona Sur - Gdor. Costa",
};

function normalizarTelefono(celular: string): string {
  if (!celular) return "";
  // Limpiar: dejar solo dígitos
  let tel = celular.toString().replace(/\D/g, "");

  // Si empieza con 54, ya tiene código de país
  if (tel.startsWith("54")) return tel;

  // Si empieza con 15 (formato viejo), quitar el 15 y agregar 5411
  if (tel.startsWith("15") && tel.length === 10) {
    return `5411${tel.slice(2)}`;
  }

  // Si tiene 10 dígitos y empieza con 11 (Buenos Aires)
  if (tel.length === 10 && tel.startsWith("11")) {
    return `54${tel}`;
  }

  // Si tiene 8 dígitos (número local sin código de área)
  if (tel.length === 8) {
    return `5411${tel}`;
  }

  // Default: agregar 54 (código país Argentina)
  return `54${tel}`;
}

function construirDireccion(
  calle: string,
  numero: string,
  entrecalle1: string,
  entrecalle2: string,
  localidad: string,
  provincia: string,
): string {
  let dir = `${calle} ${numero}`.trim();
  if (entrecalle1) {
    const e1 = entrecalle1.replace(/^Y\s+/i, "").trim();
    dir += `, entre ${e1}`;
    if (entrecalle2) {
      const e2 = entrecalle2.replace(/^Y\s+/i, "").trim();
      dir += ` y ${e2}`;
    }
  }
  if (localidad) dir += `, ${localidad}`;
  if (provincia) dir += `, ${provincia}`;
  return dir;
}

async function importar(): Promise<void> {
  const archivo = process.argv[2];
  if (!archivo) {
    console.log("Uso: npx tsx scripts/importar-donantes-excel.ts <archivo.xlsx>");
    console.log("Ejemplo: npx tsx scripts/importar-donantes-excel.ts 'F91 corregido.xlsx'");
    process.exit(1);
  }

  console.log(`\n📂 Leyendo: ${archivo}`);
  const workbook = XLSX.readFile(archivo);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);
  console.log(`   ${rows.length} filas encontradas\n`);

  // 1. Crear zonas necesarias
  const zonasCreadas = new Map<string, number>();
  const localidades = new Set<string>();

  for (const row of rows) {
    const localidad = (row["Localidad"] || "").toString().trim().toLowerCase();
    if (localidad) localidades.add(localidad);
  }

  for (const loc of localidades) {
    const nombreZona = LOCALIDAD_ZONA[loc] || `Zona Sur - ${loc.charAt(0).toUpperCase() + loc.slice(1)}`;
    if (!zonasCreadas.has(nombreZona)) {
      // Verificar si ya existe
      const existing = await db
        .select({ id: zonas.id })
        .from(zonas)
        .where(eq(zonas.nombre, nombreZona))
        .limit(1);

      if (existing.length > 0) {
        zonasCreadas.set(nombreZona, existing[0].id);
      } else {
        const [z] = await db
          .insert(zonas)
          .values({ nombre: nombreZona, descripcion: `Zona automática: ${loc}` })
          .returning({ id: zonas.id });
        zonasCreadas.set(nombreZona, z.id);
      }
    }
  }
  console.log(`🗺️  ${zonasCreadas.size} zonas creadas/encontradas`);

  // 2. Importar donantes
  let importados = 0;
  let errores = 0;
  let sinTelefono = 0;
  let duplicados = 0;

  for (const row of rows) {
    const nombre = `${row["Nombre"] || ""} ${row["Apellido"] || ""}`.trim();
    const celular = (row["Celular"] || "").toString();
    const telefono = normalizarTelefono(celular);

    if (!telefono || telefono.length < 8) {
      sinTelefono++;
      continue;
    }

    const calle = (row["Calle"] || "").toString();
    const numero = (row["Número"] || row["Numero"] || "").toString();
    const entrecalle1 = (row["Entrecalle 1"] || "").toString();
    const entrecalle2 = (row["Entrecalle 2"] || "").toString();
    const localidad = (row["Localidad"] || "").toString().trim();
    const provincia = (row["Provincia"] || "").toString().trim();
    const lat = row["Latitud"] ? parseFloat(row["Latitud"].toString()) : null;
    const lon = row["Longitud"] ? parseFloat(row["Longitud"].toString()) : null;
    const fechaAlta = row["Fecha de Alta"] ? row["Fecha de Alta"].toString() : null;

    const direccion = construirDireccion(calle, numero, entrecalle1, entrecalle2, localidad, provincia);
    const localidadLower = localidad.toLowerCase();
    const nombreZona = LOCALIDAD_ZONA[localidadLower] || `Zona Sur - ${localidad}`;
    const zonaId = zonasCreadas.get(nombreZona) || null;

    try {
      await db.insert(donantes).values({
        nombre,
        telefono,
        direccion,
        zonaId,
        latitud: lat?.toString() || null,
        longitud: lon?.toString() || null,
        geocodificado: lat !== null && lon !== null,
        estado: "activa",
        donandoActualmente: true,
        fechaAlta: fechaAlta ? new Date(fechaAlta).toISOString().split("T")[0] : undefined,
      });
      importados++;
    } catch (err: any) {
      if (err.message?.includes("unique") || err.message?.includes("duplicate")) {
        duplicados++;
      } else {
        errores++;
        if (errores <= 5) {
          console.error(`  ❌ Error [${nombre}] (${telefono}): ${err.message}`);
        }
      }
    }

    // Progreso cada 500
    if ((importados + errores + duplicados + sinTelefono) % 500 === 0) {
      console.log(`  ... procesadas ${importados + errores + duplicados + sinTelefono} filas`);
    }
  }

  console.log(`\n✅ Importación completada:`);
  console.log(`   📥 Importados: ${importados}`);
  console.log(`   🔁 Duplicados (ya existían): ${duplicados}`);
  console.log(`   📵 Sin teléfono: ${sinTelefono}`);
  console.log(`   ❌ Errores: ${errores}`);
  console.log(`   📊 Total procesados: ${rows.length}`);

  process.exit(0);
}

importar().catch((err) => {
  console.error("Error fatal:", err);
  process.exit(1);
});
