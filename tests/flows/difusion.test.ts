jest.mock("../../src/config/env", () => ({
    env: {
        CEO_PHONE: "5411000000",
        ADMIN_PHONES: "5411000000",
        BOT_SESSION_NAME: "test",
        PORT: 3000,
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
        DATABASE_URL: "postgres://test",
    },
}));

jest.mock("../../src/database", () => ({
    db: {
        update: jest.fn().mockReturnValue({
            set: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                    // chain final: .returning() existe en el flow real
                    returning: jest.fn().mockResolvedValue([{ telefono: "5411000000" }]),
                }),
            }),
        }),
    },
}));

import { difusionFlow } from "../../src/bot/flows/difusion";
import { createState } from "../helpers";

describe("difusionFlow", () => {
    describe("step 0 - respuesta a difusión", () => {
        it("confirma recepción con opción 1", async () => {
            const state = createState("difusion", 0, { diasAsignados: "Lunes y Jueves" });
            const res = await difusionFlow.handle(state, "1");
            expect(res.reply).toContain("Recepción confirmada");
            expect(res.data?.confirmado).toBe(true);
            expect(res.endFlow).toBe(true);
            expect(res.notify?.target).toBe("admin");
        });

        it("opción 2 → muestra menú de donantes", async () => {
            const state = createState("difusion", 0);
            const res = await difusionFlow.handle(state, "2");
            // Menú principal viene como botones interactivos.
            const titles = res.interactive?.buttons?.map((b) => b.title) ?? [];
            expect(titles.join(" ").toLowerCase()).toContain("reclamo");
            expect(titles.join(" ").toLowerCase()).toContain("aviso");
            expect(titles.join(" ").toLowerCase()).toContain("consulta");
            expect(res.endFlow).toBe(true);
        });

        it("opción inválida → pide de nuevo", async () => {
            const state = createState("difusion", 0);
            const res = await difusionFlow.handle(state, "hola");
            expect(res.reply).toContain("No entendí");
            // Las opciones 1 y 2 vienen ahora como botones interactivos.
            const ids = res.interactive?.buttons?.map((b) => b.id) ?? [];
            expect(ids).toContain("1");
            expect(ids).toContain("2");
            expect(res.nextStep).toBe(0);
        });
    });

    describe("keywords", () => {
        it("no tiene keywords (solo se inicia por programación)", () => {
            expect(difusionFlow.keyword).toEqual([]);
        });
    });
});
