/**
 * Tests para el control de acceso al panel de administración.
 * Verifica que solo phones autorizados puedan acceder al flow admin.
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
    procesarComprobante: jest.fn(),
}));

jest.mock("../../src/database", () => ({
    db: {},
}));

jest.mock("../../src/services/progreso-ruta", () => ({
    obtenerResumenProgreso: jest.fn().mockReturnValue([]),
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

import { detectFlow, isAdminPhone } from "../../src/bot/flows";

describe("Admin access control", () => {
    describe("isAdminPhone", () => {
        it("reconoce CEO_PHONE como admin", () => {
            expect(isAdminPhone("5411000000")).toBe(true);
        });

        it("reconoce números en ADMIN_PHONES como admin", () => {
            expect(isAdminPhone("5411000001")).toBe(true);
        });

        it("rechaza números no admin", () => {
            expect(isAdminPhone("5491199999")).toBe(false);
        });

        it("rechaza string vacío", () => {
            expect(isAdminPhone("")).toBe(false);
        });
    });

    describe("detectFlow con control de admin", () => {
        it("NO detecta admin para un usuario no autorizado", () => {
            const flow = detectFlow("admin", "5491199999");
            // No debe detectar admin, ya que no es un phone autorizado
            expect(flow?.name).not.toBe("admin");
        });

        it("detecta admin para CEO_PHONE", () => {
            const flow = detectFlow("admin", "5411000000");
            expect(flow).not.toBeNull();
            expect(flow?.name).toBe("admin");
        });

        it("detecta admin para número en ADMIN_PHONES", () => {
            const flow = detectFlow("administrador", "5411000001");
            expect(flow).not.toBeNull();
            expect(flow?.name).toBe("admin");
        });

        it("sin phone (undefined), NO detecta admin", () => {
            const flow = detectFlow("admin");
            expect(flow?.name).not.toBe("admin");
        });

        it("usuario no admin que dice 'admin' no accede al panel", () => {
            const flow = detectFlow("quiero ser admin", "5491199999");
            // Debe detectar otro flow o null, nunca admin
            if (flow) {
                expect(flow.name).not.toBe("admin");
            }
        });

        it("detecta otros flows normalmente con phone no admin", () => {
            const flow = detectFlow("tengo un reclamo", "5491199999");
            expect(flow).not.toBeNull();
            expect(flow?.name).toBe("reclamo");
        });

        it("detecta chofer normalmente", () => {
            const flow = detectFlow("chofer", "5491199999");
            expect(flow).not.toBeNull();
            expect(flow?.name).toBe("chofer");
        });
    });
});
