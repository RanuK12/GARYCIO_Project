import { reclamoFlow } from "../../src/bot/flows/reclamo";
import { createState } from "../helpers";

describe("reclamoFlow", () => {
    describe("step 0 - tipo de reclamo", () => {
        it("muestra menú cuando el mensaje no coincide", async () => {
            const state = createState("reclamo", 0);
            const res = await reclamoFlow.handle(state, "hola");
            expect(res.reply).toContain("¿Qué tipo de reclamo");
            expect(res.nextStep).toBe(0);
        });

        it("acepta opción 1 (regalo)", async () => {
            const state = createState("reclamo", 0);
            const res = await reclamoFlow.handle(state, "1");
            expect(res.data?.tipoReclamo).toBe("regalo");
            expect(res.reply).toContain("regalo no entregado");
            expect(res.nextStep).toBe(1);
        });

        it("acepta opción 2 (falta_bidon)", async () => {
            const state = createState("reclamo", 0);
            const res = await reclamoFlow.handle(state, "2");
            expect(res.data?.tipoReclamo).toBe("falta_bidon");
            expect(res.nextStep).toBe(1);
        });

        it("acepta opción 3 (nueva_pelela)", async () => {
            const state = createState("reclamo", 0);
            const res = await reclamoFlow.handle(state, "3");
            expect(res.data?.tipoReclamo).toBe("nueva_pelela");
            expect(res.nextStep).toBe(1);
        });

        it("acepta opción 4 (otro) y pide describir", async () => {
            const state = createState("reclamo", 0);
            const res = await reclamoFlow.handle(state, "4");
            expect(res.data?.tipoReclamo).toBe("otro");
            expect(res.reply).toContain("cuál es el problema");
            expect(res.nextStep).toBe(1);
        });

        it("acepta keyword 'pelela'", async () => {
            const state = createState("reclamo", 0);
            const res = await reclamoFlow.handle(state, "pelela");
            expect(res.data?.tipoReclamo).toBe("nueva_pelela");
        });

        it("acepta keyword 'bidón'", async () => {
            const state = createState("reclamo", 0);
            const res = await reclamoFlow.handle(state, "bidón");
            expect(res.data?.tipoReclamo).toBe("falta_bidon");
        });
    });

    describe("step 1 - detalle del reclamo", () => {
        it("registra detalle con texto libre", async () => {
            const state = createState("reclamo", 1, { tipoReclamo: "regalo" });
            const res = await reclamoFlow.handle(state, "No me dejaron nada");
            expect(res.reply).toContain("reclamo quedó registrado");
            expect(res.data?.detalleReclamo).toBe("no me dejaron nada");
            expect(res.nextStep).toBe(2);
            expect(res.notify?.target).toBe("chofer");
        });

        it("acepta 'no' sin detalle", async () => {
            const state = createState("reclamo", 1, { tipoReclamo: "regalo" });
            const res = await reclamoFlow.handle(state, "no");
            expect(res.data?.detalleReclamo).toBeNull();
            expect(res.nextStep).toBe(2);
        });

        it("acepta 'nada' sin detalle", async () => {
            const state = createState("reclamo", 1, { tipoReclamo: "falta_bidon" });
            const res = await reclamoFlow.handle(state, "nada");
            expect(res.data?.detalleReclamo).toBeNull();
        });
    });

    describe("step 2 - confirmación", () => {
        it("ofrece más opciones si dice sí", async () => {
            const state = createState("reclamo", 2);
            const res = await reclamoFlow.handle(state, "sí");
            expect(res.reply).toContain("¿En qué más te podemos ayudar?");
            expect(res.endFlow).toBe(true);
        });

        it("despide si dice no", async () => {
            const state = createState("reclamo", 2);
            const res = await reclamoFlow.handle(state, "no gracias");
            expect(res.reply).toContain("¡Buen día!");
            expect(res.endFlow).toBe(true);
        });
    });

    describe("keywords", () => {
        it("se activa con 'reclamo'", () => {
            expect(reclamoFlow.keyword).toContain("reclamo");
        });

        it("se activa con 'queja'", () => {
            expect(reclamoFlow.keyword).toContain("queja");
        });

        it("se activa con 'problema'", () => {
            expect(reclamoFlow.keyword).toContain("problema");
        });
    });
});
