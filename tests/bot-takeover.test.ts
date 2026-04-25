/**
 * P0.10 — Detección de intervención humana y pausa del bot.
 */

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.DATABASE_URL = "postgres://fake:fake@localhost:5432/fake";
process.env.DB_USER = "fake";
process.env.DB_PASSWORD = "fake";
process.env.WHATSAPP_TOKEN = "fake";
process.env.WHATSAPP_PHONE_NUMBER_ID = "fake";
process.env.WHATSAPP_VERIFY_TOKEN = "fake";
process.env.CEO_PHONE = "393445721753";
process.env.ADMIN_API_KEY = "1234567890abcdef1234";

import {
  registerBotSentMessage,
  notifyOutboundSeen,
  pauseBotForPhone,
  isBotPaused,
  resumeBotForPhone,
  _resetTakeover,
} from "../src/services/bot-takeover";

describe("P0.10 — bot-takeover", () => {
  beforeEach(() => {
    _resetTakeover();
  });

  it("outbound con messageId conocido del bot NO pausa el bot", () => {
    registerBotSentMessage("wamid.bot1");
    notifyOutboundSeen("391111111111", "wamid.bot1");
    expect(isBotPaused("391111111111")).toBe(false);
  });

  it("outbound con messageId desconocido PAUSA el bot", () => {
    notifyOutboundSeen("392222222222", "wamid.humano-mandó");
    expect(isBotPaused("392222222222")).toBe(true);
  });

  it("pausa expira tras el TTL", () => {
    pauseBotForPhone("393333333333", "test", 20);
    expect(isBotPaused("393333333333")).toBe(true);
    return new Promise((resolve) => {
      setTimeout(() => {
        expect(isBotPaused("393333333333")).toBe(false);
        resolve(null);
      }, 40);
    });
  });

  it("nuevos mensajes humanos refrescan el TTL", () => {
    pauseBotForPhone("394444444444", "primero", 1_000);
    const t1 = Date.now();
    pauseBotForPhone("394444444444", "segundo", 60 * 60 * 1000);
    expect(isBotPaused("394444444444")).toBe(true);
    // El TTL debe ser del último (1h, no 1s)
    expect(Date.now() - t1).toBeLessThan(60_000);
  });

  it("resumeBotForPhone desbloquea manualmente", () => {
    pauseBotForPhone("395555555555", "test");
    expect(isBotPaused("395555555555")).toBe(true);
    resumeBotForPhone("395555555555");
    expect(isBotPaused("395555555555")).toBe(false);
  });

  it("ignora messageId/phone falsy sin pausar", () => {
    notifyOutboundSeen("396666666666", "");
    notifyOutboundSeen("", "wamid.x");
    notifyOutboundSeen("396666666666", null);
    expect(isBotPaused("396666666666")).toBe(false);
  });

  it("mensaje del bot primero, después mensaje humano → pausa", () => {
    registerBotSentMessage("wamid.bot-respuesta");
    notifyOutboundSeen("397777777777", "wamid.bot-respuesta");
    expect(isBotPaused("397777777777")).toBe(false);

    // Admin responde manualmente después
    notifyOutboundSeen("397777777777", "wamid.admin-manual");
    expect(isBotPaused("397777777777")).toBe(true);
  });
});
