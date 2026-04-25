/**
 * Auditoría Meta WhatsApp Cloud API:
 *  - Texto: max 4096 chars
 *  - Caption documento: max 1024 chars
 *  - Filename: max 240 chars
 */
import { sendMessage, sendDocument, WHATSAPP_LIMITS } from "../src/bot/client";
import { isConversationWindowOpen } from "../src/services/whatsapp-window";
import { _resetRateLimit } from "../src/services/rate-limit-adaptive";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

jest.mock("../src/services/whatsapp-window", () => ({
  isConversationWindowOpen: jest.fn().mockResolvedValue(true),
}));

describe("Meta WhatsApp limits guard", () => {
  let fetchSpy: jest.SpyInstance;
  let lastBody: any;
  let tmpFile: string;

  beforeAll(() => {
    tmpFile = path.join(os.tmpdir(), `garycio-test-${Date.now()}.pdf`);
    fs.writeFileSync(tmpFile, "fake pdf content");
  });

  afterAll(() => {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  });

  beforeEach(() => {
    jest.resetAllMocks();
    (isConversationWindowOpen as jest.Mock).mockResolvedValue(true);
    _resetRateLimit();
    lastBody = null;
    fetchSpy = jest.spyOn(global, "fetch").mockImplementation((async (
      url: string,
      init: any,
    ) => {
      if (url.endsWith("/media")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "fake-media-id" }),
        } as any;
      }
      if (init?.body && typeof init.body === "string") {
        lastBody = JSON.parse(init.body);
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ id: "fake-msg-id" }] }),
      } as any;
    }) as any);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("trunca texto > 4096 chars en sendMessage", async () => {
    const longText = "x".repeat(5000);
    await sendMessage("393445721753", longText);
    const sent = lastBody.text.body as string;
    expect(sent.length).toBeLessThanOrEqual(WHATSAPP_LIMITS.MAX_TEXT_BODY);
    expect(sent.endsWith("…")).toBe(true);
  });

  it("no toca textos dentro del límite", async () => {
    const ok = "hola, mensaje normal";
    await sendMessage("393445721753", ok);
    expect(lastBody.text.body).toBe(ok);
  });

  it("trunca caption de documento > 1024 chars", async () => {
    const longCaption = "y".repeat(2000);
    await sendDocument("393445721753", tmpFile, "doc.pdf", longCaption);
    const sent = lastBody.document.caption as string;
    expect(sent.length).toBeLessThanOrEqual(WHATSAPP_LIMITS.MAX_DOC_CAPTION);
  });

  it("trunca filename largo en sendDocument", async () => {
    const longName = "a".repeat(300) + ".pdf";
    await sendDocument("393445721753", tmpFile, longName);
    const sent = lastBody.document.filename as string;
    expect(sent.length).toBeLessThanOrEqual(WHATSAPP_LIMITS.MAX_DOC_FILENAME);
  });
});
