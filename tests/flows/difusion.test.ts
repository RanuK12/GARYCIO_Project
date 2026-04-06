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
            expect(res.reply).toContain("reclamo");
            expect(res.reply).toContain("aviso");
            expect(res.reply).toContain("Otro motivo");
            expect(res.endFlow).toBe(true);
        });

        it("opción inválida → pide de nuevo", async () => {
            const state = createState("difusion", 0);
            const res = await difusionFlow.handle(state, "hola");
            expect(res.reply).toContain("No entendí");
            expect(res.reply).toContain("*1*");
            expect(res.reply).toContain("*2*");
            expect(res.nextStep).toBe(0);
        });
    });

    describe("keywords", () => {
        it("no tiene keywords (solo se inicia por programación)", () => {
            expect(difusionFlow.keyword).toEqual([]);
        });
    });
});
