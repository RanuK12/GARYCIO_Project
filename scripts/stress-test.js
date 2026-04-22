/**
 * Stress test local para GARYCIO Bot
 * Simula carga de webhooks de WhatsApp sin exponer el bot públicamente.
 * Uso: node scripts/stress-test.js [concurrentUsers] [messagesPerUser] [delayMs]
 */

const http = require("http");

const concurrentUsers = parseInt(process.argv[2]) || 50;
const messagesPerUser = parseInt(process.argv[3]) || 5;
const delayMs = parseInt(process.argv[4]) || 100;

const stats = {
  sent: 0,
  ok: 0,
  error: 0,
  timeouts: 0,
  startTime: Date.now(),
  latencies: [],
};

function makeWebhookPayload(phone, messageId, text) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "TEST",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "1234567890", phone_number_id: "TEST" },
              contacts: [{ profile: { name: "Test User" }, wa_id: phone }],
              messages: [
                {
                  from: phone,
                  id: messageId,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: text },
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
}

function sendWebhook(phone, messageId, text) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(makeWebhookPayload(phone, messageId, text));
    const start = Date.now();

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: 3000,
        path: "/webhook",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: 30000,
      },
      (res) => {
        const latency = Date.now() - start;
        stats.latencies.push(latency);
        stats.sent++;
        if (res.statusCode === 200) stats.ok++;
        else stats.error++;
        resolve();
      }
    );

    req.on("error", () => {
      stats.sent++;
      stats.error++;
      resolve();
    });

    req.on("timeout", () => {
      req.destroy();
      stats.sent++;
      stats.timeouts++;
      resolve();
    });

    req.write(payload);
    req.end();
  });
}

async function run() {
  console.log(`🚀 Stress test iniciado: ${concurrentUsers} usuarios × ${messagesPerUser} mensajes = ${concurrentUsers * messagesPerUser} total`);

  const promises = [];
  for (let u = 0; u < concurrentUsers; u++) {
    const phone = `54911${String(10000000 + u).slice(1)}`;
    promises.push(
      (async () => {
        for (let m = 0; m < messagesPerUser; m++) {
          const messageId = `wamid.test.${phone}.${m}.${Date.now()}`;
          await sendWebhook(phone, messageId, `Mensaje de prueba ${m + 1} del usuario ${u + 1}`);
          if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
        }
      })()
    );
  }

  await Promise.all(promises);

  const duration = Date.now() - stats.startTime;
  const latencies = stats.latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;
  const avg = latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1);
  const rps = ((stats.sent / duration) * 1000).toFixed(1);

  console.log("\n📊 Resultados del stress test:");
  console.log(`  Total enviados: ${stats.sent}`);
  console.log(`  HTTP 200 OK:    ${stats.ok}`);
  console.log(`  Errores:        ${stats.error}`);
  console.log(`  Timeouts:       ${stats.timeouts}`);
  console.log(`  Duración:       ${duration}ms`);
  console.log(`  RPS:            ${rps}`);
  console.log(`  Latencia avg:   ${avg.toFixed(0)}ms`);
  console.log(`  Latencia p50:   ${p50}ms`);
  console.log(`  Latencia p95:   ${p95}ms`);
  console.log(`  Latencia p99:   ${p99}ms`);

  if (stats.error + stats.timeouts === 0) {
    console.log("\n✅ PASS — Sin errores ni timeouts");
    process.exit(0);
  } else {
    console.log("\n❌ FAIL — Hubo errores o timeouts");
    process.exit(1);
  }
}

run();
