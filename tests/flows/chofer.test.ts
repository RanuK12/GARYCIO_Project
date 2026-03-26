/**
 * Tests para el flow de chofer.
 * Se mockean: sendMessage y env (para CEO_PHONE).
 */

jest.mock("../../src/bot/client", () => ({
    sendMessage: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../src/config/env", () => ({
    env: {
        CEO_PHONE: "5411000000",
        BOT_SESSION_NAME: "test",
        PORT: 3000,
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
    },
}));

jest.mock("../../src/config/logger", () => ({
    logger: {
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        fatal: jest.fn(),
        child: jest.fn().mockReturnThis(),
    },
}));

import { choferFlow } from "../../src/bot/flows/chofer";
import { sendMessage } from "../../src/bot/client";
import { createState } from "../helpers";

describe("choferFlow", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("step 0 - identificación", () => {
        it("pide número si no lo envía", async () => {
            const state = createState("chofer", 0);
            const res = await choferFlow.handle(state, "hola");
            expect(res.reply).toContain("Registro de Chofer");
            expect(res.reply).toContain("número de chofer");
            expect(res.nextStep).toBe(0);
        });

        it("identifica al chofer con número", async () => {
            const state = createState("chofer", 0);
            const res = await choferFlow.handle(state, "3");
            expect(res.reply).toContain("Chofer #03");
            expect(res.data?.codigoChofer).toBe("03");
            expect(res.data?.choferId).toBe(3);
            expect(res.nextStep).toBe(1);
        });

        it("acepta formato CH01", async () => {
            const state = createState("chofer", 0);
            const res = await choferFlow.handle(state, "CH01");
            expect(res.data?.codigoChofer).toBe("01");
            expect(res.nextStep).toBe(1);
        });
    });

    describe("step 1 - menú principal", () => {
        const baseData = { codigoChofer: "01", choferId: 1 };

        it("opción 1 → registro de litros", async () => {
            const state = createState("chofer", 1, baseData);
            const res = await choferFlow.handle(state, "1");
            expect(res.reply).toContain("litros");
            expect(res.nextStep).toBe(2);
        });

        it("opción 2 → combustible", async () => {
            const state = createState("chofer", 1, baseData);
            const res = await choferFlow.handle(state, "2");
            expect(res.reply).toContain("combustible");
            expect(res.nextStep).toBe(10);
        });

        it("opción 3 → incidente", async () => {
            const state = createState("chofer", 1, baseData);
            const res = await choferFlow.handle(state, "3");
            expect(res.reply).toContain("Incidente");
            expect(res.nextStep).toBe(20);
        });

        it("opción 4 → finalizar jornada", async () => {
            const state = createState("chofer", 1, baseData);
            const res = await choferFlow.handle(state, "4");
            expect(res.reply).toContain("Jornada finalizada");
            expect(res.endFlow).toBe(true);
        });

        it("keyword 'litros' → registro de litros", async () => {
            const state = createState("chofer", 1, baseData);
            const res = await choferFlow.handle(state, "cargar litros");
            expect(res.nextStep).toBe(2);
        });

        it("opción inválida muestra menú de nuevo", async () => {
            const state = createState("chofer", 1, baseData);
            const res = await choferFlow.handle(state, "xyz");
            expect(res.reply).toContain("No entendí");
            expect(res.nextStep).toBe(1);
        });
    });

    describe("steps 2-4 - recolección", () => {
        const baseData = { codigoChofer: "01", choferId: 1 };

        it("rechaza litros inválidos", async () => {
            const state = createState("chofer", 2, baseData);
            const res = await choferFlow.handle(state, "abc");
            expect(res.reply).toContain("número válido de litros");
            expect(res.nextStep).toBe(2);
        });

        it("acepta litros válidos", async () => {
            const state = createState("chofer", 2, baseData);
            const res = await choferFlow.handle(state, "850");
            expect(res.data?.litros).toBe(850);
            expect(res.reply).toContain("850 litros");
            expect(res.nextStep).toBe(3);
        });

        it("acepta litros decimales con coma", async () => {
            const state = createState("chofer", 2, baseData);
            const res = await choferFlow.handle(state, "1200,5");
            expect(res.data?.litros).toBe(1200.5);
        });

        it("rechaza bidones inválidos", async () => {
            const state = createState("chofer", 3, { ...baseData, litros: 850 });
            const res = await choferFlow.handle(state, "nada");
            expect(res.reply).toContain("número válido de bidones");
            expect(res.nextStep).toBe(3);
        });

        it("acepta bidones y muestra resumen", async () => {
            const state = createState("chofer", 3, { ...baseData, litros: 850 });
            const res = await choferFlow.handle(state, "17");
            expect(res.data?.bidones).toBe(17);
            expect(res.reply).toContain("Resumen de recolección");
            expect(res.reply).toContain("850");
            expect(res.reply).toContain("17");
            expect(res.nextStep).toBe(4);
        });

        it("confirma recolección", async () => {
            const state = createState("chofer", 4, { ...baseData, litros: 850, bidones: 17 });
            const res = await choferFlow.handle(state, "1");
            expect(res.reply).toContain("Datos guardados");
            expect(res.data?.recoleccionGuardada).toBe(true);
            expect(res.notify?.target).toBe("admin");
        });

        it("corrige recolección → vuelve a litros", async () => {
            const state = createState("chofer", 4, { ...baseData, litros: 850, bidones: 17 });
            const res = await choferFlow.handle(state, "2");
            expect(res.nextStep).toBe(2);
        });
    });

    describe("steps 10-11 - combustible", () => {
        const baseData = { codigoChofer: "01", choferId: 1 };

        it("rechaza formato inválido", async () => {
            const state = createState("chofer", 10, baseData);
            const res = await choferFlow.handle(state, "45");
            expect(res.reply).toContain("litros, monto");
            expect(res.nextStep).toBe(10);
        });

        it("acepta litros y monto", async () => {
            const state = createState("chofer", 10, baseData);
            const res = await choferFlow.handle(state, "45, 12500");
            expect(res.data?.litrosCombustible).toBe(45);
            expect(res.data?.montoCombustible).toBe(12500);
            expect(res.nextStep).toBe(11);
        });

        it("confirma combustible", async () => {
            const state = createState("chofer", 11, { ...baseData, litrosCombustible: 45, montoCombustible: 12500 });
            const res = await choferFlow.handle(state, "1");
            expect(res.reply).toContain("Combustible registrado");
            expect(res.notify?.target).toBe("admin");
        });
    });

    describe("steps 20-22 - incidentes", () => {
        const baseData = { codigoChofer: "01", choferId: 1 };

        it("pide tipo de incidente", async () => {
            const state = createState("chofer", 20, baseData);
            const res = await choferFlow.handle(state, "99");
            expect(res.reply).toContain("número del tipo de incidente");
            expect(res.nextStep).toBe(20);
        });

        it("acepta tipo de incidente", async () => {
            const state = createState("chofer", 20, baseData);
            const res = await choferFlow.handle(state, "1");
            expect(res.data?.tipoIncidente).toBe("accidente");
            expect(res.reply).toContain("Accidente de tránsito");
            expect(res.nextStep).toBe(21);
        });

        it("rechaza descripción muy corta", async () => {
            const state = createState("chofer", 21, { ...baseData, tipoIncidente: "accidente" });
            const res = await choferFlow.handle(state, "mal");
            expect(res.reply).toContain("más detalle");
            expect(res.nextStep).toBe(21);
        });

        it("acepta descripción válida", async () => {
            const state = createState("chofer", 21, { ...baseData, tipoIncidente: "accidente" });
            const res = await choferFlow.handle(state, "Choqué con un auto estacionado en la esquina");
            expect(res.data?.descripcionIncidente).toBeTruthy();
            expect(res.reply).toContain("¿Qué tan grave");
            expect(res.nextStep).toBe(22);
        });

        it("registra gravedad y notifica al CEO inmediatamente", async () => {
            const state = createState("chofer", 22, {
                ...baseData,
                tipoIncidente: "accidente",
                descripcionIncidente: "Choque con auto",
            });
            const res = await choferFlow.handle(state, "3");
            expect(res.data?.gravedadIncidente).toBe("alta");
            expect(res.reply).toContain("Incidente registrado");
            expect(res.notify?.target).toBe("admin");

            // Verifica que se envió mensaje al CEO
            expect(sendMessage).toHaveBeenCalledWith(
                "5411000000",
                expect.stringContaining("INCIDENTE REPORTADO"),
            );
        });

        it("gravedad por defecto es media", async () => {
            const state = createState("chofer", 22, {
                ...baseData,
                tipoIncidente: "retraso",
                descripcionIncidente: "Llegué tarde por tráfico",
            });
            const res = await choferFlow.handle(state, "xyz");
            expect(res.data?.gravedadIncidente).toBe("media");
        });
    });

    describe("keywords", () => {
        it("se activa con 'chofer'", () => {
            expect(choferFlow.keyword).toContain("chofer");
        });

        it("se activa con 'litros'", () => {
            expect(choferFlow.keyword).toContain("litros");
        });
    });
});
