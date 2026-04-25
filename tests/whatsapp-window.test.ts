/**
 * P0.3 — Pre-check ventana 24h de WhatsApp.
 * sendMessage debe rechazar (sin llamar a la API) si no hay inbound reciente.
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

const mockIsOpen = jest.fn();
jest.mock("../src/services/whatsapp-window", () => ({
  isConversationWindowOpen: (...args: any[]) => mockIsOpen(...args),
}));

import { sendMessage, WhatsAppAPIError } from "../src/bot/client";

describe("P0.3 — Pre-check ventana 24h", () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: "ok" }] }),
    } as any);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("bloquea envío si ventana 24h cerrada y NO llama a la API", async () => {
    mockIsOpen.mockResolvedValue(false);
    await expect(sendMessage("393445721753", "hola")).rejects.toThrow(WhatsAppAPIError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("error lanzado tiene code=131047 y isPermanent=true", async () => {
    mockIsOpen.mockResolvedValue(false);
    try {
      await sendMessage("393445721753", "hola");
      fail("no tiró");
    } catch (err) {
      expect(err).toBeInstanceOf(WhatsAppAPIError);
      expect((err as WhatsAppAPIError).code).toBe(131047);
      expect((err as WhatsAppAPIError).isPermanent).toBe(true);
    }
  });

  it("permite envío cuando la ventana está abierta", async () => {
    mockIsOpen.mockResolvedValue(true);
    await expect(sendMessage("393445721753", "hola")).resolves.toBeDefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
