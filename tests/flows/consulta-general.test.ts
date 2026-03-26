import { consultaGeneralFlow } from "../../src/bot/flows/consulta-general";
import { createState } from "../helpers";

describe("consultaGeneralFlow", () => {
    describe("step 0 - menú de consultas", () => {
        it("muestra menú cuando no es número válido", async () => {
            const state = createState("consulta_general", 0);
            const res = await consultaGeneralFlow.handle(state, "hola");
            expect(res.reply).toContain("¿Sobre qué querés consultar?");
            expect(res.nextStep).toBe(0);
        });

        it("responde FAQ 1 (días de recolección)", async () => {
            const state = createState("consulta_general", 0);
            const res = await consultaGeneralFlow.handle(state, "1");
            expect(res.reply).toContain("Días de recolección");
            expect(res.data?.consultaTipo).toBe("Días de recolección");
            expect(res.nextStep).toBe(1);
        });

        it("responde FAQ 2 (regalos y beneficios)", async () => {
            const state = createState("consulta_general", 0);
            const res = await consultaGeneralFlow.handle(state, "2");
            expect(res.reply).toContain("Regalos y beneficios");
            expect(res.data?.consultaTipo).toBe("Regalos y beneficios");
        });

        it("responde FAQ 3 (cambio de dirección)", async () => {
            const state = createState("consulta_general", 0);
            const res = await consultaGeneralFlow.handle(state, "3");
            expect(res.reply).toContain("Cambio de dirección");
        });

        it("responde FAQ 4 (dejar de donar)", async () => {
            const state = createState("consulta_general", 0);
            const res = await consultaGeneralFlow.handle(state, "4");
            expect(res.reply).toContain("Dejar de donar");
        });
    });

    describe("step 1 - respuesta de consulta", () => {
        it("ofrece más ayuda si dice sí", async () => {
            const state = createState("consulta_general", 1, { consultaTipo: "Días de recolección" });
            const res = await consultaGeneralFlow.handle(state, "sí");
            expect(res.reply).toContain("¿En qué más te puedo ayudar?");
            expect(res.endFlow).toBe(true);
        });

        it("despide si dice no", async () => {
            const state = createState("consulta_general", 1, { consultaTipo: "Regalos" });
            const res = await consultaGeneralFlow.handle(state, "no");
            expect(res.reply).toContain("¡Buen día!");
            expect(res.endFlow).toBe(true);
        });

        it("registra consulta libre y notifica admin", async () => {
            const state = createState("consulta_general", 1);
            const res = await consultaGeneralFlow.handle(state, "cuándo van a venir a buscar los bidones vacíos?");
            expect(res.reply).toContain("consulta fue registrada");
            expect(res.data?.consultaLibre).toBeTruthy();
            expect(res.notify?.target).toBe("admin");
            expect(res.nextStep).toBe(1);
        });
    });

    describe("keywords", () => {
        it("se activa con 'consulta'", () => {
            expect(consultaGeneralFlow.keyword).toContain("consulta");
        });

        it("se activa con 'ayuda'", () => {
            expect(consultaGeneralFlow.keyword).toContain("ayuda");
        });

        it("se activa con '3' (opción del menú principal)", () => {
            expect(consultaGeneralFlow.keyword).toContain("3");
        });
    });
});
