import { visitadoraFlow } from "../../src/bot/flows/visitadora";
import { createState } from "../helpers";

describe("visitadoraFlow", () => {
    describe("step 0 - identificación", () => {
        it("pide nombre si input es muy corto", async () => {
            const state = createState("visitadora", 0);
            const res = await visitadoraFlow.handle(state, "a");
            expect(res.reply).toContain("Registro de Visitadora");
            expect(res.reply).toContain("nombre");
            expect(res.nextStep).toBe(0);
        });

        it("identifica a la visitadora con nombre", async () => {
            const state = createState("visitadora", 0);
            const res = await visitadoraFlow.handle(state, "Ana García");
            expect(res.reply).toContain("Ana García");
            expect(res.data?.nombreVisitadora).toBe("Ana García");
            expect(res.nextStep).toBe(1);
        });
    });

    describe("step 1 - menú principal", () => {
        it("opción 1 → cargar nueva donante", async () => {
            const state = createState("visitadora", 1, { nombreVisitadora: "Ana" });
            const res = await visitadoraFlow.handle(state, "1");
            expect(res.reply).toContain("nueva donante");
            expect(res.nextStep).toBe(10);
        });

        it("opción 0 → salir", async () => {
            const state = createState("visitadora", 1, { nombreVisitadora: "Ana" });
            const res = await visitadoraFlow.handle(state, "0");
            expect(res.endFlow).toBe(true);
        });

        it("opción inválida muestra error", async () => {
            const state = createState("visitadora", 1, { nombreVisitadora: "Ana" });
            const res = await visitadoraFlow.handle(state, "5");
            expect(res.reply).toContain("no válida");
            expect(res.nextStep).toBe(1);
        });
    });

    describe("steps 10-13 - cargar nueva donante", () => {
        const baseData = { nombreVisitadora: "Ana" };

        it("rechaza nombre muy corto", async () => {
            const state = createState("visitadora", 10, baseData);
            const res = await visitadoraFlow.handle(state, "ab");
            expect(res.nextStep).toBe(10);
        });

        it("acepta nombre válido y pide dirección", async () => {
            const state = createState("visitadora", 10, baseData);
            const res = await visitadoraFlow.handle(state, "María López");
            expect(res.data?.nuevaDonNombre).toBe("María López");
            expect(res.reply).toContain("dirección");
            expect(res.nextStep).toBe(11);
        });

        it("rechaza dirección muy corta", async () => {
            const state = createState("visitadora", 11, { ...baseData, nuevaDonNombre: "María" });
            const res = await visitadoraFlow.handle(state, "abc");
            expect(res.nextStep).toBe(11);
        });

        it("acepta dirección y pide teléfono", async () => {
            const state = createState("visitadora", 11, { ...baseData, nuevaDonNombre: "María" });
            const res = await visitadoraFlow.handle(state, "Belgrano 123, Caballito");
            expect(res.data?.nuevaDonDireccion).toBe("Belgrano 123, Caballito");
            expect(res.reply).toContain("teléfono");
            expect(res.nextStep).toBe(12);
        });

        it("acepta teléfono y pide fecha de nacimiento", async () => {
            const state = createState("visitadora", 12, {
                ...baseData,
                nuevaDonNombre: "María López",
                nuevaDonDireccion: "Belgrano 123",
            });
            const res = await visitadoraFlow.handle(state, "1155667788");
            expect(res.data?.nuevaDonTelefono).toBe("1155667788");
            expect(res.reply).toContain("fecha de nacimiento");
            expect(res.nextStep).toBe(13);
        });

        it("acepta 'no tiene' como teléfono", async () => {
            const state = createState("visitadora", 12, {
                ...baseData,
                nuevaDonNombre: "María López",
                nuevaDonDireccion: "Belgrano 123",
            });
            const res = await visitadoraFlow.handle(state, "no tiene");
            expect(res.data?.nuevaDonTelefono).toBeNull();
            expect(res.nextStep).toBe(13);
        });

        it("acepta fecha de nacimiento y muestra confirmación", async () => {
            const state = createState("visitadora", 13, {
                ...baseData,
                nuevaDonNombre: "María López",
                nuevaDonDireccion: "Belgrano 123",
                nuevaDonTelefono: "1155667788",
            });
            const res = await visitadoraFlow.handle(state, "15/04/1985");
            expect(res.data?.nuevaDonFechaNac).toBe("15/04/1985");
            expect(res.reply).toContain("Confirmar");
            expect(res.reply).toContain("María López");
            expect(res.nextStep).toBe(14);
        });

        it("confirmar → registra y notifica admin", async () => {
            const state = createState("visitadora", 14, {
                ...baseData,
                nuevaDonNombre: "María López",
                nuevaDonDireccion: "Belgrano 123",
                nuevaDonTelefono: "1155667788",
                nuevaDonFechaNac: "15/04/1985",
            });
            const res = await visitadoraFlow.handle(state, "1");
            expect(res.reply).toContain("Nueva donante registrada");
            expect(res.data?.donanteRegistrada).toBe(true);
            expect(res.notify?.target).toBe("admin");
            expect(res.nextStep).toBe(99);
        });

        it("cancelar → va a step 99", async () => {
            const state = createState("visitadora", 14, baseData);
            const res = await visitadoraFlow.handle(state, "2");
            expect(res.reply).toContain("Cancelado");
            expect(res.nextStep).toBe(99);
        });
    });

    describe("step 99 - volver o finalizar", () => {
        it("opción 1 → vuelve al menú", async () => {
            const state = createState("visitadora", 99);
            const res = await visitadoraFlow.handle(state, "1");
            expect(res.nextStep).toBe(1);
        });

        it("opción 2 → finaliza sesión", async () => {
            const state = createState("visitadora", 99);
            const res = await visitadoraFlow.handle(state, "2");
            expect(res.endFlow).toBe(true);
        });
    });

    describe("keywords", () => {
        it("se activa con 'visitadora'", () => {
            expect(visitadoraFlow.keyword).toContain("visitadora");
        });

        it("se activa con 'visita'", () => {
            expect(visitadoraFlow.keyword).toContain("visita");
        });
    });
});
