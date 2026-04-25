/**
 * P0.2 — Regression: sendMessage NO reintenta errores permanentes de WhatsApp.
 * Códigos permanentes: 131030, 132000, 131026, 100, 131047, 131056.
 */

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.TEST_MODE = "false";
process.env.WHATSAPP_PROVIDER = "360dialog";
process.env.WHATSAPP_TOKEN = "fake-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "fake-id";
process.env.WHATSAPP_VERIFY_TOKEN = "fake-verify";
process.env.WHATSAPP_API_VERSION = "v22.0";
process.env.SEND_RATE_PER_SECOND = "1000";
process.env.MAX_RETRIES = "3";
process.env.DATABASE_URL = "postgres://fake:fake@localhost:5432/fake";
process.env.DB_USER = "fake";
process.env.DB_PASSWORD = "fake";
process.env.CEO_PHONE = "393445721753";
process.env.ADMIN_API_KEY = "1234567890abcdef1234";
process.env.OPENAI_API_KEY = "fake";
process.env.ADMIN_PHONES = "393445721753";

jest.mock("../src/services/whatsapp-window", () => ({
  isConversationWindowOpen: jest.fn().mockResolvedValue(true),
}));

import { sendMessage, WhatsAppAPIError } from "../src/bot/client";
import { isConversationWindowOpen } from "../src/services/whatsapp-window";
import { _resetRateLimit } from "../src/services/rate-limit-adaptive";

describe("P0.2 — sendMessage respeta isPermanent", () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    // P1.6 — los hits de tests previos (especialmente 131056) dejarían al
    // phone en backoff y harían que sendMessage cortocircuite sin tocar fetch.
    _resetRateLimit();
    (isConversationWindowOpen as jest.Mock).mockResolvedValue(true);
    fetchSpy = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function mockPermanentError(code: number) {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { code, message: `fake error ${code}` } }),
    } as any);
  }

  function mockTransientError() {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { code: 500, message: "transient" } }),
    } as any);
  }

  it("NO reintenta al recibir 131047 (re-engagement)", async () => {
    mockPermanentError(131047);
    await expect(sendMessage("393445721753", "test")).rejects.toThrow(WhatsAppAPIError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("NO reintenta al recibir 131056 (rate limit pair)", async () => {
    mockPermanentError(131056);
    await expect(sendMessage("393445721753", "test")).rejects.toThrow(WhatsAppAPIError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("NO reintenta al recibir 131030 (no WhatsApp)", async () => {
    mockPermanentError(131030);
    await expect(sendMessage("393445721753", "test")).rejects.toThrow(WhatsAppAPIError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("NO reintenta al recibir 132000 (template no existe)", async () => {
    mockPermanentError(132000);
    await expect(sendMessage("393445721753", "test")).rejects.toThrow(WhatsAppAPIError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("NO reintenta al recibir 131026 (no deliverable)", async () => {
    mockPermanentError(131026);
    await expect(sendMessage("393445721753", "test")).rejects.toThrow(WhatsAppAPIError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("SÍ reintenta al recibir error transitorio (HTTP 500)", async () => {
    mockTransientError();
    await expect(sendMessage("393445721753", "test")).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  }, 30000);

  it("isPermanent property verifica todos los códigos esperados", () => {
    const permanent = [131030, 132000, 131026, 100, 131047, 131056];
    for (const code of permanent) {
      const err = new WhatsAppAPIError("x", code, 400);
      expect(err.isPermanent).toBe(true);
    }
    const transient = [500, 503, 429];
    for (const code of transient) {
      const err = new WhatsAppAPIError("x", code, 500);
      expect(err.isPermanent).toBe(false);
    }
  });
});
