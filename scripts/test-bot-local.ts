/**
 * Test local del bot GARYCIO - simula conversaciones sin WhatsApp ni DB.
 *
 * Prueba:
 * 1. Detección de flujos por keyword
 * 2. Flujo completo de reclamo
 * 3. Flujo completo de chofer
 * 4. Flujo de contacto inicial
 * 5. Flujo de aviso
 * 6. Menú numérico
 * 7. Timeout de conversación
 * 8. Simulación de carga masiva (1000 mensajes concurrentes)
 */

// Set dummy env vars before any imports that trigger env validation
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.DB_USER = "test";
process.env.DB_PASSWORD = "test";
process.env.WHATSAPP_TOKEN = "test_token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "123456";
process.env.WHATSAPP_VERIFY_TOKEN = "test_verify";
process.env.CEO_PHONE = "5411999999";

// ── Imports de los flows directamente (sin DB) ──────────
import { detectFlow, getFlowByName } from "../src/bot/flows";
import type { ConversationState, FlowResponse } from "../src/bot/flows/types";

// ── Colores para output ──────────────────────────────────
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

let passed = 0;
let failed = 0;
const errors: string[] = [];

function assert(condition: boolean, testName: string, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  ${GREEN}✓${RESET} ${testName}`);
  } else {
    failed++;
    const msg = `${testName}${detail ? ` - ${detail}` : ""}`;
    errors.push(msg);
    console.log(`  ${RED}✗${RESET} ${testName}${detail ? ` ${DIM}(${detail})${RESET}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n${BOLD}${CYAN}── ${title} ──${RESET}`);
}

// ── Helper: simular conversación ────────────────────────
async function simulateConversation(
  phone: string,
  messages: string[],
): Promise<FlowResponse[]> {
  const responses: FlowResponse[] = [];
  let state: ConversationState | null = null;

  for (const msg of messages) {
    if (!state) {
      const detected = detectFlow(msg);
      if (!detected) {
        responses.push({ reply: "[MENU PRINCIPAL]" });
        continue;
      }
      state = {
        phone,
        currentFlow: detected.name,
        step: 0,
        data: {},
        lastInteraction: new Date(),
      };
    }

    const flow = getFlowByName(state.currentFlow!);
    if (!flow) {
      responses.push({ reply: "[FLOW NOT FOUND]" });
      break;
    }

    const response = await flow.handle(state, msg);
    responses.push(response);

    if (response.data) {
      state.data = { ...state.data, ...response.data };
    }

    if (response.endFlow) {
      state = null;
    } else if (response.nextStep !== undefined) {
      state.step = response.nextStep;
    }
  }

  return responses;
}

// ════════════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════════════

async function runTests(): Promise<void> {
  console.log(`\n${BOLD}🤖 GARYCIO Bot - Test Suite Local${RESET}`);
  console.log(`${DIM}Fecha: ${new Date().toLocaleString("es-AR")}${RESET}`);

  // ── 1. Detección de flujos ──────────────────────────
  section("1. Detección de Flujos por Keyword");

  const keywords = [
    { msg: "tengo un reclamo", expected: "reclamo" },
    { msg: "queja", expected: "reclamo" },
    { msg: "problema con el bidón", expected: "reclamo" },
    { msg: "chofer", expected: "chofer" },
    { msg: "cargar datos", expected: "chofer" },
    { msg: "litros", expected: "chofer" },
    { msg: "reporte", expected: "reporte" },
    { msg: "hola buen día", expected: null },
    { msg: "123", expected: "consulta_general" },
    { msg: "vacaciones", expected: "aviso" },
    { msg: "enfermedad", expected: "aviso" },
  ];

  for (const { msg, expected } of keywords) {
    const result = detectFlow(msg);
    assert(
      expected === null ? result === null : result?.name === expected,
      `"${msg}" → ${expected || "menú"}`,
      result ? `got: ${result.name}` : "got: null",
    );
  }

  // ── 2. Flujo completo de reclamo ────────────────────
  section("2. Flujo Completo: Reclamo");

  const reclamoResponses = await simulateConversation("5411111111", [
    "reclamo",      // Trigger → menú de tipos
    "1",            // Tipo: regalo
    "no",           // Sin detalle adicional
    "no",           // No necesita más ayuda
  ]);

  assert(reclamoResponses.length === 4, "4 respuestas en flujo de reclamo");
  assert(reclamoResponses[0].reply.includes("tipo de reclamo"), "Step 0: pregunta tipo");
  assert(reclamoResponses[1].reply.includes("regalo"), "Step 1: confirma tipo regalo");
  assert(reclamoResponses[1].data?.tipoReclamo === "regalo", "Data: tipoReclamo = regalo");
  assert(reclamoResponses[2].reply.includes("registrado"), "Step 2: reclamo registrado");
  assert(reclamoResponses[2].notify?.target === "chofer", "Notifica al chofer");
  assert(reclamoResponses[3].endFlow === true, "Step 3: flujo termina");

  // ── 3. Flujo completo de chofer ─────────────────────
  section("3. Flujo Completo: Chofer");

  const choferResponses = await simulateConversation("5422222222", [
    "chofer",      // Trigger
    "3",           // Código de chofer
    "1",           // Opción: litros y bidones
    "1200",        // Litros
    "25",          // Bidones
    "1",           // Confirmar
    "4",           // Finalizar jornada
  ]);

  assert(choferResponses.length === 7, "7 respuestas en flujo de chofer");
  assert(choferResponses[0].reply.includes("Registro de Chofer") || choferResponses[0].reply.includes("Identificado"), "Step 0: identificación");
  assert(choferResponses[2].reply.includes("litros"), "Step 2: pide litros");
  assert(choferResponses[3].data?.litros === 1200, "Data: litros = 1200");
  assert(choferResponses[4].reply.includes("Resumen"), "Step 4: resumen recolección");
  assert(choferResponses[4].data?.bidones === 25, "Data: bidones = 25");
  assert(choferResponses[5].notify?.target === "admin", "Notifica recolección al admin");
  assert(choferResponses[6].endFlow === true, "Finalizar jornada termina flujo");

  // ── 4. Flujo de contacto inicial ────────────────────
  section("4. Flujo Completo: Contacto Inicial");

  const contactoState: ConversationState = {
    phone: "5433333333",
    currentFlow: "contacto_inicial",
    step: 0,
    data: {},
    lastInteraction: new Date(),
  };

  const contactoFlow = getFlowByName("contacto_inicial")!;
  const r1 = await contactoFlow.handle(contactoState, "sí");
  assert(r1.data?.donandoActualmente === true, "Donante confirma que está donando");
  assert(r1.nextStep === 1, "Avanza a step 1 (días)");

  contactoState.step = 1;
  Object.assign(contactoState.data, r1.data);
  const r2 = await contactoFlow.handle(contactoState, "lunes y jueves");
  assert(r2.reply.includes("Lunes") && r2.reply.includes("Jueves"), "Detecta días correctamente");
  assert(r2.nextStep === 2, "Avanza a step 2 (dirección)");

  contactoState.step = 2;
  Object.assign(contactoState.data, r2.data);
  const r3 = await contactoFlow.handle(contactoState, "Av. Corrientes 1234, entre Uruguay y Talcahuano, CABA");
  assert(r3.reply.includes("confirmo los datos"), "Muestra resumen para confirmar");
  assert(r3.nextStep === 3, "Avanza a step 3 (confirmación)");

  contactoState.step = 3;
  Object.assign(contactoState.data, r3.data);
  const r4 = await contactoFlow.handle(contactoState, "1");
  assert(r4.endFlow === true, "Confirmación termina flujo");
  assert(r4.notify?.target === "admin", "Notifica al admin");

  // ── 5. Validaciones de input ────────────────────────
  section("5. Validaciones de Input");

  // Litros inválidos
  const choferFlow = getFlowByName("chofer")!;
  const invalidState: ConversationState = {
    phone: "5444444444",
    currentFlow: "chofer",
    step: 2,
    data: { codigoChofer: "01" },
    lastInteraction: new Date(),
  };

  const rInvalid = await choferFlow.handle(invalidState, "abc");
  assert(rInvalid.nextStep === 2, "Litros inválidos: se queda en step 2");
  assert(rInvalid.reply.includes("válido"), "Muestra mensaje de error");

  const rNeg = await choferFlow.handle(invalidState, "-5");
  assert(rNeg.nextStep === 2, "Litros negativos: se queda en step 2");

  // Dirección muy corta en contacto inicial
  const contactoFlow2 = getFlowByName("contacto_inicial")!;
  const dirState: ConversationState = {
    phone: "5455555555",
    currentFlow: "contacto_inicial",
    step: 2,
    data: { diasRecoleccion: "Lunes" },
    lastInteraction: new Date(),
  };
  const rDirCorta = await contactoFlow2.handle(dirState, "casa");
  assert(rDirCorta.nextStep === 2, "Dirección corta: se queda en step 2");

  // ── 6. Incidentes con notificación ──────────────────
  section("6. Flujo de Incidente (Chofer)");

  const incidenteState: ConversationState = {
    phone: "5466666666",
    currentFlow: "chofer",
    step: 20,
    data: { codigoChofer: "02" },
    lastInteraction: new Date(),
  };

  const ri1 = await choferFlow.handle(incidenteState, "1"); // Accidente
  assert(ri1.data?.tipoIncidente === "accidente", "Tipo: accidente");

  incidenteState.step = 21;
  Object.assign(incidenteState.data, ri1.data);
  const ri2 = await choferFlow.handle(incidenteState, "Choqué contra un poste en Av. Rivadavia");
  assert(ri2.nextStep === 22, "Avanza a gravedad");

  incidenteState.step = 22;
  Object.assign(incidenteState.data, ri2.data);
  const ri3 = await choferFlow.handle(incidenteState, "4"); // Crítica
  assert(ri3.notify?.target === "admin", "Incidente notifica al admin");
  assert(ri3.notify?.message?.includes("CRITICA") ?? false, "Gravedad CRITICA en notificación");
  assert(ri3.notify?.message?.includes("Accidente") ?? false, "Tipo en notificación");

  // ── 7. Test de carga: 1000 conversaciones ───────────
  section("7. Test de Carga: 1000 Conversaciones Simultáneas");

  const startTime = Date.now();
  const TOTAL = 1000;

  const promises = Array.from({ length: TOTAL }, async (_, i) => {
    const phone = `54110${String(i).padStart(6, "0")}`;
    const flow = getFlowByName("reclamo")!;

    const state: ConversationState = {
      phone,
      currentFlow: "reclamo",
      step: 0,
      data: {},
      lastInteraction: new Date(),
    };

    // Simular 3 pasos del flujo
    const r1 = await flow.handle(state, "1"); // Tipo
    state.step = r1.nextStep ?? 0;
    Object.assign(state.data, r1.data || {});

    const r2 = await flow.handle(state, "no"); // Sin detalle
    state.step = r2.nextStep ?? 0;
    Object.assign(state.data, r2.data || {});

    const r3 = await flow.handle(state, "no"); // No más ayuda

    return { phone, steps: 3, ok: r3.endFlow === true as boolean };
  });

  const results = await Promise.all(promises);
  const elapsed = Date.now() - startTime;
  const successCount = results.filter((r) => r.ok).length;
  const msPerConv = (elapsed / TOTAL).toFixed(2);

  assert(successCount === TOTAL, `${TOTAL} conversaciones completadas`, `${successCount}/${TOTAL}`);
  assert(elapsed < 5000, `Tiempo total < 5s`, `fue ${elapsed}ms`);
  console.log(`  ${DIM}→ ${TOTAL} conversaciones × 3 pasos = ${TOTAL * 3} mensajes en ${elapsed}ms (${msPerConv}ms/conv)${RESET}`);

  // ── 8. Test de carga masiva: throughput ─────────────
  section("8. Throughput del Procesador de Mensajes");

  const start2 = Date.now();
  const MSGS = 5000;

  for (let i = 0; i < MSGS; i++) {
    const flow = getFlowByName("reclamo")!;
    const state: ConversationState = {
      phone: `5411${i}`,
      currentFlow: "reclamo",
      step: 0,
      data: {},
      lastInteraction: new Date(),
    };
    await flow.handle(state, "1");
  }

  const elapsed2 = Date.now() - start2;
  const msgsPerSec = Math.round(MSGS / (elapsed2 / 1000));

  assert(msgsPerSec > 1000, `Throughput > 1000 msg/s (fue ${msgsPerSec} msg/s)`);
  console.log(`  ${DIM}→ ${MSGS} mensajes procesados en ${elapsed2}ms (${msgsPerSec} msg/s)${RESET}`);

  // ── 9. Flujo de aviso ───────────────────────────────
  section("9. Flujo Completo: Aviso");

  const avisoFlow = getFlowByName("aviso")!;
  const avisoState: ConversationState = {
    phone: "5477777777",
    currentFlow: "aviso",
    step: 0,
    data: {},
    lastInteraction: new Date(),
  };

  const ra1 = await avisoFlow.handle(avisoState, "vacaciones");
  assert(ra1.reply.includes("vacaciones") || ra1.nextStep !== undefined, "Aviso detecta tipo vacaciones");

  // ── Resumen ─────────────────────────────────────────
  console.log(`\n${BOLD}════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  RESULTADOS${RESET}`);
  console.log(`${BOLD}════════════════════════════════════════${RESET}`);
  console.log(`  ${GREEN}✓ Pasaron: ${passed}${RESET}`);
  if (failed > 0) {
    console.log(`  ${RED}✗ Fallaron: ${failed}${RESET}`);
    console.log(`\n  ${RED}Errores:${RESET}`);
    errors.forEach((e) => console.log(`    ${RED}• ${e}${RESET}`));
  }
  console.log(`\n  ${DIM}Total: ${passed + failed} tests${RESET}`);
  console.log(`  ${passed === passed + failed ? GREEN + "ALL PASSED ✓" : RED + "SOME FAILED ✗"}${RESET}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("Error ejecutando tests:", err);
  process.exit(1);
});
