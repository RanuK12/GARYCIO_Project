/**
 * Tests para el flow de chofer.
 * Se mockean: sendMessage, env, image-processor y DB.
 */

jest.mock("../../src/bot/client", () => ({
    sendMessage: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../src/config/env", () => ({
    env: {
        CEO_PHONE: "5411000000",
        ADMIN_PHONES: "5411000000,5411000001",
        BOT_SESSION_NAME: "test",
        PORT: 3000,
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
    },
}));

jest.mock("../../src/services/image-processor", () => ({
    procesarComprobante: jest.fn().mockResolvedValue({
        filePath: "/tmp/test.jpg",
        registroId: 1,
        guardadoEnDB: true,
        datosExtraidos: { litros: null, bidones: null, monto: null, fecha: null, patente: null, confianza: 0 },
    }),
}));

jest.mock("../../src/database", () => ({
    db: {},
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

        it("opción 4 → foto/comprobante", async () => {
            const state = createState("chofer", 1, baseData);
            const res = await choferFlow.handle(state, "4");
            expect(res.reply).toContain("Comprobante");
            expect(res.nextStep).toBe(30);
        });

        it("opción 5 → baja donante", async () => {
            const state = createState("chofer", 1, baseData);
            const res = await choferFlow.handle(state, "5");
            expect(res.reply).toContain("baja");
            expect(res.nextStep).toBe(40);
        });

        it("opción 6 → regalos entregados a peones", async () => {
            const state = createState("chofer", 1, baseData);
            const res = await choferFlow.handle(state, "6");
            expect(res.nextStep).toBe(50);
            expect(res.reply).toContain("peones");
        });

        it("opción 0 → volver al menú principal (endFlow)", async () => {
            const state = createState("chofer", 1, baseData);
            const res = await choferFlow.handle(state, "0");
            expect(res.endFlow).toBe(true);
            expect(res.reply).toContain("menú principal");
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

        it("confirma recolección → va a step 99 (no a step 1)", async () => {
            const state = createState("chofer", 4, { ...baseData, litros: 850, bidones: 17 });
            const res = await choferFlow.handle(state, "1");
            expect(res.reply).toContain("Datos guardados");
            expect(res.data?.recoleccionGuardada).toBe(true);
            expect(res.notify?.target).toBe("admin");
            // CRITICAL: debe ir a step 99 (volver/finalizar), NO a step 1 (menú)
            expect(res.nextStep).toBe(99);
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

        it("confirma combustible → va a step 99 (no a step 1)", async () => {
            const state = createState("chofer", 11, { ...baseData, litrosCombustible: 45, montoCombustible: 12500 });
            const res = await choferFlow.handle(state, "1");
            expect(res.reply).toContain("Combustible registrado");
            expect(res.notify?.target).toBe("admin");
            // CRITICAL: debe ir a step 99
            expect(res.nextStep).toBe(99);
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

        it("registra gravedad y notifica admin", async () => {
            const state = createState("chofer", 22, {
                ...baseData,
                tipoIncidente: "accidente",
                descripcionIncidente: "Choque con auto",
            });
            const res = await choferFlow.handle(state, "3");
            expect(res.data?.gravedadIncidente).toBe("alta");
            expect(res.reply).toContain("Incidente registrado");
            expect(res.notify?.target).toBe("admin");
            expect(res.notify?.message).toContain("INCIDENTE REPORTADO");
            // CRITICAL: debe ir a step 99
            expect(res.nextStep).toBe(99);
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

    describe("step 99 - volver al menú o finalizar (FIX del ciclo)", () => {
        const baseData = { codigoChofer: "01", choferId: 1, litros: 850, bidones: 17 };

        it("opción 1 en step 99 → vuelve al menú chofer (step 1)", async () => {
            const state = createState("chofer", 99, baseData);
            const res = await choferFlow.handle(state, "1");
            expect(res.nextStep).toBe(1);
            expect(res.endFlow).toBeUndefined();
            // Debe mostrar el menú completo de opciones
            expect(res.reply).toContain("Litros y bidones");
            expect(res.reply).toContain("combustible");
            expect(res.reply).toContain("Reportar incidente");
            expect(res.reply).toContain("Regalos entregados");
            expect(res.reply).toContain("Volver al menú principal");
        });

        it("opción 0 en step 99 → vuelve al menú principal (endFlow)", async () => {
            const state = createState("chofer", 99, baseData);
            const res = await choferFlow.handle(state, "0");
            expect(res.endFlow).toBe(true);
            expect(res.reply).toContain("menú principal");
        });

        it("opción 2 en step 99 → finaliza jornada", async () => {
            const state = createState("chofer", 99, baseData);
            const res = await choferFlow.handle(state, "2");
            expect(res.endFlow).toBe(true);
            expect(res.reply).toContain("Jornada finalizada");
            expect(res.notify?.target).toBe("admin");
        });

        it("cualquier otra respuesta en step 99 → finaliza jornada", async () => {
            const state = createState("chofer", 99, baseData);
            const res = await choferFlow.handle(state, "xyz");
            expect(res.endFlow).toBe(true);
        });

        it("ciclo completo: litros → confirmar → step 99 → volver al menú → combustible", async () => {
            // Simular el flujo completo que antes se rompía
            const data = { codigoChofer: "01", choferId: 1 };

            // 1. Ingreso de litros
            let state = createState("chofer", 2, data);
            let res = await choferFlow.handle(state, "850");
            expect(res.nextStep).toBe(3);

            // 2. Ingreso de bidones
            state = createState("chofer", 3, { ...data, litros: 850 });
            res = await choferFlow.handle(state, "17");
            expect(res.nextStep).toBe(4);

            // 3. Confirmación → va a step 99 (NO a step 1)
            state = createState("chofer", 4, { ...data, litros: 850, bidones: 17 });
            res = await choferFlow.handle(state, "1");
            expect(res.nextStep).toBe(99);
            // ANTES del fix: iba a step 1 y el "1" se interpretaba como "litros" de nuevo

            // 4. Step 99: usuario dice "1" para volver al menú
            state = createState("chofer", 99, { ...data, litros: 850, bidones: 17 });
            res = await choferFlow.handle(state, "1");
            expect(res.nextStep).toBe(1);
            // Ahora muestra el menú correctamente

            // 5. Ahora en el menú, el "2" es combustible (no se confunde)
            state = createState("chofer", 1, { ...data, litros: 850, bidones: 17 });
            res = await choferFlow.handle(state, "2");
            expect(res.nextStep).toBe(10);
            expect(res.reply).toContain("combustible");
        });
    });

    describe("steps 40-42 - baja donante", () => {
        const baseData = { codigoChofer: "01", choferId: 1 };

        it("baja: confirmar → va a step 99", async () => {
            const state = createState("chofer", 42, {
                ...baseData,
                bajaDonante: "María de Belgrano 123",
                bajaMotivo: "No dona más",
            });
            const res = await choferFlow.handle(state, "1");
            expect(res.reply).toContain("Reporte de baja enviado");
            expect(res.nextStep).toBe(99);
            expect(res.notify?.target).toBe("admin");
        });

        it("baja: cancelar → va a step 99", async () => {
            const state = createState("chofer", 42, baseData);
            const res = await choferFlow.handle(state, "2");
            expect(res.reply).toContain("Cancelado");
            expect(res.nextStep).toBe(99);
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
