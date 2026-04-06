import { avisoFlow } from "../../src/bot/flows/aviso";
import { createState } from "../helpers";

describe("avisoFlow", () => {
    describe("step 0 - tipo de aviso", () => {
        it("muestra menú cuando no coincide", async () => {
            const state = createState("aviso", 0);
            const res = await avisoFlow.handle(state, "hola");
            expect(res.reply).toContain("¿Por qué motivo");
            expect(res.nextStep).toBe(0);
        });

        it("acepta opción 1 (vacaciones)", async () => {
            const state = createState("aviso", 0);
            const res = await avisoFlow.handle(state, "1");
            expect(res.data?.tipoAviso).toBe("vacaciones");
            expect(res.reply).toContain("ausencia por motivo personal");
            expect(res.nextStep).toBe(1);
        });

        it("acepta opción 2 (enfermedad)", async () => {
            const state = createState("aviso", 0);
            const res = await avisoFlow.handle(state, "2");
            expect(res.data?.tipoAviso).toBe("enfermedad");
            expect(res.reply).toContain("volvamos a visitar");
            expect(res.nextStep).toBe(1);
        });

        it("acepta opción 3 (cambio de dirección)", async () => {
            const state = createState("aviso", 0);
            const res = await avisoFlow.handle(state, "3");
            expect(res.data?.tipoAviso).toBe("cambio_direccion");
            expect(res.reply).toContain("dirección");
            expect(res.nextStep).toBe(2);
        });

        it("acepta opción 4 (cambio de teléfono)", async () => {
            const state = createState("aviso", 0);
            const res = await avisoFlow.handle(state, "4");
            expect(res.data?.tipoAviso).toBe("cambio_telefono");
            expect(res.reply).toContain("teléfono");
            expect(res.nextStep).toBe(3);
        });

        it("acepta opción 0 (volver al menú principal)", async () => {
            const state = createState("aviso", 0);
            const res = await avisoFlow.handle(state, "0");
            expect(res.endFlow).toBe(true);
            expect(res.reply).toContain("menú principal");
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
            expect(res.reply).toContain("Cuando sepas");
            expect(res.endFlow).toBe(true);
        });

        it("acepta 'ni idea' sin fecha", async () => {
            const state = createState("aviso", 1, { tipoAviso: "vacaciones" });
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

    describe("step 2 - cambio de dirección", () => {
        it("rechaza dirección muy corta", async () => {
            const state = createState("aviso", 2, { tipoAviso: "cambio_direccion" });
            const res = await avisoFlow.handle(state, "abc");
            expect(res.reply).toContain("más completa");
            expect(res.nextStep).toBe(2);
        });

        it("acepta dirección válida", async () => {
            const state = createState("aviso", 2, { tipoAviso: "cambio_direccion" });
            const res = await avisoFlow.handle(state, "Av. Corrientes 1234, CABA");
            expect(res.reply).toContain("Dirección actualizada");
            expect(res.data?.nuevaDireccion).toBe("Av. Corrientes 1234, CABA");
            expect(res.endFlow).toBe(true);
            expect(res.notify?.target).toBe("admin");
        });
    });

    describe("step 3 - cambio de teléfono", () => {
        it("rechaza teléfono inválido", async () => {
            const state = createState("aviso", 3, { tipoAviso: "cambio_telefono" });
            const res = await avisoFlow.handle(state, "123");
            expect(res.reply).toContain("No parece un número");
            expect(res.nextStep).toBe(3);
        });

        it("acepta teléfono válido", async () => {
            const state = createState("aviso", 3, { tipoAviso: "cambio_telefono" });
            const res = await avisoFlow.handle(state, "1155667788");
            expect(res.reply).toContain("Teléfono actualizado");
            expect(res.data?.nuevoTelefono).toBe("1155667788");
            expect(res.endFlow).toBe(true);
            expect(res.notify?.target).toBe("admin");
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
