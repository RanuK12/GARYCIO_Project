/**
 * Stress test: múltiples mensajes seguidos del MISMO usuario.
 * Valida que el lock por usuario serialice correctamente.
 */

const http = require("http");

const phone = "5491199999999";
const messageCount = 20;
const delayMs = 0;

const stats = { sent: 0, ok: 0, error: 0, startTime: Date.now(), latencies: [] };

function sendWebhook(messageId, text) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{
        id: "TEST",
        changes: [{
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "1234567890", phone_number_id: "TEST" },
            contacts: [{ profile: { name: "Test User" }, wa_id: phone }],
            messages: [{
              from: phone,
              id: messageId,
              timestamp: String(Math.floor(Date.now() / 1000)),
              type: "text",
              text: { body: text },
            }],
          },
          field: "messages",
        }],
      }],
    });
    const start = Date.now();
    const req = http.request({
      hostname: "127.0.0.1", port: 3000, path: "/webhook", method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      timeout: 30000,
    }, (res) => {
      stats.latencies.push(Date.now() - start);
      stats.sent++;
      if (res.statusCode === 200) stats.ok++;
      else stats.error++;
      resolve();
    });
    req.on("error", () => { stats.sent++; stats.error++; resolve(); });
    req.on("timeout", () => { req.destroy(); stats.sent++; stats.error++; resolve(); });
    req.write(payload);
    req.end();
  });
}

async function run() {
  console.log(`🚀 Stress test mismo usuario: ${phone} × ${messageCount} mensajes`);
  for (let i = 0; i < messageCount; i++) {
    await sendWebhook(`wamid.sameuser.${i}.${Date.now()}`, `Mensaje ${i + 1}`);
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }
  const duration = Date.now() - stats.startTime;
  const avg = stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length;
  console.log(`📊 Enviados: ${stats.sent}, OK: ${stats.ok}, Error: ${stats.error}, Duración: ${duration}ms, Latencia avg: ${avg.toFixed(0)}ms`);
  if (stats.error === 0) {
    console.log("✅ PASS — Sin errores");
    process.exit(0);
  } else {
    console.log("❌ FAIL — Hubo errores");
    process.exit(1);
  }
}
run();
