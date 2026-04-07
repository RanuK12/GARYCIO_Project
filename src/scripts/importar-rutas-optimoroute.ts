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
 * También lee routes.xls para obtener el horario estimado por donante.
 * routes.xls columnas: [2]=Apellido, [8]=Conductor, [10]=ProgramadoEn, [12]=NombreDonante
 *
 * Este script:
 *   1. Carga horarios de routes.xls (si existe)
 *   2. Parsea todos los CSVs
 *   3. Normaliza los teléfonos al formato WhatsApp (549XXXXXXXXXX)
 *   4. Genera un JSON consolidado con la asignación de ruta por donante
 *
 * Uso:
 *   npx tsx scripts/importar-rutas-optimoroute.ts [--dry-run]
 *
 *   --dry-run  Solo muestra resumen sin escribir nada
 */

import * as fs from "fs";
import * as path from "path";
import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";

// ── Configuración de archivos ────────────────────────────────────

const RUTAS_DIR = path.join(__dirname, "../../data/rutas");

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
  celular: string;           // formato original del CSV
  celularWhatsApp: string;   // formato 549XXXXXXXXXX
  calle: string;
  numero: string;
  entrecalle1: string;
  entrecalle2: string;
  localidad: string;
  provincia: string;
  latitud: string;
  longitud: string;
  sector: string;
  diasRecoleccion: string;   // "Lunes y Jueves", etc.
  chofer: number;             // 1, 2 o 3
  archivoOrigen: string;      // "LJ_1", etc.
  horarioEstimado: string | null; // "06:32" o null si no hay dato en routes.xls
}

export interface ResumenRutas {
  totalDonantes: number;
  porRuta: Record<string, number>;
  porChofer: Record<number, number>;
  sinTelefonoValido: number;
  duplicados: number;
  sinHorario: number;
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

// ── Carga de horarios desde routes.xls ──────────────────────────

/**
 * Convierte una fracción decimal de día de Excel a string "HH:MM".
 * Ej: 0.26927 → "06:28"
 */
function fraccionAHora(fraccion: number): string {
  const totalMinutos = Math.round(fraccion * 24 * 60);
  const h = Math.floor(totalMinutos / 60);
  const m = totalMinutos % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Lee routes.xls y retorna un Map con clave "nombre|apellido" (lowercase)
 * y valor la hora estimada de llegada en formato "HH:MM".
 *
 * Columnas del XLS:
 *   [2]  Ubicación (apellido)
 *   [8]  Conductor
 *   [10] Programado en (fracción de día)
 *   [12] Nombre Donante (nombre)
 */
export function cargarHorariosRoutes(): Map<string, string> {
  const xlsPath = path.join(RUTAS_DIR, "routes.xls");
  const horarios = new Map<string, string>();

  if (!fs.existsSync(xlsPath)) {
    console.warn("⚠️  routes.xls no encontrado — se enviarán mensajes sin horario individual");
    return horarios;
  }

  const workbook = XLSX.readFile(xlsPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  let cargados = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    const apellido = String(row[2] || "").trim();
    const nombre = String(row[12] || "").trim();
    const programado = row[10];

    if (!nombre || !apellido || typeof programado !== "number" || programado <= 0) continue;

    const key = `${nombre.toLowerCase()}|${apellido.toLowerCase()}`;
    horarios.set(key, fraccionAHora(programado));
    cargados++;
  }

  console.log(`📅 Horarios cargados desde routes.xls: ${cargados}`);
  return horarios;
}

// ── Parser de CSV ────────────────────────────────────────────────

function parsearCSV(archivo: string, horarios: Map<string, string>): DonantesRuta[] {
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

    const nombre = record["Nombre"] || "";
    const apellido = record["Apellido"] || "";
    const key = `${nombre.toLowerCase()}|${apellido.toLowerCase()}`;
    const horarioEstimado = horarios.get(key) ?? null;

    result.push({
      id: record["ID"] || "",
      nombre,
      apellido,
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
      horarioEstimado,
    });
  }

  return result;
}

// ── Función principal de importación ──────────────────────────────

export function importarRutas(): ResumenRutas {
  const horarios = cargarHorariosRoutes();
  const todos: DonantesRuta[] = [];

  for (const archivo of ARCHIVOS) {
    const donantes = parsearCSV(archivo, horarios);
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
  const sinHorario = unicos.filter((d) => !d.horarioEstimado).length;

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
    sinHorario,
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
  console.log(`Sin horario estimado: ${resumen.sinHorario}`);
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

  // Muestra de donantes con horario
  console.log("\n📋 Primeros 5 registros:");
  for (const d of resumen.donantes.slice(0, 5)) {
    const horario = d.horarioEstimado ? `⏰ ${d.horarioEstimado}` : "⏰ sin horario";
    console.log(`  ${d.nombre} ${d.apellido} | ${d.celularWhatsApp} | ${d.diasRecoleccion} | Chofer #${d.chofer} | ${horario}`);
  }
}
