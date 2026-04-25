/**
 * P0.12 — Debounce 10s por teléfono (acá usamos ventana corta para tests).
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

import { debounceInbound, _resetDebounce } from "../src/services/inbound-debounce";
import type { InboundJob } from "../src/services/queue";

const mkJob = (phone: string, text: string, messageId: string): InboundJob => ({
  phone,
  text,
  messageId,
});

describe("P0.12 — inbound-debounce", () => {
  beforeEach(() => {
    _resetDebounce();
  });

  it("un solo mensaje: flushea tras la ventana", async () => {
    const onFlush = jest.fn().mockResolvedValue(undefined);
    const p = debounceInbound(mkJob("391", "hola", "m1"), { onFlush, windowMs: 50 });
    await p;
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0].text).toBe("hola");
  });

  it("mensajes seguidos del mismo teléfono se concatenan y flushean 1 vez", async () => {
    const onFlush = jest.fn().mockResolvedValue(undefined);
    const p1 = debounceInbound(mkJob("392", "hola", "m1"), { onFlush, windowMs: 60 });
    await new Promise((r) => setTimeout(r, 20));
    const p2 = debounceInbound(mkJob("392", "no vinieron", "m2"), { onFlush, windowMs: 60 });
    await new Promise((r) => setTimeout(r, 20));
    const p3 = debounceInbound(mkJob("392", "ayer", "m3"), { onFlush, windowMs: 60 });

    await Promise.all([p1, p2, p3]);

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0].text).toBe("hola no vinieron ayer");
    expect(onFlush.mock.calls[0][0].messageId).toBe("m3");
  });

  it("dos teléfonos distintos se flushean independientemente", async () => {
    const onFlush = jest.fn().mockResolvedValue(undefined);
    const pA = debounceInbound(mkJob("393", "a", "m1"), { onFlush, windowMs: 50 });
    const pB = debounceInbound(mkJob("394", "b", "m2"), { onFlush, windowMs: 50 });
    await Promise.all([pA, pB]);
    expect(onFlush).toHaveBeenCalledTimes(2);
  });

  it("si onFlush rechaza, todos los waiters del batch rechazan", async () => {
    const onFlush = jest.fn().mockRejectedValue(new Error("boom"));
    const p1 = debounceInbound(mkJob("395", "a", "m1"), { onFlush, windowMs: 30 });
    const p2 = debounceInbound(mkJob("395", "b", "m2"), { onFlush, windowMs: 30 });

    await expect(p1).rejects.toThrow("boom");
    await expect(p2).rejects.toThrow("boom");
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it("cada mensaje nuevo resetea el timer (trailing debounce)", async () => {
    const onFlush = jest.fn().mockResolvedValue(undefined);
    const start = Date.now();
    const p1 = debounceInbound(mkJob("396", "a", "m1"), { onFlush, windowMs: 50 });
    await new Promise((r) => setTimeout(r, 30)); // no expira aún
    const p2 = debounceInbound(mkJob("396", "b", "m2"), { onFlush, windowMs: 50 });
    await Promise.all([p1, p2]);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(70); // 30 + 50 mínimo
    expect(onFlush).toHaveBeenCalledTimes(1);
  });
});
