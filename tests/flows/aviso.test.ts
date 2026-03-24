import { avisoFlow } from "../../src/bot/flows/aviso";
import { createState } from "../helpers";

describe("avisoFlow", () => {
    describe("step 0 - tipo de aviso", () => {
        it("muestra menú cuando no coincide", async () => {
            const state = createState("aviso", 0);
            const res = await avisoFlow.handle(state, "hola");
            expect(res.reply).toContain("¿Qué tipo de aviso");
            expect(res.nextStep).toBe(0);
        });

        it("acepta opción 1 (vacaciones)", async () => {
            const state = createState("aviso", 0);
            const res = await avisoFlow.handle(state, "1");
            expect(res.data?.tipoAviso).toBe("vacaciones");
            expect(res.reply).toContain("vacaciones");
            expect(res.nextStep).toBe(1);
        });

        it("acepta opción 2 (enfermedad)", async () => {
            const state = createState("aviso", 0);
            const res = await avisoFlow.handle(state, "2");
            expect(res.data?.tipoAviso).toBe("enfermedad");
            expect(res.nextStep).toBe(1);
        });

        it("acepta opción 3 (medicación)", async () => {
            const state = createState("aviso", 0);
            const res = await avisoFlow.handle(state, "3");
            expect(res.data?.tipoAviso).toBe("medicacion");
            expect(res.nextStep).toBe(1);
        });

        it("acepta keyword 'vacaciones'", async () => {
            const state = createState("aviso", 0);
            const res = await avisoFlow.handle(state, "me voy de vacaciones");
            expect(res.data?.tipoAviso).toBe("vacaciones");
        });

        it("acepta keyword parcial 'enferm'", async () => {
            const state = createState("aviso", 0);
            const res = await avisoFlow.handle(state, "estoy enferma");
            expect(res.data?.tipoAviso).toBe("enfermedad");
        });
    });

    describe("step 1 - fecha de vuelta", () => {
        it("parsea fecha dd/mm", async () => {
            const state = createState("aviso", 1, { tipoAviso: "vacaciones" });
            const res = await avisoFlow.handle(state, "15/04");
            expect(res.reply).toContain("15/04");
            expect(res.endFlow).toBe(true);
            expect(res.notify?.target).toBe("chofer");
        });

        it("parsea fecha dd-mm", async () => {
            const state = createState("aviso", 1, { tipoAviso: "vacaciones" });
            const res = await avisoFlow.handle(state, "3-05");
            expect(res.data?.fechaVuelta).toContain("03/05");
            expect(res.endFlow).toBe(true);
        });

        it("parsea 'en 2 semanas'", async () => {
            const state = createState("aviso", 1, { tipoAviso: "enfermedad" });
            const res = await avisoFlow.handle(state, "en 2 semanas");
            expect(res.data?.fechaVuelta).toBeTruthy();
            expect(res.endFlow).toBe(true);
        });

        it("acepta 'no sé' sin fecha", async () => {
            const state = createState("aviso", 1, { tipoAviso: "enfermedad" });
            const res = await avisoFlow.handle(state, "no sé");
            expect(res.data?.fechaVuelta).toBeNull();
            expect(res.reply).toContain("Cuando sepas la fecha");
            expect(res.endFlow).toBe(true);
        });

        it("acepta 'ni idea' sin fecha", async () => {
            const state = createState("aviso", 1, { tipoAviso: "medicacion" });
            const res = await avisoFlow.handle(state, "ni idea");
            expect(res.data?.fechaVuelta).toBeNull();
        });

        it("genera notificación al chofer con datos", async () => {
            const state = createState("aviso", 1, { tipoAviso: "vacaciones" });
            const res = await avisoFlow.handle(state, "15/04");
            expect(res.notify).toBeDefined();
            expect(res.notify?.target).toBe("chofer");
            expect(res.notify?.message).toContain("Aviso de donante");
        });
    });

    describe("keywords", () => {
        it("se activa con 'vacaciones'", () => {
            expect(avisoFlow.keyword).toContain("vacaciones");
        });

        it("se activa con 'enfermedad'", () => {
            expect(avisoFlow.keyword).toContain("enfermedad");
        });

        it("se activa con 'medicación'", () => {
            expect(avisoFlow.keyword).toContain("medicación");
        });
    });
});
