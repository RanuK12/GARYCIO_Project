/**
 * Tests para el flow de peón.
 * Verifica el step 99 (volver/finalizar) que antes faltaba.
 */

jest.mock("../../src/bot/client", () => ({
    sendMessage: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../src/config/env", () => ({
    env: {
        CEO_PHONE: "5411000000",
        ADMIN_PHONES: "5411000000",
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

import { peonFlow } from "../../src/bot/flows/peon";
import { createState } from "../helpers";

describe("peonFlow", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("step 0 - identificación", () => {
        it("pide número si no lo envía", async () => {
            const state = createState("peon", 0);
            const res = await peonFlow.handle(state, "hola");
            expect(res.reply).toContain("Registro de Peón");
            expect(res.nextStep).toBe(0);
        });

        it("identifica al peón con número", async () => {
            const state = createState("peon", 0);
            const res = await peonFlow.handle(state, "2");
            expect(res.reply).toContain("Peón #02");
            expect(res.data?.codigoPeon).toBe("02");
            expect(res.nextStep).toBe(1);
        });
    });

    describe("step 1 - menú", () => {
        const baseData = { codigoPeon: "01", rol: "peon" };

        it("opción 1 → reclamo", async () => {
            const state = createState("peon", 1, baseData);
            const res = await peonFlow.handle(state, "1");
            expect(res.reply).toContain("Reclamo de donante");
            expect(res.nextStep).toBe(10);
        });

        it("opción 5 → cierre de jornada (conteo de regalos)", async () => {
            const state = createState("peon", 1, baseData);
            const res = await peonFlow.handle(state, "5");
            expect(res.nextStep).toBe(60);
            expect(res.reply).toContain("regalos");
        });

        it("opción 0 → volver al menú principal (endFlow)", async () => {
            const state = createState("peon", 1, baseData);
            const res = await peonFlow.handle(state, "0");
            expect(res.endFlow).toBe(true);
            expect(res.reply).toContain("menú principal");
        });
    });

    describe("step 99 - volver al menú o finalizar (FIX)", () => {
        const baseData = { codigoPeon: "01", rol: "peon" };

        it("opción 1 en step 99 → vuelve al menú peón (step 1)", async () => {
            const state = createState("peon", 99, baseData);
            const res = await peonFlow.handle(state, "1");
            expect(res.nextStep).toBe(1);
            expect(res.endFlow).toBeUndefined();
            expect(res.reply).toContain("Reportar reclamo");
            expect(res.reply).toContain("regalo");
            expect(res.reply).toContain("Volver al menú principal");
        });

        it("opción 0 en step 99 → vuelve al menú principal (endFlow)", async () => {
            const state = createState("peon", 99, baseData);
            const res = await peonFlow.handle(state, "0");
            expect(res.endFlow).toBe(true);
            expect(res.reply).toContain("menú principal");
        });

        it("opción 2 en step 99 → finaliza jornada", async () => {
            const state = createState("peon", 99, baseData);
            const res = await peonFlow.handle(state, "2");
            expect(res.endFlow).toBe(true);
        });

        it("ciclo: reclamo → step 99 → volver al menú funciona correctamente", async () => {
            const data = { codigoPeon: "01", rol: "peon" };

            // 1. Reclamo dirección
            let state = createState("peon", 10, data);
            let res = await peonFlow.handle(state, "Av. San Martín 123");
            expect(res.nextStep).toBe(11);

            // 2. Tipo de reclamo
            state = createState("peon", 11, { ...data, reclamoDonante: "Av. San Martín 123" });
            res = await peonFlow.handle(state, "1");
            expect(res.nextStep).toBe(12);

            // 3. Descripción → registra reclamo, va a step 99
            state = createState("peon", 12, { ...data, reclamoDonante: "Av. San Martín 123", reclamoTipo: "regalo" });
            res = await peonFlow.handle(state, "No le dejaron el regalo");
            expect(res.nextStep).toBe(99);
            expect(res.notify?.target).toBe("admin");

            // 4. Step 99: usuario dice "1" → vuelve al menú
            state = createState("peon", 99, data);
            res = await peonFlow.handle(state, "1");
            expect(res.nextStep).toBe(1);
            // NO debe crashear ni caer en default (sesión finalizada)
        });
    });

    describe("keywords", () => {
        it("se activa con 'peon'", () => {
            expect(peonFlow.keyword).toContain("peon");
        });

        it("se activa con 'peón'", () => {
            expect(peonFlow.keyword).toContain("peón");
        });
    });
});
