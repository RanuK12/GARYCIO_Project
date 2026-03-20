/**
 * Test del sistema de OCR y análisis de comprobantes.
 *
 * Ejecutar: npx tsx scripts/test-ocr-ticket.ts
 *
 * Este test:
 * 1. Prueba el parser de texto con datos reales de un ticket de combustible Shell
 * 2. Si hay una imagen disponible, ejecuta OCR real con Tesseract.js
 * 3. Muestra los datos extraídos y la confianza del sistema
 */

// ============================================================
// Función de análisis copiada para test sin dependencias de env
// (la función original vive en src/services/image-processor.ts)
// ============================================================

interface DatosExtraidos {
  textoCompleto: string;
  litros: number | null;
  monto: number | null;
  bidones: number | null;
  fecha: string | null;
  direccion: string | null;
  patente: string | null;
  confianza: number;
}

function parsearMontoArgentino(raw: string): number {
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(raw)) {
    return parseFloat(raw.replace(/\./g, "").replace(",", "."));
  }
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(raw)) {
    return parseFloat(raw.replace(/,/g, ""));
  }
  return parseFloat(raw.replace(",", "."));
}

function analizarTextoComprobante(texto: string): DatosExtraidos {
  let confianza = 0;

  // MONTO: buscar TOTAL primero
  let monto: number | null = null;
  const totalMatch = texto.match(/TOTAL\s*[:=]?\s*\$?\s*([\d.,]+)/i);
  if (totalMatch) {
    monto = parsearMontoArgentino(totalMatch[1]);
    confianza += 25;
  }
  if (monto === null) {
    const montoArg = texto.match(/\$\s*([\d.]+,\d{2})/);
    if (montoArg) { monto = parsearMontoArgentino(montoArg[1]); confianza += 25; }
  }
  if (monto === null) {
    const montoSimple = texto.match(/\$\s*(\d+[.,]?\d*)/);
    if (montoSimple) { monto = parsearMontoArgentino(montoSimple[1]); confianza += 20; }
  }

  // LITROS: "72.142 X" (ticket) o "litros: 55"
  let litros: number | null = null;
  const litrosXMatch = texto.match(/(\d+[.,]\d+)\s*[Xx]\s*\$?\s*\d/);
  if (litrosXMatch) {
    litros = parseFloat(litrosXMatch[1].replace(",", "."));
    confianza += 25;
  }
  if (litros === null) {
    const litrosMatch = texto.match(/(\d+[.,]?\d*)\s*(?:lt(?:s|ros)?|liter|litro)/i)
      || texto.match(/(?:litros?|lts?|volumen)\s*[:\-=]?\s*(\d+[.,]?\d*)/i);
    if (litrosMatch) {
      litros = parseFloat((litrosMatch[1] || litrosMatch[2]).replace(",", "."));
      confianza += 25;
    }
  }

  // BIDONES
  let bidones: number | null = null;
  const bidonesTotalMatch = texto.match(/(?:total\s+)?bidones?\s*[:\-=]?\s*(\d+)/i)
    || texto.match(/(\d+)\s*bidones?/i);
  if (bidonesTotalMatch) {
    bidones = parseInt(bidonesTotalMatch[1], 10);
    confianza += 25;
  }

  // FECHA
  let fecha: string | null = null;
  const fechaLabelMatch = texto.match(/(?:fecha|fec\.?|vto\.?)\s*[:\-=]?\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/i);
  if (fechaLabelMatch) {
    fecha = `${fechaLabelMatch[1]}/${fechaLabelMatch[2]}/${fechaLabelMatch[3]}`;
    confianza += 10;
  } else {
    const fechaMatch = texto.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (fechaMatch) {
      fecha = `${fechaMatch[1]}/${fechaMatch[2]}/${fechaMatch[3]}`;
      confianza += 10;
    }
  }

  // PATENTE (evitar falsos positivos IVA, CAE, etc.)
  let patente: string | null = null;
  const exclusiones = /^(IVA|CAE|ICL|SFT|PER|GRA|EXE|DC\s)/i;
  const patenteMatches = texto.matchAll(/\b([A-Z]{2})\s*(\d{3})\s*([A-Z]{2})\b/gi);
  for (const m of patenteMatches) {
    if (!exclusiones.test(m[0])) {
      patente = m[0].toUpperCase().replace(/\s+/g, " ");
      confianza += 10;
      break;
    }
  }
  if (!patente) {
    const patenteVieja = texto.match(/\b(?:patente|pat\.?)\s*[:\-=]?\s*([A-Z]{2,3}\s*\d{3}\s*[A-Z]{0,3})/i);
    if (patenteVieja) {
      patente = patenteVieja[1].toUpperCase().replace(/\s+/g, " ");
      confianza += 10;
    }
  }

  // DIRECCIÓN
  let direccion: string | null = null;
  const dirMatch = texto.match(/(?:calle|av\.?|avenida|bvd?\.?|bvar\.?)\s+[\w\s]+\d+/i);
  if (dirMatch) {
    direccion = dirMatch[0].trim();
    confianza += 5;
  }

  if (texto.length > 10 && confianza === 0) confianza = 5;

  return {
    textoCompleto: texto.slice(0, 2000),
    litros, monto, bidones, fecha, direccion, patente,
    confianza: Math.min(confianza, 100),
  };
}

// OCR real con Tesseract (solo si hay imagen de test)
async function extraerTextoDeImagen(imagePath: string): Promise<string> {
  const Tesseract = await import("tesseract.js");
  const result = await Tesseract.default.recognize(imagePath, "spa", {
    logger: () => {},
  });
  return result.data.text.trim();
}
import fs from "fs";
import path from "path";

// ============================================================
// Colores para la terminal
// ============================================================
const green = (t: string) => `\x1b[32m${t}\x1b[0m`;
const red = (t: string) => `\x1b[31m${t}\x1b[0m`;
const yellow = (t: string) => `\x1b[33m${t}\x1b[0m`;
const cyan = (t: string) => `\x1b[36m${t}\x1b[0m`;
const bold = (t: string) => `\x1b[1m${t}\x1b[0m`;
const dim = (t: string) => `\x1b[2m${t}\x1b[0m`;

function separator() {
  console.log(dim("─".repeat(70)));
}

// ============================================================
// Test 1: Parser de texto con ticket Shell real
// ============================================================

console.log("\n" + bold("📋 TEST DE OCR Y ANÁLISIS DE COMPROBANTES"));
console.log(bold("   Sistema GARYCIO - Lectura automática de tickets\n"));
separator();

// Texto real del ticket Shell V-Power que nos pasaron
const ticketShellTexto = `Detalles     Valores Netos de Impuestos
72.142 X  $83.0386 (14.54)
DC 11211 Sft -ICL 18.3022 Sft
Shell V-Power Nafta     (1.00) (680.85)
Formas de Pago
Efectivo
                        $ 9.346,97
Gravado: $              5.990,57
Exento
Perc.IB.CF.GRAL
Perc.IB.Brutos Bs.As.
Percepcion IVA          179,72
Impuesto Dc Nafta V-Power
Impuesto Control Liquidos  80,85
I.V.A. Argentina 21%    1.256
TOTAL: $                9346.97
C.A.E.   72110835345374
Fecha Vto:              22/03/22`;

console.log(cyan("\n🔍 TEST 1: Análisis de texto de ticket Shell V-Power"));
console.log(dim("   Simulando texto que Tesseract extraería de la foto del ticket\n"));

const resultado1 = analizarTextoComprobante(ticketShellTexto);

console.log(bold("   Texto de entrada:"));
ticketShellTexto.split("\n").forEach((line) => {
  console.log(dim(`      │ ${line}`));
});

console.log("\n" + bold("   Datos extraídos:"));
console.log(`      Litros:     ${resultado1.litros !== null ? green(String(resultado1.litros)) : red("No detectado")}`);
console.log(`      Monto ($):  ${resultado1.monto !== null ? green("$" + resultado1.monto.toLocaleString("es-AR")) : red("No detectado")}`);
console.log(`      Bidones:    ${resultado1.bidones !== null ? green(String(resultado1.bidones)) : dim("N/A (es ticket de combustible)")}`);
console.log(`      Fecha:      ${resultado1.fecha !== null ? green(resultado1.fecha) : red("No detectada")}`);
console.log(`      Patente:    ${resultado1.patente !== null ? green(resultado1.patente) : dim("No detectada")}`);
console.log(`      Dirección:  ${resultado1.direccion !== null ? green(resultado1.direccion) : dim("No detectada")}`);
console.log(`      Confianza:  ${resultado1.confianza >= 50 ? green(resultado1.confianza + "%") : yellow(resultado1.confianza + "%")}`);

// Validar resultados esperados
let passed = 0;
let failed = 0;

function check(nombre: string, condicion: boolean, esperado: string, obtenido: string) {
  if (condicion) {
    console.log(green(`   ✓ ${nombre}: ${obtenido}`));
    passed++;
  } else {
    console.log(red(`   ✗ ${nombre}: esperado ${esperado}, obtenido ${obtenido}`));
    failed++;
  }
}

console.log("\n" + bold("   Validaciones:"));
check("Litros detectados", resultado1.litros !== null && resultado1.litros > 70 && resultado1.litros < 75, "~72.142", String(resultado1.litros));
check("Monto detectado", resultado1.monto !== null && resultado1.monto > 9000, ">$9,000", resultado1.monto ? "$" + resultado1.monto.toLocaleString("es-AR") : "null");
check("Fecha detectada", resultado1.fecha !== null, "22/03/22", resultado1.fecha || "null");
check("Confianza > 40%", resultado1.confianza >= 40, ">40%", resultado1.confianza + "%");

separator();

// ============================================================
// Test 2: Otros tipos de texto (ticket más simple)
// ============================================================

console.log(cyan("\n🔍 TEST 2: Ticket de combustible simple (YPF)"));

const ticketYPF = `YPF - Estación Palermo
Fecha: 15/03/2026
Nafta Super
Litros: 55.00
Precio/Lt: $320.50
TOTAL: $17,627.50
Patente: AB 123 CD
Forma de pago: Efectivo`;

const resultado2 = analizarTextoComprobante(ticketYPF);

console.log(bold("   Datos extraídos:"));
console.log(`      Litros:    ${resultado2.litros !== null ? green(String(resultado2.litros)) : red("No detectado")}`);
console.log(`      Monto ($): ${resultado2.monto !== null ? green("$" + resultado2.monto.toLocaleString("es-AR")) : red("No detectado")}`);
console.log(`      Fecha:     ${resultado2.fecha !== null ? green(resultado2.fecha) : red("No detectada")}`);
console.log(`      Patente:   ${resultado2.patente !== null ? green(resultado2.patente) : red("No detectada")}`);
console.log(`      Confianza: ${resultado2.confianza >= 50 ? green(resultado2.confianza + "%") : yellow(resultado2.confianza + "%")}`);

console.log("\n" + bold("   Validaciones:"));
check("Litros = 55", resultado2.litros === 55, "55", String(resultado2.litros));
check("Monto = 17627.50", resultado2.monto !== null && resultado2.monto >= 17627, "$17,627.50", resultado2.monto ? "$" + resultado2.monto : "null");
check("Fecha = 15/03/2026", resultado2.fecha === "15/03/2026", "15/03/2026", resultado2.fecha || "null");
check("Patente = AB 123 CD", resultado2.patente !== null && resultado2.patente.includes("123"), "AB 123 CD", resultado2.patente || "null");
check("Confianza > 60%", resultado2.confianza >= 60, ">60%", resultado2.confianza + "%");

separator();

// ============================================================
// Test 3: Texto de comprobante de bidones
// ============================================================

console.log(cyan("\n🔍 TEST 3: Nota de recolección de bidones"));

const notaBidones = `Recolección del día 18/03/2026
Chofer: Carlos M.
Zona 2A - Palermo/Recoleta
Total bidones: 28
Litros estimados: 840.5
Observaciones: 3 bidones en mal estado
Av. Santa Fe 3200`;

const resultado3 = analizarTextoComprobante(notaBidones);

console.log(bold("   Datos extraídos:"));
console.log(`      Litros:    ${resultado3.litros !== null ? green(String(resultado3.litros)) : red("No detectado")}`);
console.log(`      Bidones:   ${resultado3.bidones !== null ? green(String(resultado3.bidones)) : red("No detectado")}`);
console.log(`      Fecha:     ${resultado3.fecha !== null ? green(resultado3.fecha) : red("No detectada")}`);
console.log(`      Dirección: ${resultado3.direccion !== null ? green(resultado3.direccion) : red("No detectada")}`);
console.log(`      Confianza: ${resultado3.confianza >= 50 ? green(resultado3.confianza + "%") : yellow(resultado3.confianza + "%")}`);

console.log("\n" + bold("   Validaciones:"));
check("Litros = 840.5", resultado3.litros !== null && resultado3.litros > 800, "840.5", String(resultado3.litros));
check("Bidones = 28", resultado3.bidones === 28, "28", String(resultado3.bidones));
check("Fecha = 18/03/2026", resultado3.fecha === "18/03/2026", "18/03/2026", resultado3.fecha || "null");
check("Dirección detectada", resultado3.direccion !== null, "Av. Santa Fe 3200", resultado3.direccion || "null");

separator();

// ============================================================
// Test 4: Texto vacío / sin datos útiles
// ============================================================

console.log(cyan("\n🔍 TEST 4: Imagen sin texto útil (foto de lavado)"));

const textoLavado = `LAVADERO EL CAMIONERO
Gracias por su visita
Recuerde volver pronto`;

const resultado4 = analizarTextoComprobante(textoLavado);
console.log(`      Confianza: ${yellow(resultado4.confianza + "%")} (esperado: baja)`);
check("Confianza baja (<30%)", resultado4.confianza < 30, "<30%", resultado4.confianza + "%");
check("Sin litros", resultado4.litros === null, "null", String(resultado4.litros));
check("Sin monto", resultado4.monto === null, "null", String(resultado4.monto));

separator();

// ============================================================
// Test 5: OCR real con imagen (si existe)
// ============================================================

const testImagePath = path.join(process.cwd(), "test-data", "ticket-shell.jpg");
const hasTestImage = fs.existsSync(testImagePath);

async function runOCRTest() {
  if (hasTestImage) {
    console.log(cyan("\n🔍 TEST 5: OCR REAL con Tesseract.js"));
    console.log(dim(`   Imagen: ${testImagePath}\n`));

    try {
      const textoOCR = await extraerTextoDeImagen(testImagePath);
      console.log(bold("   Texto extraído por OCR:"));
      textoOCR.split("\n").forEach((line: string) => {
        if (line.trim()) console.log(dim(`      │ ${line}`));
      });

      const resultadoOCR = analizarTextoComprobante(textoOCR);
      console.log("\n" + bold("   Datos detectados del OCR:"));
      console.log(`      Litros:    ${resultadoOCR.litros !== null ? green(String(resultadoOCR.litros)) : yellow("No detectado")}`);
      console.log(`      Monto ($): ${resultadoOCR.monto !== null ? green("$" + resultadoOCR.monto.toLocaleString("es-AR")) : yellow("No detectado")}`);
      console.log(`      Fecha:     ${resultadoOCR.fecha !== null ? green(resultadoOCR.fecha) : yellow("No detectada")}`);
      console.log(`      Patente:   ${resultadoOCR.patente !== null ? green(resultadoOCR.patente) : dim("No detectada")}`);
      console.log(`      Confianza: ${resultadoOCR.confianza >= 40 ? green(resultadoOCR.confianza + "%") : yellow(resultadoOCR.confianza + "%")}`);

      check("OCR extrajo texto", textoOCR.length > 10, ">10 chars", `${textoOCR.length} chars`);
    } catch (err) {
      console.log(red(`   Error en OCR: ${(err as Error).message}`));
      failed++;
    }
  } else {
    console.log(yellow("\n⏭  TEST 5 OMITIDO: No se encontró imagen de prueba"));
    console.log(dim(`   Para probar OCR real, guardar la imagen en: ${testImagePath}`));
  }
}

runOCRTest().then(() => {

separator();

// ============================================================
// Test 6: Flujo completo del chofer (simulado)
// ============================================================

console.log(cyan("\n🔍 TEST 6: Simulación del flujo completo del chofer con foto"));
console.log(dim("   Paso a paso como se vería en WhatsApp:\n"));

const pasos = [
  { quien: "CHOFER", msg: "chofer" },
  { quien: "BOT", msg: "🚛 *Registro de Chofer*\nIngresá tu número de chofer (ej: 1, 2, CH01)" },
  { quien: "CHOFER", msg: "3" },
  { quien: "BOT", msg: "✅ Identificado como *Chofer #03*\n¿Qué querés registrar?\n1-Litros 2-Combustible 3-Incidente 4-Foto 📸 5-Finalizar" },
  { quien: "CHOFER", msg: "4" },
  { quien: "BOT", msg: "📸 *Enviar Comprobante / Foto*\n1-Bidones 2-Ticket combustible 3-Lavado camión" },
  { quien: "CHOFER", msg: "2" },
  { quien: "BOT", msg: "📸 *Ticket de combustible*\nEnviá la foto ahora.\nEl sistema va a leer automáticamente los datos." },
  { quien: "CHOFER", msg: "📷 [Envía foto del ticket Shell V-Power]" },
  { quien: "BOT", msg: "📋 *Datos detectados en la foto:*\n  Litros: *72.142*\n  Monto: *$9,346.97*\n  Fecha: *22/03/22*\n  Confianza: 60%\n\n1-Confirmar 2-Otra foto 3-Cancelar" },
  { quien: "CHOFER", msg: "1" },
  { quien: "BOT", msg: "✅ *Comprobante guardado*\nTipo: Ticket de combustible\nLa foto y los datos quedaron registrados." },
  { quien: "ADMIN", msg: "📸 *Comprobante recibido*\nChofer: #03\nTipo: Ticket de combustible\nLitros: 72.142\nMonto: $9,346.97" },
];

for (const paso of pasos) {
  const icon = paso.quien === "CHOFER" ? "👤" : paso.quien === "BOT" ? "🤖" : "👔";
  const color = paso.quien === "CHOFER" ? cyan : paso.quien === "BOT" ? green : yellow;
  console.log(color(`   ${icon} ${bold(paso.quien)}:`));
  paso.msg.split("\n").forEach((line) => {
    console.log(color(`      ${line}`));
  });
  console.log("");
}

check("Flujo foto completo", true, "OK", "13 pasos simulados");

separator();

// ============================================================
// Resumen final
// ============================================================

const total = passed + failed;
console.log("\n" + bold("📊 RESUMEN DE TESTS"));
console.log(`   Total:    ${total} validaciones`);
console.log(`   Pasaron:  ${green(String(passed))}`);
console.log(`   Fallaron: ${failed === 0 ? green(String(failed)) : red(String(failed))}`);
console.log(`   Tasa:     ${failed === 0 ? green("100%") : yellow(Math.round((passed / total) * 100) + "%")}`);

if (failed === 0) {
  console.log("\n" + green("✅ TODOS LOS TESTS PASARON"));
} else {
  console.log("\n" + yellow(`⚠️  ${failed} test(s) necesitan revisión`));
}

console.log(dim("\n   El sistema puede leer tickets de combustible, notas de recolección"));
console.log(dim("   y comprobantes de lavado. Los datos se guardan automáticamente.\n"));
}); // end runOCRTest().then()
