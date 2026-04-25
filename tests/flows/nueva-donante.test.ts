import { nuevaDonanteFlow } from "../../src/bot/flows/nueva-donante";
import { createState } from "../helpers";

describe("nuevaDonanteFlow", () => {
    describe("step 0 - nombre", () => {
        it("rechaza nombre muy corto", async () => {
            const state = createState("nueva_donante", 0);
            const res = await nuevaDonanteFlow.handle(state, "ab");
            expect(res.reply).toContain("nombre completo");
            expect(res.nextStep).toBe(0);
        });

        it("acepta nombre válido", async () => {
            const state = createState("nueva_donante", 0);
            const res = await nuevaDonanteFlow.handle(state, "María López");
            expect(res.data?.nombre).toBe("María López");
            expect(res.reply).toContain("María López");
            expect(res.reply).toContain("dirección completa");
            expect(res.nextStep).toBe(1);
        });
    });

    describe("step 1 - dirección", () => {
        it("rechaza dirección muy corta", async () => {
            const state = createState("nueva_donante", 1, { nombre: "María" });
            const res = await nuevaDonanteFlow.handle(state, "acá");
            expect(res.reply).toContain("dirección más completa");
            expect(res.nextStep).toBe(1);
        });

        it("acepta dirección válida → pasa a confirmación", async () => {
            const state = createState("nueva_donante", 1, { nombre: "María" });
            const res = await nuevaDonanteFlow.handle(state, "Av. San Martín 456, Caballito");
            expect(res.data?.direccion).toBe("Av. San Martín 456, Caballito");
            // Flow simplificado: directo a confirmación (sin paso de días).
            expect(res.reply).toContain("Confirmemos tus datos");
            expect(res.nextStep).toBe(2);
        });
    });

    describe("step 2 - confirmación", () => {
        const baseData = {
            nombre: "María López",
            direccion: "Av. San Martín 456, Caballito",
        };

        it("confirma registro", async () => {
            const state = createState("nueva_donante", 2, baseData);
            const res = await nuevaDonanteFlow.handle(state, "1");
            expect(res.reply).toContain("registrada como nueva donante");
            expect(res.endFlow).toBe(true);
            expect(res.data?.confirmado).toBe(true);
            expect(res.notify?.target).toBe("admin");
            expect(res.notify?.message).toContain("María López");
        });

        it("corrige → vuelve al inicio", async () => {
            const state = createState("nueva_donante", 2, baseData);
            const res = await nuevaDonanteFlow.handle(state, "no, corrijo");
            expect(res.reply).toContain("nombre completo");
            expect(res.nextStep).toBe(0);
            expect(res.data).toEqual({});
        });
    });

    describe("keywords", () => {
        it("se activa con 'donar'", () => {
            expect(nuevaDonanteFlow.keyword).toContain("donar");
        });

        it("se activa con 'registrar'", () => {
            expect(nuevaDonanteFlow.keyword).toContain("registrar");
        });

        it("se activa con 'inscribir'", () => {
            expect(nuevaDonanteFlow.keyword).toContain("inscribir");
        });
    });
});
