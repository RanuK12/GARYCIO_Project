import { reclamoFlow } from "../../src/bot/flows/reclamo";
import { createState } from "../helpers";

describe("reclamoFlow", () => {
    describe("step 0 - tipo de reclamo", () => {
        it("muestra menú cuando el mensaje no coincide", async () => {
            const state = createState("reclamo", 0);
            const res = await reclamoFlow.handle(state, "hola");
            // Menú interactivo (lista) en lugar de texto plano.
            expect(res.interactive?.body).toContain("¿Qué tipo de reclamo");
            expect(res.nextStep).toBe(0);
        });

        it("acepta opción 1 (falta bidón vacío)", async () => {
            const state = createState("reclamo", 0);
            const res = await reclamoFlow.handle(state, "1");
            expect(res.data?.tipoReclamo).toBe("falta_bidon_vacio");
            expect(res.reply).toContain("bidón vacío");
            expect(res.nextStep).toBe(2);
        });

        it("acepta opción 2 (no pasaron)", async () => {
            const state = createState("reclamo", 0);
            const res = await reclamoFlow.handle(state, "2");
            expect(res.data?.tipoReclamo).toBe("no_pasaron");
            expect(res.nextStep).toBe(2);
        });

        it("acepta opción 3 (bidón sucio) - respuesta directa", async () => {
            const state = createState("reclamo", 0);
            const res = await reclamoFlow.handle(state, "3");
            expect(res.data?.tipoReclamo).toBe("bidon_sucio");
            expect(res.reply).toContain("bidón sucio");
            expect(res.reply).toContain("Elevaremos un reclamo");
            expect(res.nextStep).toBe(3);
            expect(res.notify?.target).toBe("admin");
        });

        it("acepta opción 4 (necesito pelela) - respuesta directa", async () => {
            const state = createState("reclamo", 0);
            const res = await reclamoFlow.handle(state, "4");
            expect(res.data?.tipoReclamo).toBe("pelela");
            expect(res.reply).toContain("pelela");
            expect(res.nextStep).toBe(3);
            expect(res.notify?.target).toBe("chofer");
        });

        it("acepta opción 5 (regalo) → sub-menú", async () => {
            const state = createState("reclamo", 0);
            const res = await reclamoFlow.handle(state, "5");
            expect(res.data?.tipoReclamo).toBe("regalo");
            // Sub-menú de regalo viene como lista interactiva.
            expect(res.interactive?.body?.toLowerCase()).toContain("regalo");
            expect(res.nextStep).toBe(1);
        });

        it("acepta opción 0 (volver al menú principal)", async () => {
            const state = createState("reclamo", 0);
            const res = await reclamoFlow.handle(state, "0");
            expect(res.endFlow).toBe(true);
            // reply vacío → el conversation-manager muestra el menú principal
            expect(res.reply).toBe("");
        });
    });

    describe("step 1 - sub-menú regalo", () => {
        it("acepta opción 1 (falta regalo)", async () => {
            const state = createState("reclamo", 1, { tipoReclamo: "regalo" });
            const res = await reclamoFlow.handle(state, "1");
            expect(res.data?.subTipoRegalo).toBe("falta");
            expect(res.reply).toContain("falta el regalo");
            expect(res.nextStep).toBe(2);
        });

        it("acepta opción 2 (regalo roto)", async () => {
            const state = createState("reclamo", 1, { tipoReclamo: "regalo" });
            const res = await reclamoFlow.handle(state, "2");
            expect(res.data?.subTipoRegalo).toBe("roto");
            expect(res.reply).toContain("regalo roto");
            expect(res.nextStep).toBe(2);
        });

        it("opción inválida vuelve a mostrar sub-menú", async () => {
            const state = createState("reclamo", 1, { tipoReclamo: "regalo" });
            const res = await reclamoFlow.handle(state, "3");
            // Re-muestra el menú interactivo de regalo.
            expect(res.interactive?.body?.toLowerCase()).toContain("regalo");
            expect(res.nextStep).toBe(1);
        });
    });

    describe("step 2 - detalle del reclamo", () => {
        it("registra detalle con texto libre", async () => {
            const state = createState("reclamo", 2, { tipoReclamo: "falta_bidon_vacio", labelReclamo: "No dejaron bidón vacío" });
            const res = await reclamoFlow.handle(state, "No me dejaron nada");
            expect(res.reply).toContain("reclamo por");
            expect(res.reply).toContain("quedó registrado");
            expect(res.reply).toContain("Elevaremos un reclamo");
            expect(res.data?.detalleReclamo).toBe("No me dejaron nada");
            expect(res.nextStep).toBe(3);
            expect(res.notify?.target).toBe("chofer");
        });

        it("acepta 'no' sin detalle", async () => {
            const state = createState("reclamo", 2, { tipoReclamo: "falta_bidon_vacio", labelReclamo: "No dejaron bidón vacío" });
            const res = await reclamoFlow.handle(state, "no");
            expect(res.data?.detalleReclamo).toBeNull();
            expect(res.nextStep).toBe(3);
        });

        it("acepta 'nada' sin detalle", async () => {
            const state = createState("reclamo", 2, { tipoReclamo: "no_pasaron", labelReclamo: "No pasaron a retirar" });
            const res = await reclamoFlow.handle(state, "nada");
            expect(res.data?.detalleReclamo).toBeNull();
        });
    });

    describe("step 3 - confirmación", () => {
        it("vuelve al menú principal si dice sí", async () => {
            const state = createState("reclamo", 3);
            const res = await reclamoFlow.handle(state, "sí");
            // reply vacío → el conversation-manager muestra el menú principal directo
            expect(res.reply).toBe("");
            expect(res.endFlow).toBe(true);
        });

        it("despide si dice no", async () => {
            const state = createState("reclamo", 3);
            const res = await reclamoFlow.handle(state, "no");
            expect(res.reply).toContain("¡Buen día!");
            expect(res.endFlow).toBe(true);
        });

        it("escala texto libre con suficiente contexto a admin", async () => {
            const state = createState("reclamo", 3);
            const res = await reclamoFlow.handle(state, "quiero saber cuando van a pasar de nuevo");
            expect(res.endFlow).toBe(true);
            expect(res.notify?.target).toBe("admin");
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
