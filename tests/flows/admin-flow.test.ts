/**
 * Tests para el flujo admin.
 * Verifica menú, navegación, opción de reporte y step 99.
 */

jest.mock("../../src/bot/client", () => ({
    sendMessage: jest.fn().mockResolvedValue(undefined),
    sendDocument: jest.fn().mockResolvedValue(undefined),
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
    procesarComprobante: jest.fn(),
}));

jest.mock("../../src/database", () => ({
    db: {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([{ id: 1 }]),
        onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
    },
}));

jest.mock("../../src/services/progreso-ruta", () => ({
    obtenerResumenProgreso: jest.fn().mockReturnValue([]),
}));

jest.mock("../../src/services/reporte-diario", () => ({
    enviarReportePDF: jest.fn().mockResolvedValue(undefined),
    marcarReporteEnviado: jest.fn(),
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

import { adminFlow } from "../../src/bot/flows/admin";
import { createState } from "../helpers";

describe("adminFlow", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("step 0 - bienvenida", () => {
        it("muestra el menú con todas las opciones", async () => {
            const state = createState("admin", 0);
            const res = await adminFlow.handle(state, "");
            expect(res.reply).toContain("Panel de Administración");
            expect(res.reply).toContain("contactos nuevos");
            expect(res.reply).toContain("Buscar donante");
            expect(res.reply).toContain("reclamos pendientes");
            expect(res.reply).toContain("reportes de baja");
            expect(res.reply).toContain("Progreso de rutas");
            expect(res.reply).toContain("encuesta");
            expect(res.reply).toContain("Generar reporte diario");
            expect(res.reply).toContain("Finalizar");
            expect(res.nextStep).toBe(1);
        });
    });

    describe("step 1 - menú", () => {
        it("opción 1 → contactos nuevos", async () => {
            const state = createState("admin", 1);
            const res = await adminFlow.handle(state, "1");
            expect(res.reply).toContain("contactos nuevos");
            expect(res.nextStep).toBe(10);
        });

        it("opción 2 → buscar donante", async () => {
            const state = createState("admin", 1);
            const res = await adminFlow.handle(state, "2");
            expect(res.reply).toContain("Buscar donante");
            expect(res.nextStep).toBe(20);
        });

        it("opción 3 → reclamos pendientes", async () => {
            const state = createState("admin", 1);
            const res = await adminFlow.handle(state, "3");
            expect(res.nextStep).toBe(30);
        });

        it("opción 4 → reportes de baja", async () => {
            const state = createState("admin", 1);
            const res = await adminFlow.handle(state, "4");
            expect(res.nextStep).toBe(40);
        });

        it("opción 5 → progreso de rutas", async () => {
            const state = createState("admin", 1);
            const res = await adminFlow.handle(state, "5");
            expect(res.nextStep).toBe(50);
        });

        it("opción 6 → resultados encuesta", async () => {
            const state = createState("admin", 1);
            const res = await adminFlow.handle(state, "6");
            expect(res.nextStep).toBe(60);
        });

        it("opción 7 → lista de comandos", async () => {
            const state = createState("admin", 1);
            const res = await adminFlow.handle(state, "7");
            expect(res.reply).toContain("Comandos");
            expect(res.nextStep).toBe(99);
        });

        it("opción 8 → generar reporte PDF", async () => {
            const state = createState("admin", 1);
            const res = await adminFlow.handle(state, "8");
            expect(res.reply).toContain("reporte diario");
            expect(res.nextStep).toBe(70);
        });

        it("opción 9 → finalizar", async () => {
            const state = createState("admin", 1);
            const res = await adminFlow.handle(state, "9");
            expect(res.endFlow).toBe(true);
        });

        it("opción inválida pide de nuevo", async () => {
            const state = createState("admin", 1);
            const res = await adminFlow.handle(state, "xyz");
            expect(res.reply).toContain("Opción no válida");
            expect(res.nextStep).toBe(1);
        });
    });

    describe("step 70 - generar reporte PDF", () => {
        it("genera el reporte y muestra info del contenido", async () => {
            const state = createState("admin", 70);
            const res = await adminFlow.handle(state, "");
            expect(res.reply).toContain("Generando reporte diario");
            expect(res.reply).toContain("KPIs");
            expect(res.reply).toContain("progreso mensual");
            expect(res.reply).toContain("260.000 litros");
            expect(res.nextStep).toBe(99);
        });

        it("llama a enviarReportePDF", async () => {
            const { enviarReportePDF } = require("../../src/services/reporte-diario");
            const state = createState("admin", 70);
            await adminFlow.handle(state, "");
            expect(enviarReportePDF).toHaveBeenCalled();
        });
    });

    describe("step 99 - volver o finalizar", () => {
        it("opción 1 → vuelve al menú admin", async () => {
            const state = createState("admin", 99);
            const res = await adminFlow.handle(state, "1");
            expect(res.reply).toContain("Panel de Administración");
            expect(res.nextStep).toBe(1);
        });

        it("opción 2 → finaliza sesión", async () => {
            const state = createState("admin", 99);
            const res = await adminFlow.handle(state, "2");
            expect(res.endFlow).toBe(true);
        });
    });

    describe("keywords", () => {
        it("se activa con 'admin'", () => {
            expect(adminFlow.keyword).toContain("admin");
        });
    });
});
