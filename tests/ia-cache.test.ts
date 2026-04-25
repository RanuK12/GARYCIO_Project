/**
 * P1.3 — Cache LRU del clasificador IA.
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

import { cacheGet, cacheSet, normalizeMessage, _cacheReset, cacheStats } from "../src/services/ia-cache";
import type { ClassifierResult } from "../src/services/clasificador-ia";

const makeResult = (overrides: Partial<ClassifierResult> = {}): ClassifierResult => ({
  intent: "saludo",
  entities: [],
  needsHuman: false,
  sentiment: "calm",
  confidence: "high",
  ...overrides,
});

describe("P1.3 — ia-cache", () => {
  beforeEach(() => {
    _cacheReset();
  });

  it("normaliza acentos, mayúsculas y espacios", () => {
    expect(normalizeMessage("  Hóla  Mundo  ")).toBe("hola mundo");
    expect(normalizeMessage("GRACIAS")).toBe("gracias");
  });

  it("cacheSet + cacheGet retorna el resultado", () => {
    const r = makeResult({ intent: "saludo" });
    cacheSet("hola", r);
    expect(cacheGet("hola")).toEqual(r);
  });

  it("es case/accent-insensitive vía normalización", () => {
    const r = makeResult({ intent: "saludo" });
    cacheSet("HÓLA", r);
    expect(cacheGet("hola")).toEqual(r);
  });

  it("NO cachea si needsHuman=true", () => {
    cacheSet("quiero hablar con humano", makeResult({ needsHuman: true }));
    expect(cacheGet("quiero hablar con humano")).toBeNull();
  });

  it("NO cachea si confidence=low", () => {
    cacheSet("mensaje raro", makeResult({ confidence: "low" }));
    expect(cacheGet("mensaje raro")).toBeNull();
  });

  it("TTL expira la entrada", () => {
    const r = makeResult();
    cacheSet("temporal", r, 10);
    expect(cacheGet("temporal")).toEqual(r);
    return new Promise((resolve) => {
      setTimeout(() => {
        expect(cacheGet("temporal")).toBeNull();
        resolve(null);
      }, 20);
    });
  });

  it("respeta el límite máximo (LRU evict)", () => {
    for (let i = 0; i < 600; i++) {
      cacheSet(`msg${i}`, makeResult({ intent: "saludo" }));
    }
    expect(cacheStats().size).toBeLessThanOrEqual(500);
    // Los primeros deberían haber sido desalojados
    expect(cacheGet("msg0")).toBeNull();
    expect(cacheGet("msg599")).not.toBeNull();
  });
});
