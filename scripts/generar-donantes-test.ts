/**
 * Genera un CSV de 1000 donantes de prueba con datos realistas de Buenos Aires
 * y un script SQL/seed para cargarlos en la base de datos.
 */
import fs from "fs";
import path from "path";

// ── Datos base para generación ──────────────────────────

const NOMBRES = [
  "Marta", "Silvia", "Carmen", "Laura", "Ana", "Beatriz", "Teresa", "Susana",
  "Juana", "Graciela", "Rosa", "Elena", "Mónica", "Liliana", "Norma", "Patricia",
  "Mirta", "Gladys", "Alicia", "Noemí", "Claudia", "Stella", "Lidia", "Elsa",
  "Nélida", "Estela", "Adriana", "Cecilia", "Irene", "Margarita", "Nora", "Alejandra",
  "Inés", "Gloria", "Raquel", "Silvana", "Marcela", "Verónica", "Andrea", "Lucía",
  "Victoria", "Dolores", "Josefina", "Cristina", "Mariana", "Paula", "Julieta", "Florencia",
  "Romina", "Lorena", "María", "Daniela", "Carolina", "Gabriela", "Fernanda", "Valeria",
  "Natalia", "Soledad", "Yanina", "Viviana", "Sandra", "Carina", "Paola", "Roxana",
  "Débora", "Mariela", "Verónica", "Noelia", "Vanesa", "Fabiana", "Silvina", "Marina",
  "Eugenia", "Gisela", "Karina", "Lorena", "Betina", "Analía", "Sonia", "Edith",
  "Olga", "Dora", "Mabel", "Hilda", "Elvira", "Amelia", "Blanca", "Catalina",
  "Delia", "Elisa", "Flora", "Haydée", "Iris", "Julia", "Leonor", "Mercedes",
];

const APELLIDOS = [
  "Rossi", "Gómez", "López", "Fernández", "Martínez", "Suárez", "Romero", "Alonso",
  "Torres", "Silva", "Domínguez", "Ruiz", "Giménez", "Blanco", "Medina", "Vargas",
  "Castro", "Ortiz", "Cabrera", "Ríos", "Luna", "Vega", "Peralta", "Navarro",
  "Quiroga", "Paz", "Herrera", "Bustos", "Flores", "Mansilla", "Farias", "Correa",
  "Acosta", "Ponce", "Lucero", "Moyano", "Ibarra", "Rojas", "Molina", "Godoy",
  "Arce", "Varela", "Quintana", "Soria", "Cruz", "Aguilar", "Castillo", "Díaz",
  "González", "Rodríguez", "Pérez", "García", "Sánchez", "Ramírez", "Romero", "Torres",
  "Álvarez", "Moreno", "Benítez", "Figueroa", "Gutiérrez", "Juárez", "Ledesma", "Aguirre",
  "Ojeda", "Villalba", "Cardozo", "Soto", "Arias", "Vera", "Mendoza", "Ramos",
  "Muñoz", "Núñez", "Rojas", "Cáceres", "Ortega", "Fuentes", "Paredes", "Bravo",
  "Miranda", "Carrizo", "Ávila", "Escobar", "Contreras", "Palacios", "Chávez", "Córdoba",
  "Rolón", "Maidana", "Duarte", "Cabral", "Acuña", "Leiva", "Báez", "Alderete",
];

// Calles por zona (realistas de Buenos Aires y GBA)
const CALLES_POR_ZONA: Record<string, string[]> = {
  "1": [ // CABA Centro-Norte
    "Av. Rivadavia", "Av. Corrientes", "Av. Santa Fe", "Av. Callao", "Av. Pueyrredón",
    "Viamonte", "Lavalle", "Tucumán", "Suipacha", "Esmeralda", "Maipú", "Florida",
    "Av. de Mayo", "Hipólito Yrigoyen", "Alsina", "Moreno", "Belgrano", "Venezuela",
    "México", "Chile", "Independencia", "San Juan", "Humberto Primo", "Carlos Calvo",
    "Av. Entre Ríos", "Av. 9 de Julio", "Lima", "Bernardo de Irigoyen", "Tacuarí",
    "Piedras", "Chacabuco", "Defensa", "Bolívar", "Perú", "Av. Paseo Colón",
  ],
  "2": [ // CABA Palermo-Belgrano + Vicente López + San Isidro
    "Av. Libertador", "Av. Cabildo", "Av. del Barco Centenera", "Av. Las Heras",
    "Juramento", "Monroe", "Congreso", "Triunvirato", "Álvarez Thomas",
    "Forest", "Lacroze", "Dorrego", "Av. Córdoba", "Jorge Newbery", "Av. Elcano",
    "Av. Federico Lacroze", "Olazábal", "Blanco Encalada", "Mendoza", "Echeverría",
    "Av. Maipú", "Av. del Libertador", "Av. Centenario", "Av. Santa Fe", "Pedraza",
    "Vuelta de Obligado", "La Pampa", "Av. Figueroa Alcorta", "Ciudad de la Paz", "Moldes",
  ],
  "3": [ // CABA Palermo-Villa Crespo-Caballito
    "Niceto Vega", "Scalabrini Ortiz", "Malabia", "Armenia", "Thames",
    "Serrano", "Gurruchaga", "Borges", "Honduras", "Gorriti", "Cabrera", "Soler",
    "Güemes", "Arenales", "Juncal", "Mansilla", "Charcas", "Paraguay",
    "Av. Juan B. Justo", "Av. Gaona", "Av. San Martín", "Av. Ángel Gallardo",
    "Av. La Plata", "Av. Boedo", "Av. Castro Barros", "Av. Díaz Vélez",
    "Av. Rivadavia", "Av. Acoyte", "Yerbal", "Rojas", "Neuquén", "Hidalgo",
  ],
  "4": [ // GBA Sur - Avellaneda, Lanús, Quilmes
    "Av. Mitre", "San Martín", "Belgrano", "Alsina", "Sarmiento",
    "Colón", "Italia", "España", "Güemes", "25 de Mayo", "Rivadavia",
    "Av. H. Yrigoyen", "Av. Pavón", "Av. Galicia", "Av. Remedios de Escalada",
    "Laprida", "Montes de Oca", "Brandsen", "Olavarría", "Pinzón",
    "Av. Centenario", "Dr. Machado", "Av. San Martín", "French", "Las Flores",
    "Almafuerte", "Ceballos", "Alem", "Balcarce", "Brown", "Paso", "Constitución",
  ],
};

const LOCALIDADES_POR_ZONA: Record<string, string[]> = {
  "1": ["CABA", "CABA", "CABA", "CABA", "CABA"],
  "2": ["CABA", "CABA", "Vicente López", "San Isidro", "Olivos", "Martínez"],
  "3": ["CABA", "CABA", "CABA", "CABA"],
  "4": ["Avellaneda", "Lanús", "Quilmes", "Banfield", "Lomas de Zamora", "Remedios de Escalada"],
};

const SUB_ZONAS = ["A", "B"];
const DIAS: Record<string, string> = { A: "L-X-V", B: "M-J-S" };
const HORARIOS = ["Mañana", "Tarde"];

// ── Generador ─────────────────────────────────────────

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generarTelefono(index: number): string {
  // Generar teléfonos argentinos realistas
  const prefijos = ["1122", "1133", "1144", "1155", "1166", "1177", "1134", "1156", "1145", "1167"];
  const prefijo = prefijos[index % prefijos.length];
  const numero = String(100000 + (index * 7 + 31) % 900000).padStart(6, "0");
  return `54${prefijo}${numero}`;
}

interface DonanteLine {
  id: number;
  nombre: string;
  direccion: string;
  localidad: string;
  zona: string;
  dias: string;
  horario: string;
  telefono: string;
}

function generarDonantes(cantidad: number): DonanteLine[] {
  const donantes: DonanteLine[] = [];
  const telefonosUsados = new Set<string>();

  for (let i = 0; i < cantidad; i++) {
    const zonaNum = String((i % 4) + 1);
    const subZona = SUB_ZONAS[Math.floor(i / 4) % 2];
    const zona = `${zonaNum}${subZona}`;

    const nombre = `${rand(NOMBRES)} ${rand(APELLIDOS)}`;
    const calle = rand(CALLES_POR_ZONA[zonaNum]);
    const altura = randInt(100, 8000);
    const direccion = `${calle} ${altura}`;
    const localidad = rand(LOCALIDADES_POR_ZONA[zonaNum]);

    let telefono = generarTelefono(i);
    while (telefonosUsados.has(telefono)) {
      telefono = generarTelefono(i + randInt(1000, 9999));
    }
    telefonosUsados.add(telefono);

    donantes.push({
      id: 1001 + i,
      nombre,
      direccion,
      localidad,
      zona,
      dias: DIAS[subZona],
      horario: rand(HORARIOS),
      telefono,
    });
  }

  return donantes;
}

// ── Generar archivos ────────────────────────────────────

const donantes = generarDonantes(1000);
const outputDir = path.join(process.cwd(), "test-data");
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

// 1. CSV
const csvHeader = "ID_Donante,Nombre_Apellido,Telefono,Direccion,Localidad,Zona_Asignada,Dias_Recoleccion,Horario_Historico";
const csvLines = donantes.map((d) =>
  `${d.id},${d.nombre},${d.telefono},"${d.direccion}",${d.localidad},${d.zona},${d.dias},${d.horario}`,
);
const csvContent = [csvHeader, ...csvLines].join("\n");
const csvPath = path.join(outputDir, "donantes-test-1000.csv");
fs.writeFileSync(csvPath, csvContent, "utf-8");

// 2. SQL seed para insertar directo en PostgreSQL
const sqlLines: string[] = [
  "-- ============================================================",
  "-- Seed de 1000 donantes de prueba para GARYCIO",
  `-- Generado: ${new Date().toISOString()}`,
  "-- ============================================================",
  "",
  "-- Primero crear las zonas si no existen",
  "INSERT INTO zonas (nombre, descripcion) VALUES",
  "  ('Zona 1', 'CABA Centro-Norte'),",
  "  ('Zona 2', 'CABA Palermo-Belgrano y zona norte GBA'),",
  "  ('Zona 3', 'CABA Palermo-Villa Crespo-Caballito'),",
  "  ('Zona 4', 'GBA Sur - Avellaneda, Lanús, Quilmes')",
  "ON CONFLICT DO NOTHING;",
  "",
  "-- Sub-zonas",
  "INSERT INTO sub_zonas (zona_id, codigo, nombre, dias_recoleccion) VALUES",
  "  (1, '1A', 'Zona 1 - Sub-zona A', 'Lunes, Miércoles, Viernes'),",
  "  (1, '1B', 'Zona 1 - Sub-zona B', 'Martes, Jueves, Sábado'),",
  "  (2, '2A', 'Zona 2 - Sub-zona A', 'Lunes, Miércoles, Viernes'),",
  "  (2, '2B', 'Zona 2 - Sub-zona B', 'Martes, Jueves, Sábado'),",
  "  (3, '3A', 'Zona 3 - Sub-zona A', 'Lunes, Miércoles, Viernes'),",
  "  (3, '3B', 'Zona 3 - Sub-zona B', 'Martes, Jueves, Sábado'),",
  "  (4, '4A', 'Zona 4 - Sub-zona A', 'Lunes, Miércoles, Viernes'),",
  "  (4, '4B', 'Zona 4 - Sub-zona B', 'Martes, Jueves, Sábado')",
  "ON CONFLICT DO NOTHING;",
  "",
  "-- Donantes",
  "INSERT INTO donantes (nombre, telefono, direccion, zona_id, sub_zona, dias_recoleccion, estado, donando_actualmente) VALUES",
];

const zonaIdMap: Record<string, number> = { "1": 1, "2": 2, "3": 3, "4": 4 };
const diasMap: Record<string, string> = {
  "L-X-V": "Lunes, Miércoles, Viernes",
  "M-J-S": "Martes, Jueves, Sábado",
};

for (let i = 0; i < donantes.length; i++) {
  const d = donantes[i];
  const zonaId = zonaIdMap[d.zona[0]];
  const diasFull = diasMap[d.dias] || d.dias;
  const sep = i < donantes.length - 1 ? "," : ";";
  const escapedDir = d.direccion.replace(/'/g, "''");
  const escapedNombre = d.nombre.replace(/'/g, "''");

  sqlLines.push(
    `  ('${escapedNombre}', '${d.telefono}', '${escapedDir}, ${d.localidad}', ${zonaId}, '${d.zona}', '${diasFull}', 'activa', true)${sep}`,
  );
}

sqlLines.push("");
sqlLines.push("-- Resumen:");
sqlLines.push(`-- Total: ${donantes.length} donantes`);

const porZona = new Map<string, number>();
for (const d of donantes) {
  porZona.set(d.zona, (porZona.get(d.zona) || 0) + 1);
}
for (const [zona, count] of Array.from(porZona.entries()).sort()) {
  sqlLines.push(`-- ${zona}: ${count} donantes`);
}

const sqlPath = path.join(outputDir, "seed-donantes-1000.sql");
fs.writeFileSync(sqlPath, sqlLines.join("\n"), "utf-8");

// 3. Seed con Drizzle ORM (TypeScript)
const tsLines: string[] = [
  'import { db } from "../src/database";',
  'import { donantes, zonas, subZonas } from "../src/database/schema";',
  'import { logger } from "../src/config/logger";',
  'import fs from "fs";',
  'import path from "path";',
  "",
  "interface CsvDonante {",
  "  nombre: string;",
  "  telefono: string;",
  "  direccion: string;",
  "  zonaId: number;",
  "  subZona: string;",
  "  diasRecoleccion: string;",
  "}",
  "",
  "async function seedDonantes(): Promise<void> {",
  '  const csvPath = path.join(__dirname, "../test-data/donantes-test-1000.csv");',
  '  const content = fs.readFileSync(csvPath, "utf-8");',
  '  const lines = content.split("\\n").slice(1).filter((l) => l.trim());',
  "",
  "  // Crear zonas",
  '  const zonasData = [',
  '    { nombre: "Zona 1", descripcion: "CABA Centro-Norte" },',
  '    { nombre: "Zona 2", descripcion: "CABA Palermo-Belgrano y zona norte GBA" },',
  '    { nombre: "Zona 3", descripcion: "CABA Palermo-Villa Crespo-Caballito" },',
  '    { nombre: "Zona 4", descripcion: "GBA Sur - Avellaneda, Lanús, Quilmes" },',
  '  ];',
  "",
  "  for (const z of zonasData) {",
  "    await db.insert(zonas).values(z).onConflictDoNothing();",
  "  }",
  "",
  "  // Crear sub-zonas",
  "  const subZonasData = [",
  '    { zonaId: 1, codigo: "1A", nombre: "Zona 1 - Sub-zona A", diasRecoleccion: "Lunes, Miércoles, Viernes" },',
  '    { zonaId: 1, codigo: "1B", nombre: "Zona 1 - Sub-zona B", diasRecoleccion: "Martes, Jueves, Sábado" },',
  '    { zonaId: 2, codigo: "2A", nombre: "Zona 2 - Sub-zona A", diasRecoleccion: "Lunes, Miércoles, Viernes" },',
  '    { zonaId: 2, codigo: "2B", nombre: "Zona 2 - Sub-zona B", diasRecoleccion: "Martes, Jueves, Sábado" },',
  '    { zonaId: 3, codigo: "3A", nombre: "Zona 3 - Sub-zona A", diasRecoleccion: "Lunes, Miércoles, Viernes" },',
  '    { zonaId: 3, codigo: "3B", nombre: "Zona 3 - Sub-zona B", diasRecoleccion: "Martes, Jueves, Sábado" },',
  '    { zonaId: 4, codigo: "4A", nombre: "Zona 4 - Sub-zona A", diasRecoleccion: "Lunes, Miércoles, Viernes" },',
  '    { zonaId: 4, codigo: "4B", nombre: "Zona 4 - Sub-zona B", diasRecoleccion: "Martes, Jueves, Sábado" },',
  "  ];",
  "",
  "  for (const sz of subZonasData) {",
  "    await db.insert(subZonas).values(sz).onConflictDoNothing();",
  "  }",
  "",
  '  const zonaMap: Record<string, number> = { "1": 1, "2": 2, "3": 3, "4": 4 };',
  '  const diasMap: Record<string, string> = {',
  '    "L-X-V": "Lunes, Miércoles, Viernes",',
  '    "M-J-S": "Martes, Jueves, Sábado",',
  "  };",
  "",
  "  let inserted = 0;",
  "  let skipped = 0;",
  "",
  "  for (const line of lines) {",
  "    // Parse CSV (handle quoted fields)",
  '    const match = line.match(/^(\\d+),(.*?),(\\d+),\"?(.*?)\"?,(.*?),(\\w+),(.*?),(.*?)$/);',
  "    if (!match) { skipped++; continue; }",
  "",
  "    const [, , nombre, telefono, direccion, localidad, zona, dias] = match;",
  "    const zonaId = zonaMap[zona[0]];",
  "",
  "    try {",
  "      await db.insert(donantes).values({",
  "        nombre: nombre.trim(),",
  "        telefono: telefono.trim(),",
  "        direccion: `${direccion.trim()}, ${localidad.trim()}`,",
  "        zonaId,",
  "        subZona: zona.trim(),",
  "        diasRecoleccion: diasMap[dias.trim()] || dias.trim(),",
  '        estado: "activa",',
  "        donandoActualmente: true,",
  "      }).onConflictDoNothing();",
  "      inserted++;",
  "    } catch (err) {",
  "      skipped++;",
  "    }",
  "  }",
  "",
  "  logger.info({ inserted, skipped }, `Seed completado`);",
  "}",
  "",
  "seedDonantes()",
  '  .then(() => { console.log("Seed completado"); process.exit(0); })',
  '  .catch((err) => { console.error("Error:", err); process.exit(1); });',
];

const tsPath = path.join(outputDir, "seed-donantes.ts");
fs.writeFileSync(tsPath, tsLines.join("\n"), "utf-8");

// ── Estadísticas ────────────────────────────────────────
console.log("\n✅ Archivos generados en test-data/:");
console.log(`   📄 donantes-test-1000.csv  (${donantes.length} donantes)`);
console.log(`   📄 seed-donantes-1000.sql  (SQL directo para PostgreSQL)`);
console.log(`   📄 seed-donantes.ts        (seed con Drizzle ORM)`);
console.log("\n📊 Distribución por sub-zona:");
for (const [zona, count] of Array.from(porZona.entries()).sort()) {
  console.log(`   ${zona}: ${count} donantes`);
}
console.log(`\n   Total: ${donantes.length} donantes`);
