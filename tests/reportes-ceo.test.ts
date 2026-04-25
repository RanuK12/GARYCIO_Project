/**
 * P0.4 — Throttle + dedup de notificarAdmins.
 */

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.TEST_MODE = "false";
process.env.WHATSAPP_PROVIDER = "360dialog";
process.env.WHATSAPP_TOKEN = "fake";
process.env.WHATSAPP_PHONE_NUMBER_ID = "fake";
process.env.WHATSAPP_VERIFY_TOKEN = "fake";
process.env.SEND_RATE_PER_SECOND = "1000";
process.env.MAX_RETRIES = "0";
process.env.DATABASE_URL = "postgres://fake:fake@localhost:5432/fake";
process.env.DB_USER = "fake";
process.env.DB_PASSWORD = "fake";
process.env.CEO_PHONE = "393445721753";
process.env.ADMIN_API_KEY = "1234567890abcdef1234";
process.env.OPENAI_API_KEY = "fake";
process.env.ADMIN_PHONES = "5491126330388";

const mockSend = jest.fn().mockResolvedValue({});
jest.mock("../src/bot/client", () => ({
  sendMessage: (...args: any[]) => mockSend(...args),
  WhatsAppAPIError: class extends Error {},
}));
jest.mock("../src/services/dead-letter-queue", () => ({
  addToDeadLetterQueue: jest.fn().mockResolvedValue(undefined),
}));

import { notificarAdmins, _resetNotificarAdminsThrottle } from "../src/services/reportes-ceo";

describe("P0.4 — notificarAdmins dedup + throttle", () => {
  beforeEach(() => {
    _resetNotificarAdminsThrottle();
    mockSend.mockClear();
  });

  it("primer mensaje llega a ambos admins", async () => {
    await notificarAdmins("alerta A");
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("dedup: mensaje idéntico repetido en <60s se ignora", async () => {
    await notificarAdmins("alerta X");
    mockSend.mockClear();
    await notificarAdmins("alerta X");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("mensajes diferentes NO son deduplicados", async () => {
    await notificarAdmins("alerta 1");
    _resetNotificarAdminsThrottle(); // reset lastSent para no bloquear 10s en tests
    mockSend.mockClear();
    await notificarAdmins("alerta 2");
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
