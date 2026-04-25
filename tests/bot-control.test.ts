/**
 * Test de defensa en profundidad para TEST_MODE.
 * Garantiza que isWhitelisted() corta duro a `false` para no admins
 * cuando TEST_MODE=true, sin importar la capacidad del bot.
 *
 * P0.1 — Regresion test del incidente 2026-04-23.
 */

// Setear env ANTES de importar el modulo (env se lee al importar).
process.env.TEST_MODE = "true";
process.env.ADMIN_PHONES = "393445721753,5491126330388";
process.env.TEST_PHONES = "393445721753,5491126330388";
process.env.DATABASE_URL = "postgres://fake:fake@localhost:5432/fake";
process.env.WHATSAPP_TOKEN = "test";
process.env.WHATSAPP_VERIFY_TOKEN = "test";
process.env.WHATSAPP_PROVIDER = "360dialog";
process.env.WHATSAPP_PHONE_NUMBER_ID = "test";
process.env.OPENAI_API_KEY = "";

// Mockear modulos que tocan IO externa.
jest.mock("../src/database", () => ({
  db: {
    select: jest.fn(() => ({ from: jest.fn(() => ({ where: jest.fn(() => ({ limit: jest.fn().mockResolvedValue([]) })) })) })),
    update: jest.fn(),
    insert: jest.fn(),
  },
}));

jest.mock("../src/bot/client", () => ({ sendMessage: jest.fn().mockResolvedValue({}) }));

import { isWhitelisted, isAdminPhone } from "../src/services/bot-control";

describe("P0.1 — TEST_MODE defense in depth", () => {
  describe("isAdminPhone", () => {
    it("reconoce admin italiano (Emilio)", () => {
      expect(isAdminPhone("393445721753")).toBe(true);
    });
    it("reconoce admin argentino (Stefano)", () => {
      expect(isAdminPhone("5491126330388")).toBe(true);
    });
    it("rechaza numero de donante desconocida", () => {
      expect(isAdminPhone("5491169011520")).toBe(false);
    });
  });

  describe("isWhitelisted (TEST_MODE=true)", () => {
    it("acepta admin italiano", async () => {
      await expect(isWhitelisted("393445721753")).resolves.toBe(true);
    });

    it("acepta admin argentino", async () => {
      await expect(isWhitelisted("5491126330388")).resolves.toBe(true);
    });

    it("RECHAZA donante real (caso 5491169011520 del incidente)", async () => {
      await expect(isWhitelisted("5491169011520")).resolves.toBe(false);
    });

    it("RECHAZA donante real (caso 5491157411371 del incidente)", async () => {
      await expect(isWhitelisted("5491157411371")).resolves.toBe(false);
    });

    it("RECHAZA numero random", async () => {
      await expect(isWhitelisted("5491999999999")).resolves.toBe(false);
    });

    it("RECHAZA numero vacio", async () => {
      await expect(isWhitelisted("")).resolves.toBe(false);
    });
  });
});
