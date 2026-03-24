/**
 * Test de rutas optimizadas con 1000 donantes con coordenadas ficticias.
 * Simula el optimizador Nearest Neighbor sin necesitar DB ni APIs externas.
 */

// Dummy env
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.DB_USER = "test";
process.env.DB_PASSWORD = "test";
process.env.WHATSAPP_TOKEN = "test";
process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
process.env.WHATSAPP_VERIFY_TOKEN = "test";
process.env.CEO_PHONE = "5411999999";

import { nearestNeighborRoute, haversineDistance } from "../src/services/route-optimizer";
import fs from "fs";
import path from "path";

// ── Colores ──────────────────────────────────────────
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// ── Coordenadas base de Buenos Aires por zona ────────
const ZONAS_COORDS: Record<string, { latMin: number; latMax: number; lonMin: number; lonMax: number }> = {
  "1A": { latMin: -34.600, latMax: -34.580, lonMin: -58.400, lonMax: -58.370 }, // CABA Centro
  "1B": { latMin: -34.620, latMax: -34.600, lonMin: -58.400, lonMax: -58.370 }, // CABA Centro-Sur
  "2A": { latMin: -34.570, latMax: -34.550, lonMin: -58.460, lonMax: -58.430 }, // Belgrano/V.López
  "2B": { latMin: -34.550, latMax: -34.530, lonMin: -58.480, lonMax: -58.450 }, // San Isidro
  "3A": { latMin: -34.590, latMax: -34.570, lonMin: -58.440, lonMax: -58.410 }, // Palermo
  "3B": { latMin: -34.610, latMax: -34.590, lonMin: -58.440, lonMax: -58.420 }, // Villa Crespo
  "4A": { latMin: -34.660, latMax: -34.640, lonMin: -58.380, lonMax: -58.350 }, // Avellaneda
  "4B": { latMin: -34.720, latMax: -34.700, lonMin: -58.350, lonMax: -58.320 }, // Quilmes
};

const CALLES = [
  "Av. Rivadavia", "Av. Corrientes", "San Martín", "Belgrano", "Mitre",
  "Sarmiento", "Colón", "Lavalle", "Tucumán", "Maipú", "Florida", "Alsina",
  "Moreno", "Chile", "México", "Defensa", "Bolívar", "Perú", "Garay",
  "Independencia", "San Juan", "Constitución", "Brasil", "Caseros",
];

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

interface PuntoTest {
  id: number;
  nombre: string;
  direccion: string;
  lat: number;
  lon: number;
  subZona: string;
}

// ── Generar 1000 donantes con coordenadas ────────────
function generarDonantes(): PuntoTest[] {
  const nombres = [
    "Marta", "Silvia", "Carmen", "Laura", "Ana", "Teresa", "Susana", "Rosa",
    "Elena", "Mónica", "Norma", "Patricia", "Gladys", "Alicia", "Claudia",
    "Adriana", "Cecilia", "Irene", "Nora", "Alejandra", "Inés", "Gloria",
    "Marcela", "Verónica", "Andrea", "Lucía", "Victoria", "Josefina", "Cristina",
    "Mariana", "Paula", "Julieta", "Florencia", "Romina", "Lorena", "María",
  ];
  const apellidos = [
    "Rossi", "Gómez", "López", "Fernández", "Martínez", "Suárez", "Romero",
    "Torres", "Silva", "Ruiz", "Blanco", "Medina", "Vargas", "Castro", "Ortiz",
    "Cabrera", "Flores", "Díaz", "González", "Rodríguez", "Pérez", "García",
    "Sánchez", "Ramírez", "Álvarez", "Moreno", "Benítez", "Gutiérrez", "Aguirre",
  ];

  const subZonas = Object.keys(ZONAS_COORDS);
  const donantes: PuntoTest[] = [];

  for (let i = 0; i < 1000; i++) {
    const subZona = subZonas[i % subZonas.length];
    const coords = ZONAS_COORDS[subZona];
    const nombre = `${nombres[i % nombres.length]} ${apellidos[Math.floor(i / nombres.length) % apellidos.length]}`;
    const calle = CALLES[i % CALLES.length];

    donantes.push({
      id: 1001 + i,
      nombre,
      direccion: `${calle} ${randInt(100, 6000)}`,
      lat: rand(coords.latMin, coords.latMax),
      lon: rand(coords.lonMin, coords.lonMax),
      subZona,
    });
  }

  return donantes;
}

// ── Tests ────────────────────────────────────────────
async function runTests(): Promise<void> {
  console.log(`\n${BOLD}🗺️  GARYCIO - Test de Rutas Optimizadas${RESET}`);
  console.log(`${DIM}1000 donantes con coordenadas ficticias de Buenos Aires${RESET}\n`);

  const allDonantes = generarDonantes();
  const subZonas = Object.keys(ZONAS_COORDS);

  let totalDistOpt = 0;
  let totalDistOrig = 0;
  let totalParadas = 0;

  const resultados: Array<{
    subZona: string;
    donantes: number;
    distOrigKm: number;
    distOptKm: number;
    mejoraPct: number;
    tiempoMs: number;
    tiempoEstMin: number;
  }> = [];

  for (const sz of subZonas) {
    const puntos = allDonantes
      .filter((d) => d.subZona === sz)
      .map((d) => ({ id: d.id, nombre: d.nombre, direccion: d.direccion, lat: d.lat, lon: d.lon }));

    // Distancia en orden original (sin optimizar)
    let distOrig = 0;
    for (let i = 0; i < puntos.length - 1; i++) {
      distOrig += haversineDistance(puntos[i].lat, puntos[i].lon, puntos[i + 1].lat, puntos[i + 1].lon);
    }

    // Optimizar con Nearest Neighbor
    const start = Date.now();
    const rutaOpt = nearestNeighborRoute(puntos);
    const elapsed = Date.now() - start;

    // Distancia optimizada
    let distOpt = 0;
    for (let i = 0; i < rutaOpt.length - 1; i++) {
      distOpt += haversineDistance(rutaOpt[i].lat, rutaOpt[i].lon, rutaOpt[i + 1].lat, rutaOpt[i + 1].lon);
    }

    const mejora = distOrig > 0 ? ((distOrig - distOpt) / distOrig) * 100 : 0;
    const tiempoEstMin = Math.round((distOpt / 25) * 60); // 25 km/h promedio urbano

    totalDistOpt += distOpt;
    totalDistOrig += distOrig;
    totalParadas += puntos.length;

    resultados.push({
      subZona: sz,
      donantes: puntos.length,
      distOrigKm: Math.round(distOrig * 100) / 100,
      distOptKm: Math.round(distOpt * 100) / 100,
      mejoraPct: Math.round(mejora * 10) / 10,
      tiempoMs: elapsed,
      tiempoEstMin,
    });
  }

  // ── Tabla de resultados ────────────────────────────
  console.log(`${BOLD}${CYAN}── Resultados por Sub-zona ──${RESET}\n`);
  console.log(`  ${"SUB-ZONA".padEnd(10)} ${"DONANTES".padStart(9)} ${"DIST.ORIG".padStart(12)} ${"DIST.OPT".padStart(12)} ${"MEJORA".padStart(8)} ${"TIEMPO EST.".padStart(12)} ${"PROC.".padStart(8)}`);
  console.log(`  ${"─".repeat(10)} ${"─".repeat(9)} ${"─".repeat(12)} ${"─".repeat(12)} ${"─".repeat(8)} ${"─".repeat(12)} ${"─".repeat(8)}`);

  for (const r of resultados) {
    const mejoraColor = r.mejoraPct > 30 ? GREEN : r.mejoraPct > 15 ? CYAN : DIM;
    console.log(
      `  ${r.subZona.padEnd(10)} ${String(r.donantes).padStart(9)} ${(r.distOrigKm + " km").padStart(12)} ${(r.distOptKm + " km").padStart(12)} ${mejoraColor}${(r.mejoraPct + "%").padStart(8)}${RESET} ${(r.tiempoEstMin + " min").padStart(12)} ${(r.tiempoMs + " ms").padStart(8)}`,
    );
  }

  const mejoraTotal = totalDistOrig > 0 ? ((totalDistOrig - totalDistOpt) / totalDistOrig) * 100 : 0;
  const tiempoEstTotal = Math.round((totalDistOpt / 25) * 60);

  console.log(`  ${"─".repeat(10)} ${"─".repeat(9)} ${"─".repeat(12)} ${"─".repeat(12)} ${"─".repeat(8)} ${"─".repeat(12)} ${"─".repeat(8)}`);
  console.log(
    `  ${BOLD}${"TOTAL".padEnd(10)} ${String(totalParadas).padStart(9)} ${(Math.round(totalDistOrig * 100) / 100 + " km").padStart(12)} ${(Math.round(totalDistOpt * 100) / 100 + " km").padStart(12)} ${GREEN}${(Math.round(mejoraTotal * 10) / 10 + "%").padStart(8)}${RESET}${BOLD} ${(tiempoEstTotal + " min").padStart(12)}${RESET}`,
  );

  // ── Ejemplo de ruta (Sub-zona 1A, primeras 10 paradas) ──
  console.log(`\n${BOLD}${CYAN}── Ejemplo: Ruta Optimizada Sub-zona 1A (primeras 10 paradas) ──${RESET}\n`);

  const ejemplo = allDonantes
    .filter((d) => d.subZona === "1A")
    .map((d) => ({ id: d.id, nombre: d.nombre, direccion: d.direccion, lat: d.lat, lon: d.lon }));

  const rutaEjemplo = nearestNeighborRoute(ejemplo);

  for (let i = 0; i < Math.min(10, rutaEjemplo.length); i++) {
    const p = rutaEjemplo[i];
    const dist = i > 0
      ? haversineDistance(rutaEjemplo[i - 1].lat, rutaEjemplo[i - 1].lon, p.lat, p.lon)
      : 0;
    const distStr = i > 0 ? `${(dist * 1000).toFixed(0)}m` : "INICIO";
    console.log(
      `  ${GREEN}${String(i + 1).padStart(3)}.${RESET} ${p.nombre.padEnd(25)} ${DIM}${p.direccion.padEnd(25)}${RESET} ${CYAN}→ ${distStr}${RESET}`,
    );
  }
  if (rutaEjemplo.length > 10) {
    console.log(`  ${DIM}    ... y ${rutaEjemplo.length - 10} paradas más${RESET}`);
  }

  // ── Guardar resultados en CSV ──────────────────────
  const outputDir = path.join(process.cwd(), "test-data");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // CSV de rutas optimizadas
  const csvLines = ["SubZona,Orden,ID_Donante,Nombre,Direccion,Latitud,Longitud,Dist_Anterior_m"];

  for (const sz of subZonas) {
    const puntos = allDonantes
      .filter((d) => d.subZona === sz)
      .map((d) => ({ id: d.id, nombre: d.nombre, direccion: d.direccion, lat: d.lat, lon: d.lon }));

    const ruta = nearestNeighborRoute(puntos);

    for (let i = 0; i < ruta.length; i++) {
      const p = ruta[i];
      const dist = i > 0
        ? Math.round(haversineDistance(ruta[i - 1].lat, ruta[i - 1].lon, p.lat, p.lon) * 1000)
        : 0;
      csvLines.push(`${sz},${i + 1},${p.id},"${p.nombre}","${p.direccion}",${p.lat.toFixed(6)},${p.lon.toFixed(6)},${dist}`);
    }
  }

  const csvPath = path.join(outputDir, "rutas-optimizadas-1000.csv");
  fs.writeFileSync(csvPath, csvLines.join("\n"), "utf-8");

  // ── Resumen final ─────────────────────────────────
  console.log(`\n${BOLD}════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  RESUMEN${RESET}`);
  console.log(`${BOLD}════════════════════════════════════════${RESET}`);
  console.log(`  Donantes procesados:     ${BOLD}${totalParadas}${RESET}`);
  console.log(`  Sub-zonas:               ${BOLD}${subZonas.length}${RESET}`);
  console.log(`  Distancia sin optimizar: ${BOLD}${(Math.round(totalDistOrig * 100) / 100)} km${RESET}`);
  console.log(`  Distancia optimizada:    ${BOLD}${GREEN}${(Math.round(totalDistOpt * 100) / 100)} km${RESET}`);
  console.log(`  Reducción total:         ${BOLD}${GREEN}${(Math.round(mejoraTotal * 10) / 10)}%${RESET}`);
  console.log(`  Tiempo estimado total:   ${BOLD}${tiempoEstTotal} min${RESET} (a 25 km/h promedio urbano)`);
  console.log(`  Archivo generado:        ${DIM}${csvPath}${RESET}`);
  console.log();
}

runTests().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
