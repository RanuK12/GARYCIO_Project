/**
 * Tests del conversation-manager.
 * Se mockean env, logger, client y DB para aislar la lógica.
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
        ADMIN_PHONES: "5411000000,5411000001",
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

// Mock DB — conversation-manager reads/writes conversation states
const mockDbSelect = jest.fn().mockReturnValue({
    from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
        }),
    }),
});
const mockDbInsert = jest.fn().mockReturnValue({
    values: jest.fn().mockReturnValue({
        onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
    }),
});
const mockDbUpdate = jest.fn().mockReturnValue({
    set: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
    }),
});
const mockDbDelete = jest.fn().mockReturnValue({
    where: jest.fn().mockResolvedValue(undefined),
});

jest.mock("../src/database", () => ({
    db: {
        select: () => mockDbSelect(),
        insert: () => mockDbInsert(),
        update: () => mockDbUpdate(),
        delete: () => mockDbDelete(),
    },
}));

import { handleIncomingMessage } from "../src/bot/conversation-manager";
import { detectFlow } from "../src/bot/flows";

describe("conversation-manager", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("handleIncomingMessage", () => {
        it("muestra menú inicial para mensaje desconocido", async () => {
            const result = await handleIncomingMessage("test-phone-1", "hola buenas");
            expect(result.reply).toContain("¡Hola!");
            expect(result.reply).toContain("1");
            expect(result.reply).toContain("reclamo");
            expect(result.reply).toContain("2");
            expect(result.reply).toContain("aviso");
            expect(result.reply).toContain("3");
        });

        it("muestra opción 'hablar con persona'", async () => {
            const result = await handleIncomingMessage("test-phone-1", "hola");
            expect(result.reply).toContain("persona");
        });

        it("detecta 'hablar con una persona' y deriva", async () => {
            const result = await handleIncomingMessage("test-phone-1", "quiero hablar con una persona");
            expect(result.reply).toContain("derivado");
            expect(result.notify?.target).toBe("admin");
        });

        it("detecta intención de baja y deriva", async () => {
            const result = await handleIncomingMessage("test-phone-1", "quiero darme de baja");
            expect(result.reply).toContain("dejar de participar");
            expect(result.notify?.target).toBe("admin");
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

        it("detecta visitadora por keyword", () => {
            const flow = detectFlow("soy visitadora");
            expect(flow).not.toBeNull();
            expect(flow?.name).toBe("visitadora");
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
});
