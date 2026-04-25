/**
 * P1.2 — CircuitBreaker unit tests.
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

import { CircuitBreaker, CircuitOpenError } from "../src/services/circuit-breaker";

describe("P1.2 — CircuitBreaker", () => {
  it("pasa llamadas mientras está CLOSED", async () => {
    const cb = new CircuitBreaker({ name: "test", threshold: 3, cooldownMs: 1000 });
    const result = await cb.exec(async () => "ok");
    expect(result).toBe("ok");
    expect(cb.getState()).toBe("CLOSED");
  });

  it("abre el circuito después de N fallos consecutivos", async () => {
    const cb = new CircuitBreaker({ name: "test", threshold: 3, cooldownMs: 1000 });
    const fail = () => cb.exec(async () => { throw new Error("boom"); });

    await expect(fail()).rejects.toThrow("boom");
    await expect(fail()).rejects.toThrow("boom");
    await expect(fail()).rejects.toThrow("boom");
    expect(cb.getState()).toBe("OPEN");
  });

  it("rechaza fast con CircuitOpenError cuando está OPEN", async () => {
    const cb = new CircuitBreaker({ name: "test", threshold: 2, cooldownMs: 10_000 });
    await cb.exec(async () => { throw new Error("x"); }).catch(() => {});
    await cb.exec(async () => { throw new Error("x"); }).catch(() => {});

    const spy = jest.fn();
    await expect(cb.exec(async () => { spy(); return "ok"; })).rejects.toBeInstanceOf(CircuitOpenError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("pasa a HALF_OPEN tras cooldown y CLOSED al primer éxito", async () => {
    const cb = new CircuitBreaker({ name: "test", threshold: 1, cooldownMs: 50 });
    await cb.exec(async () => { throw new Error("x"); }).catch(() => {});
    expect(cb.getState()).toBe("OPEN");

    await new Promise((r) => setTimeout(r, 60));
    expect(cb.getState()).toBe("HALF_OPEN");

    const result = await cb.exec(async () => "recovered");
    expect(result).toBe("recovered");
    expect(cb.getState()).toBe("CLOSED");
  });

  it("vuelve a OPEN si HALF_OPEN falla", async () => {
    const cb = new CircuitBreaker({ name: "test", threshold: 1, cooldownMs: 50 });
    await cb.exec(async () => { throw new Error("x"); }).catch(() => {});

    await new Promise((r) => setTimeout(r, 60));
    expect(cb.getState()).toBe("HALF_OPEN");

    await expect(cb.exec(async () => { throw new Error("again"); })).rejects.toThrow("again");
    expect(cb.getState()).toBe("OPEN");
  });

  it("un éxito resetea contador de fallos", async () => {
    const cb = new CircuitBreaker({ name: "test", threshold: 3, cooldownMs: 1000 });
    await cb.exec(async () => { throw new Error("x"); }).catch(() => {});
    await cb.exec(async () => { throw new Error("x"); }).catch(() => {});
    await cb.exec(async () => "ok"); // reset
    await cb.exec(async () => { throw new Error("x"); }).catch(() => {});
    await cb.exec(async () => { throw new Error("x"); }).catch(() => {});
    expect(cb.getState()).toBe("CLOSED"); // aún no llegó a 3 seguidos
  });
});
