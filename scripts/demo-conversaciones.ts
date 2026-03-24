/**
 * Demo de 10 conversaciones completas del bot GARYCIO.
 * Muestra cómo se ve cada interacción desde la perspectiva del usuario.
 */

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.DB_USER = "test";
process.env.DB_PASSWORD = "test";
process.env.WHATSAPP_TOKEN = "test";
process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
process.env.WHATSAPP_VERIFY_TOKEN = "test";
process.env.CEO_PHONE = "5411999999";

import { getFlowByName } from "../src/bot/flows";
import type { ConversationState } from "../src/bot/flows/types";

const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

async function chat(
  flowName: string,
  messages: string[],
  title: string,
  initialStep = 0,
  initialData: Record<string, any> = {},
): Promise<void> {
  console.log(`\n${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${BOLD}  ${title}${RESET}`);
  console.log(`${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n`);

  const flow = getFlowByName(flowName as any)!;
  const state: ConversationState = {
    phone: "5411" + Math.floor(Math.random() * 99999999).toString().padStart(8, "0"),
    currentFlow: flowName as any,
    step: initialStep,
    data: { ...initialData },
    lastInteraction: new Date(),
  };

  for (const msg of messages) {
    console.log(`  ${GREEN}👤 Donante:${RESET} ${msg}`);

    const response = await flow.handle(state, msg);

    // Format bot reply with indentation
    const replyLines = response.reply.split("\n");
    console.log(`  ${CYAN}🤖 Bot:${RESET} ${replyLines[0]}`);
    for (let i = 1; i < replyLines.length; i++) {
      console.log(`         ${replyLines[i]}`);
    }

    if (response.notify) {
      console.log(`  ${YELLOW}🔔 Notificación → ${response.notify.target}:${RESET} ${DIM}${response.notify.message.split("\n")[0]}...${RESET}`);
    }

    if (response.endFlow) {
      console.log(`  ${DIM}[Conversación finalizada]${RESET}`);
    }

    if (response.data) {
      state.data = { ...state.data, ...response.data };
    }
    if (response.nextStep !== undefined) {
      state.step = response.nextStep;
    }

    console.log();
  }
}

async function main(): Promise<void> {
  console.log(`\n${BOLD}🤖 GARYCIO Bot - 10 Ejemplos de Conversaciones Reales${RESET}`);
  console.log(`${DIM}Así se ven las interacciones desde WhatsApp${RESET}`);

  // 1. Reclamo por regalo no entregado
  await chat("reclamo", [
    "reclamo",
    "1",
    "Hace 3 semanas que no me dejan el regalo y siempre dejo el bidón lleno",
    "no",
  ], "1. Reclamo: Regalo no entregado");

  // 2. Reclamo por falta de bidón
  await chat("reclamo", [
    "tengo un problema",
    "2",
    "no",
    "no",
  ], "2. Reclamo: Falta de bidón");

  // 3. Chofer registra recolección
  await chat("chofer", [
    "chofer",
    "3",
    "1",
    "1450",
    "32",
    "1",
    "4",
  ], "3. Chofer #03 registra litros y finaliza jornada");

  // 4. Chofer carga combustible
  await chat("chofer", [
    "registro",
    "5",
    "2",
    "55, 18500",
    "1",
    "4",
  ], "4. Chofer #05 carga combustible");

  // 5. Chofer reporta incidente grave
  await chat("chofer", [
    "chofer",
    "2",
    "3",
    "1",
    "Se reventó una rueda en Av. Rivadavia al 5000, no puedo seguir",
    "3",
  ], "5. Chofer #02 reporta incidente - Avería del camión");

  // 6. Contacto inicial - donante activa
  await chat("contacto_inicial", [
    "sí",
    "lunes y miércoles",
    "Av. Corrientes 4521, entre Medrano y Scalabrini Ortiz, PB, Almagro",
    "1",
  ], "6. Contacto inicial: Donante confirma datos");

  // 7. Contacto inicial - donante NO dona
  await chat("contacto_inicial", [
    "no",
  ], "7. Contacto inicial: Donante ya no dona");

  // 8. Contacto inicial - dirección insuficiente y corrige
  await chat("contacto_inicial", [
    "si",
    "no sé",
    "casa",
    "Av. San Martín 3456, entre Helguera y Argerich, Villa del Parque",
    "1",
  ], "8. Contacto inicial: Corrige dirección insuficiente");

  // 9. Aviso de vacaciones
  await chat("aviso", [
    "vacaciones",
  ], "9. Donante avisa vacaciones");

  // 10. Chofer reporta incidente crítico (accidente)
  await chat("chofer", [
    "chofer",
    "1",
    "3",
    "1",
    "Choqué el camión contra un poste de luz, estoy bien pero el camión no puede seguir",
    "4",
  ], "10. Chofer #01 reporta accidente de tránsito - CRÍTICO");

  console.log(`\n${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${BOLD}  ✅ 10 conversaciones de ejemplo completadas${RESET}`);
  console.log(`${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n`);
}

main().catch(console.error);
