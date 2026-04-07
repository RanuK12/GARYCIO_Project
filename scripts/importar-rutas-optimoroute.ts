/**
 * Script para importar las rutas de OptimoRoute desde los CSVs.
 *
 * Los archivos siguen la convención: {DIAS}_{CHOFER}.csv
 *   - LJ = Lunes y Jueves
 *   - MS = Martes y Sábado
 *   - MV = Miércoles y Viernes
 *   - 1, 2, 3 = número de chofer/camión
 *
 * Cada CSV tiene columnas:
 *   X, Y, ID, Nombre, Apellido, [Fecha de nacimiento], Celular,
 *   Calle, Número, Entrecalle 1, Entrecalle 2, Localidad, Provincia,
 *   Latitud, Longitud, Sector
 *
 * Este script:
 *   1. Parsea todos los CSVs
 *   2. Normaliza los teléfonos al formato WhatsApp (549XXXXXXXXXX)
 *   3. Genera un JSON consolidado con la asignación de ruta por donante
 *   4. Opcionalmente, inserta/actualiza donantes en la DB
 *
 * Uso:
 *   npx tsx scripts/importar-rutas-optimoroute.ts [--dry-run] [--db]
 *
 *   --dry-run  Solo muestra resumen sin escribir nada
 *   --db       Actualiza la tabla donantes con días de recolección y chofer
 */

import * as fs from "fs";
import * as path from "path";
import { parse } from "csv-parse/sync";

// ── Configuración de archivos ────────────────────────────────────

const RUTAS_DIR = path.join(__dirname, "../data/rutas");

const DIAS_MAP: Record<string, string> = {
  LJ: "Lunes y Jueves",
  MS: "Martes y Sábado",
  MV: "Miércoles y Viernes",
};

const ARCHIVOS = [
  "LJ_1", "LJ_2", "LJ_3",
  "MS_1", "MS_2", "MS_3",
  "MV_1", "MV_2", "MV_3",
];

// Columnas estándar (algunos CSVs no tienen "Fecha de nacimiento")
const COLS_WITH_BIRTH = [
  "X", "Y", "ID", "Nombre", "Apellido", "Fecha de nacimiento",
  "Celular", "Calle", "Número", "Entrecalle 1", "Entrecalle 2",
  "Localidad", "Provincia", "Latitud", "Longitud", "Sector",
];
const COLS_WITHOUT_BIRTH = [
  "X", "Y", "ID", "Nombre", "Apellido",
  "Celular", "Calle", "Número", "Entrecalle 1", "Entrecalle 2",
  "Localidad", "Provincia", "Latitud", "Longitud", "Sector",
];

// ── Interfaces ────────────────────────────────────────────────────

export interface DonantesRuta {
  id: string;
  nombre: string;
  apellido: string;
  celular: string;         // formato original del CSV
  celularWhatsApp: string;  // formato 549XXXXXXXXXX
  calle: string;
  numero: string;
  entrecalle1: string;
  entrecalle2: string;
  localidad: string;
  provincia: string;
  latitud: string;
  longitud: string;
  sector: string;
  diasRecoleccion: string;  // "Lunes y Jueves", etc.
  chofer: number;            // 1, 2 o 3
  archivoOrigen: string;     // "LJ_1", etc.
}

export interface ResumenRutas {
  totalDonantes: number;
  porRuta: Record<string, number>;
  porChofer: Record<number, number>;
  sinTelefonoValido: number;
  duplicados: number;
  donantes: DonantesRuta[];
}

// ── Normalización de teléfono ────────────────────────────────────

export function normalizarTelefono(celular: string): string | null {
  if (!celular) return null;

  // Limpiar todo excepto dígitos
  let num = celular.replace(/\D/g, "");

  // Si ya empieza con 549 y tiene 13 dígitos → OK
  if (num.startsWith("549") && num.length === 13) return num;

  // Si empieza con 54 pero no 549, agregar 9
  if (num.startsWith("54") && !num.startsWith("549")) {
    num = "549" + num.slice(2);
    if (num.length === 13) return num;
  }

  // Si empieza con 15 (prefijo local celular), reemplazar por 11
  if (num.startsWith("15") && num.length === 10) {
    num = "11" + num.slice(2);
  }

  // Si tiene 10 dígitos (formato local celular: 11XXXXXXXX)
  if (num.length === 10) {
    return "549" + num;
  }

  // Si tiene 8 dígitos (fijo de Buenos Aires), agregar 11
  if (num.length === 8) {
    return "54911" + num;
  }

  // Intentar con solo los últimos 10 dígitos
  if (num.length > 10) {
    const last10 = num.slice(-10);
    return "549" + last10;
  }

  return null;
}

// ── Parser de CSV ────────────────────────────────────────────────

function detectarColumnas(firstRow: string[]): string[] {
  // Si la primera celda es un número negativo (coordenada), no tiene header
  if (firstRow[0] && /^-?\d+/.test(firstRow[0]) && firstRow.length <= 16) {
    return firstRow.length === 16 ? COLS_WITH_BIRTH : COLS_WITHOUT_BIRTH;
  }
  return firstRow;
}

function parsearCSV(archivo: string): DonantesRuta[] {
  const filePath = path.join(RUTAS_DIR, `${archivo}.csv`);

  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  Archivo no encontrado: ${filePath}`);
    return [];
  }

  const contenido = fs.readFileSync(filePath, "utf-8");
  const [prefijoDias, choferStr] = archivo.split("_");
  const diasRecoleccion = DIAS_MAP[prefijoDias] || prefijoDias;
  const chofer = parseInt(choferStr, 10);

  // Parsear todo como registros
  const allRows: string[][] = parse(contenido, {
    skip_empty_lines: true,
    relax_column_count: true,
  });

  if (allRows.length === 0) return [];

  // Detectar si tiene header
  const firstRow = allRows[0];
  const hasHeader = firstRow[0] === "X" || firstRow[0] === "x";

  let columns: string[];
  let dataRows: string[][];

  if (hasHeader) {
    columns = firstRow;
    dataRows = allRows.slice(1);
  } else {
    // Sin header → asignar columnas por cantidad
    columns = firstRow.length >= 16 ? COLS_WITH_BIRTH : COLS_WITHOUT_BIRTH;
    dataRows = allRows;
  }

  const result: DonantesRuta[] = [];

  for (const row of dataRows) {
    const record: Record<string, string> = {};
    for (let i = 0; i < columns.length && i < row.length; i++) {
      record[columns[i]] = (row[i] || "").trim();
    }

    const celular = record["Celular"] || "";
    const celularWhatsApp = normalizarTelefono(celular);

    result.push({
      id: record["ID"] || "",
      nombre: record["Nombre"] || "",
      apellido: record["Apellido"] || "",
      celular,
      celularWhatsApp: celularWhatsApp || "",
      calle: record["Calle"] || "",
      numero: record["Número"] || "",
      entrecalle1: record["Entrecalle 1"] || "",
      entrecalle2: record["Entrecalle 2"] || "",
      localidad: record["Localidad"] || "",
      provincia: record["Provincia"] || "",
      latitud: record["Latitud"] || record["Y"] || "",
      longitud: record["Longitud"] || record["X"] || "",
      sector: record["Sector"] || "",
      diasRecoleccion,
      chofer,
      archivoOrigen: archivo,
    });
  }

  return result;
}

// ── Función principal de importación ──────────────────────────────

export function importarRutas(): ResumenRutas {
  const todos: DonantesRuta[] = [];

  for (const archivo of ARCHIVOS) {
    const donantes = parsearCSV(archivo);
    console.log(`📂 ${archivo}: ${donantes.length} donantes`);
    todos.push(...donantes);
  }

  // Deduplicar por teléfono WhatsApp (una donante puede aparecer si se duplicó un CSV)
  const vistos = new Set<string>();
  const unicos: DonantesRuta[] = [];
  let duplicados = 0;

  for (const d of todos) {
    if (!d.celularWhatsApp) continue;
    if (vistos.has(d.celularWhatsApp)) {
      duplicados++;
      continue;
    }
    vistos.add(d.celularWhatsApp);
    unicos.push(d);
  }

  const sinTelefono = todos.filter((d) => !d.celularWhatsApp).length;

  // Resumen por ruta y chofer
  const porRuta: Record<string, number> = {};
  const porChofer: Record<number, number> = {};

  for (const d of unicos) {
    porRuta[d.archivoOrigen] = (porRuta[d.archivoOrigen] || 0) + 1;
    porChofer[d.chofer] = (porChofer[d.chofer] || 0) + 1;
  }

  return {
    totalDonantes: unicos.length,
    porRuta,
    porChofer,
    sinTelefonoValido: sinTelefono,
    duplicados,
    donantes: unicos,
  };
}

// ── CLI ─────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");

  console.log("🚛 Importando rutas de OptimoRoute...\n");

  const resumen = importarRutas();

  console.log("\n════════════════════════════════════════");
  console.log("📊 RESUMEN DE IMPORTACIÓN");
  console.log("════════════════════════════════════════");
  console.log(`Total donantes únicos: ${resumen.totalDonantes}`);
  console.log(`Sin teléfono válido: ${resumen.sinTelefonoValido}`);
  console.log(`Duplicados descartados: ${resumen.duplicados}`);
  console.log("\nPor ruta:");
  for (const [ruta, count] of Object.entries(resumen.porRuta)) {
    const [dias, chofer] = ruta.split("_");
    console.log(`  ${DIAS_MAP[dias]} - Chofer #${chofer}: ${count} donantes`);
  }
  console.log("\nPor chofer:");
  for (const [chofer, count] of Object.entries(resumen.porChofer)) {
    console.log(`  Chofer #${chofer}: ${count} donantes`);
  }

  // Guardar JSON consolidado
  const outputPath = path.join(RUTAS_DIR, "rutas-consolidadas.json");

  if (!isDryRun) {
    fs.writeFileSync(outputPath, JSON.stringify(resumen, null, 2));
    console.log(`\n✅ JSON guardado en: ${outputPath}`);
  } else {
    console.log("\n🔍 Modo dry-run — no se escribió nada.");
  }

  // Muestra de donantes
  console.log("\n📋 Primeros 5 registros:");
  for (const d of resumen.donantes.slice(0, 5)) {
    console.log(`  ${d.nombre} ${d.apellido} | ${d.celularWhatsApp} | ${d.diasRecoleccion} | Chofer #${d.chofer}`);
  }
}
