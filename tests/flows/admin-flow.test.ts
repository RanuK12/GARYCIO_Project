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

jest.mock("../../src/database", () => {
    // chain thennable: cualquier .where() / .limit() / .orderBy() también
    // resuelve como Promise<[]> si lo hacen `await` directo (sin más eslabones).
    const chain: any = {
        select: jest.fn(() => chain),
        from: jest.fn(() => chain),
        where: jest.fn(() => chain),
        orderBy: jest.fn(() => chain),
        limit: jest.fn(() => chain),
        groupBy: jest.fn(() => chain),
        leftJoin: jest.fn(() => chain),
        innerJoin: jest.fn(() => chain),
        insert: jest.fn(() => chain),
        values: jest.fn(() => chain),
        update: jest.fn(() => chain),
        set: jest.fn(() => chain),
        returning: jest.fn(() => Promise.resolve([{ id: 1, total: 0 }])),
        onConflictDoUpdate: jest.fn(() => Promise.resolve(undefined)),
        // Thenable: resuelve un row con campos comunes para que destructuring no rompa
        // (`[{ total }] = await db...where()` o `[obj] = await db...limit()`).
        then: (resolve: any) => resolve([{ total: 0, id: 1 }]),
    };
    return { db: chain };
});

jest.mock("../../src/services/progreso-ruta", () => ({
    obtenerResumenProgreso: jest.fn().mockReturnValue([]),
}));

jest.mock("../../src/services/reporte-diario", () => ({
    enviarReportePDF: jest.fn().mockResolvedValue(undefined),
    marcarReporteEnviado: jest.fn(),
}));

jest.mock("../../src/services/reporte-pdf", () => ({
    generarReportePDF: jest.fn().mockResolvedValue("/tmp/fake-reporte.pdf"),
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
        it("muestra el menú con todas las opciones (lista interactiva)", async () => {
            const state = createState("admin", 0);
            const res = await adminFlow.handle(state, "");
            // Migrado a lista interactiva: el body queda en interactive, los items en sections.
            expect(res.interactive?.body).toContain("Panel de Administración");
            const allTitles = (res.interactive?.sections ?? [])
                .flatMap((s) => s.rows.map((r) => r.title))
                .join(" ")
                .toLowerCase();
            expect(allTitles).toContain("contactos nuevos");
            expect(allTitles).toContain("reclamos pendientes");
            expect(allTitles).toContain("control del bot");
            expect(allTitles).toContain("capacidad del bot");
            expect(res.nextStep).toBe(1);
        });
    });

    describe("step 1 - menú", () => {
        it("opción 1 → contactos nuevos (DB vacío → mensaje 'sin pendientes')", async () => {
            const state = createState("admin", 1);
            const res = await adminFlow.handle(state, "1");
            // DB mockeada con limit:[]/total:0 → flow muestra "No hay contactos nuevos pendientes"
            expect((res.interactive?.body ?? res.reply).toLowerCase()).toContain("contactos nuevos");
        });

        it("opción 2 → buscar donante", async () => {
            const state = createState("admin", 1);
            const res = await adminFlow.handle(state, "2");
            expect(res.reply).toContain("Buscar donante");
            expect(res.nextStep).toBe(20);
        });

        it("opción 3 → reclamos pendientes (responde sin throw)", async () => {
            const state = createState("admin", 1);
            const res = await adminFlow.handle(state, "3");
            expect(res).toBeDefined();
        });

        it("opción 4 → reportes de baja (responde sin throw)", async () => {
            const state = createState("admin", 1);
            const res = await adminFlow.handle(state, "4");
            expect(res).toBeDefined();
        });

        it("opción 5 → progreso de rutas (responde sin throw)", async () => {
            const state = createState("admin", 1);
            const res = await adminFlow.handle(state, "5");
            expect(res).toBeDefined();
        });

        it("opción 6 → resultados encuesta (responde sin throw)", async () => {
            const state = createState("admin", 1);
            const res = await adminFlow.handle(state, "6");
            expect(res).toBeDefined();
        });

        it("opción 7 → lista de comandos", async () => {
            const state = createState("admin", 1);
            const res = await adminFlow.handle(state, "7");
            expect(res.reply).toContain("Comandos");
            expect(res.nextStep).toBe(99);
        });

        it("opción 8 → generar reporte PDF (success path)", async () => {
            const state = createState("admin", 1);
            const res = await adminFlow.handle(state, "8");
            // Con generarReportePDF mockeado, el body interactivo confirma el envío.
            expect((res.interactive?.body ?? res.reply).toLowerCase()).toMatch(/reporte/);
            expect(res.nextStep).toBe(99);
        });

        it("opción 9 → finalizar", async () => {
            const state = createState("admin", 1);
            const res = await adminFlow.handle(state, "9");
            expect(res.endFlow).toBe(true);
        });

        it("opción inválida → re-muestra menú (handleBienvenida)", async () => {
            const state = createState("admin", 1);
            const res = await adminFlow.handle(state, "xyz");
            // Comportamiento actual: vuelve a mostrar el menú interactivo.
            expect(res.interactive?.body).toContain("Panel de Administración");
            expect(res.nextStep).toBe(1);
        });
    });

    describe("step 1 - opción 8 dispara generación de reporte", () => {
        it("llama a generarReportePDF", async () => {
            const { generarReportePDF } = require("../../src/services/reporte-pdf");
            const state = createState("admin", 1);
            await adminFlow.handle(state, "8");
            expect(generarReportePDF).toHaveBeenCalled();
        });
    });

    describe("step 99 - volver o finalizar", () => {
        it("opción 1 → vuelve al menú admin", async () => {
            const state = createState("admin", 99);
            const res = await adminFlow.handle(state, "1");
            // Vuelve al menú interactivo de bienvenida.
            expect(res.interactive?.body).toContain("Panel de Administración");
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
