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

// ── Mock de DB ──────────────────────────────────────────
// Cola de respuestas: cada llamada a limit() consume el siguiente valor de la cola
let dbResponseQueue: any[][] = [];

const mockSelect = jest.fn().mockImplementation(() => ({
    from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
            limit: jest.fn().mockImplementation(async () => {
                if (dbResponseQueue.length > 0) {
                    return dbResponseQueue.shift()!;
                }
                return [];
            }),
        }),
    }),
}));

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
        select: () => mockSelect(),
        insert: () => mockDbInsert(),
        update: () => mockDbUpdate(),
        delete: () => mockDbDelete(),
    },
}));

import { handleIncomingMessage } from "../src/bot/conversation-manager";
import { detectFlow } from "../src/bot/flows";

// ── Helpers de rol ──────────────────────────────────────
// lookupRolPorTelefono hace 4 queries en paralelo (Promise.all):
// orden: [choferes, peones, visitadoras, donantes]
// Además, getConversation hace 1 query a conversation_states al inicio.
// Total de queries para primer mensaje: 1 (conv_states) + 4 (lookup) = 5

function mockComoDonanteConocida() {
    // 1. conversation_states → [] (sin sesión activa)
    // 2-4. choferes, peones, visitadoras → []
    // 5. donantes → [{id:1}]
    dbResponseQueue = [[], [], [], [], [{ id: 1, estado: "activa" }]];
}

function mockComoDesconocido() {
    // 1. conversation_states → [] (sin sesión activa)
    // 2-5. todas las tablas de lookup → []
    dbResponseQueue = [[], [], [], [], []];
}

describe("conversation-manager", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockComoDesconocido(); // Default: teléfono desconocido
    });

    describe("handleIncomingMessage", () => {
        it("número desconocido → flow de registro nueva donante", async () => {
            mockComoDesconocido();
            const result = await handleIncomingMessage("test-phone-nuevo", "hola buenas");
            // Un número desconocido ahora va al flow de nueva_donante automáticamente
            expect(result.reply).toContain("Bienvenida");
            expect(result.reply).toContain("registrarte");
        });

        it("donante conocida → muestra menú principal", async () => {
            mockComoDonanteConocida();
            const result = await handleIncomingMessage("test-phone-donante", "hola");
            expect(result.reply).toContain("¡Hola!");
            expect(result.reply).toContain("reclamo");
            expect(result.reply).toContain("aviso");
            expect(result.reply).toContain("Otro motivo");
        });

        it("menú inicial NO muestra opción 'hablar con persona'", async () => {
            mockComoDonanteConocida();
            const result = await handleIncomingMessage("test-phone-donante", "hola");
            // Ya no exponemos esta opción en el menú para filtrar mejor
            expect(result.reply).not.toContain("persona");
            expect(result.reply).toContain("Otro motivo");
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
