/**
 * Tests del conversation-manager.
 * Se mockean env, logger y client para aislar la lógica de estado.
 */

// Mocks ANTES de los imports
jest.mock("../src/config/env", () => ({
    env: {
        DATABASE_URL: "postgresql://test:test@localhost:5432/test",
        DB_HOST: "localhost",
        DB_PORT: 5432,
        DB_NAME: "test",
        DB_USER: "test",
        DB_PASSWORD: "test",
        BOT_SESSION_NAME: "test",
        CEO_PHONE: "5411000000",
        PORT: 3000,
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
    },
}));

jest.mock("../src/config/logger", () => ({
    logger: {
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        fatal: jest.fn(),
        child: jest.fn().mockReturnThis(),
    },
}));

jest.mock("../src/bot/client", () => ({
    sendMessage: jest.fn().mockResolvedValue(undefined),
    initBot: jest.fn(),
    getSocket: jest.fn(),
    sendBulkMessages: jest.fn(),
    sendDocument: jest.fn(),
}));

import {
    handleIncomingMessage,
    getConversation,
    startConversation,
    endConversation,
} from "../src/bot/conversation-manager";
import { detectFlow } from "../src/bot/flows";

describe("conversation-manager", () => {
    beforeEach(() => {
        // Limpiar las conversaciones activas
        endConversation("test-phone-1");
        endConversation("test-phone-2");
    });

    describe("handleIncomingMessage", () => {
        it("muestra menú inicial para mensaje desconocido", async () => {
            const reply = await handleIncomingMessage("test-phone-1", "hola buenas");
            expect(reply).toContain("¡Hola!");
            expect(reply).toContain("1");
            expect(reply).toContain("reclamo");
            expect(reply).toContain("2");
            expect(reply).toContain("aviso");
            expect(reply).toContain("3");
            expect(reply).toContain("consulta");
        });

        it("detecta flow por keyword 'reclamo'", async () => {
            const reply = await handleIncomingMessage("test-phone-1", "tengo un reclamo");
            // Debería entrar al flow de reclamo
            expect(reply).toContain("reclamo");
            // Debería tener una conversación activa
            const conv = getConversation("test-phone-1");
            expect(conv).not.toBeNull();
            expect(conv?.currentFlow).toBe("reclamo");
        });

        it("detecta flow por keyword 'vacaciones'", async () => {
            const reply = await handleIncomingMessage("test-phone-1", "vacaciones");
            expect(reply).toContain("aviso");
            const conv = getConversation("test-phone-1");
            expect(conv).not.toBeNull();
            expect(conv?.currentFlow).toBe("aviso");
        });
    });

    describe("detectFlow", () => {
        it("detecta reclamo por keyword", () => {
            const flow = detectFlow("tengo un reclamo");
            expect(flow).not.toBeNull();
            expect(flow?.name).toBe("reclamo");
        });

        it("detecta aviso por keyword", () => {
            const flow = detectFlow("me voy de vacaciones");
            expect(flow).not.toBeNull();
            expect(flow?.name).toBe("aviso");
        });

        it("detecta consulta por keyword 'ayuda'", () => {
            const flow = detectFlow("necesito ayuda");
            expect(flow).not.toBeNull();
            expect(flow?.name).toBe("consulta_general");
        });

        it("detecta chofer por keyword", () => {
            const flow = detectFlow("soy el chofer");
            expect(flow).not.toBeNull();
            expect(flow?.name).toBe("chofer");
        });

        it("detecta nueva donante por keyword 'donar'", () => {
            const flow = detectFlow("quiero donar");
            expect(flow).not.toBeNull();
            expect(flow?.name).toBe("nueva_donante");
        });

        it("retorna null si no hay match", () => {
            const flow = detectFlow("buen día señora");
            expect(flow).toBeNull();
        });
    });

    describe("gestión de estado", () => {
        it("startConversation crea estado", () => {
            startConversation("test-phone-1", "reclamo");
            const conv = getConversation("test-phone-1");
            expect(conv).not.toBeNull();
            expect(conv?.currentFlow).toBe("reclamo");
            expect(conv?.step).toBe(0);
        });

        it("endConversation limpia estado", () => {
            startConversation("test-phone-1", "reclamo");
            endConversation("test-phone-1");
            const conv = getConversation("test-phone-1");
            expect(conv).toBeNull();
        });

        it("conversaciones de distintos usuarios son independientes", () => {
            startConversation("test-phone-1", "reclamo");
            startConversation("test-phone-2", "aviso");
            expect(getConversation("test-phone-1")?.currentFlow).toBe("reclamo");
            expect(getConversation("test-phone-2")?.currentFlow).toBe("aviso");
        });

        it("timeout de 30 min limpia la conversación", () => {
            startConversation("test-phone-1", "reclamo");
            const conv = getConversation("test-phone-1");

            // Simular que pasaron 31 minutos
            if (conv) {
                conv.lastInteraction = new Date(Date.now() - 31 * 60 * 1000);
            }

            const result = getConversation("test-phone-1");
            expect(result).toBeNull();
        });
    });
});
