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

        it("opción 1 → bidones recolectados", async () => {
            const state = createState("chofer", 1, baseData);
            const res = await choferFlow.handle(state, "1");
            expect(res.reply).toContain("bidones");
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
            expect(res.reply).toContain("Accidente en el tránsito");
            expect(res.nextStep).toBe(20);
        });

        it("opción 4 → baja donante", async () => {
            const state = createState("chofer", 1, baseData);
            const res = await choferFlow.handle(state, "4");
            expect(res.reply).toContain("baja");
            expect(res.nextStep).toBe(30);
        });

        it("opción 5 → regalos", async () => {
            const state = createState("chofer", 1, baseData);
            const res = await choferFlow.handle(state, "5");
            expect(res.nextStep).toBe(50);
            expect(res.reply).toContain("Camión");
            expect(res.reply).toContain("Peón");
        });

        it("opción 0 → volver al menú principal (endFlow)", async () => {
            const state = createState("chofer", 1, baseData);
            const res = await choferFlow.handle(state, "0");
            expect(res.endFlow).toBe(true);
            expect(res.reply).toContain("menú principal");
        });

        it("keyword 'bidon' → registro de bidones", async () => {
            const state = createState("chofer", 1, baseData);
            const res = await choferFlow.handle(state, "cargar bidones");
            expect(res.nextStep).toBe(2);
        });

        it("opción inválida muestra menú de nuevo", async () => {
            const state = createState("chofer", 1, baseData);
            const res = await choferFlow.handle(state, "xyz");
            expect(res.reply).toContain("No entendí");
            expect(res.nextStep).toBe(1);
        });
    });

    describe("steps 2-5 - recolección de bidones + foto", () => {
        const baseData = { codigoChofer: "01", choferId: 1 };

        it("rechaza bidones inválidos", async () => {
            const state = createState("chofer", 2, baseData);
            const res = await choferFlow.handle(state, "abc");
            expect(res.reply).toContain("número válido de bidones");
            expect(res.nextStep).toBe(2);
        });

        it("acepta bidones válidos y muestra resumen", async () => {
            const state = createState("chofer", 2, baseData);
            const res = await choferFlow.handle(state, "17");
            expect(res.data?.bidones).toBe(17);
            expect(res.reply).toContain("Resumen de recolección");
            expect(res.reply).toContain("17");
            expect(res.nextStep).toBe(3);
        });

        it("confirma bidones → pide foto (step 4)", async () => {
            const state = createState("chofer", 3, { ...baseData, bidones: 17 });
            const res = await choferFlow.handle(state, "1");
            expect(res.reply).toContain("Bidones registrados");
            expect(res.reply).toContain("foto");
            expect(res.data?.recoleccionGuardada).toBe(true);
            expect(res.notify?.target).toBe("admin");
            expect(res.nextStep).toBe(4);
        });

        it("corrige bidones → vuelve a step 2", async () => {
            const state = createState("chofer", 3, { ...baseData, bidones: 17 });
            const res = await choferFlow.handle(state, "nah");
            expect(res.nextStep).toBe(2);
        });

        it("foto omitida → step 99", async () => {
            const state = createState("chofer", 4, { ...baseData, bidones: 17 });
            const res = await choferFlow.handle(state, "omitir");
            expect(res.reply).toContain("Foto omitida");
            expect(res.nextStep).toBe(99);
        });
    });

    describe("steps 10-13 - combustible + foto", () => {
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

        it("confirma combustible → pide foto (step 12)", async () => {
            const state = createState("chofer", 11, { ...baseData, litrosCombustible: 45, montoCombustible: 12500 });
            const res = await choferFlow.handle(state, "1");
            expect(res.reply).toContain("Combustible registrado");
            expect(res.reply).toContain("foto");
            expect(res.notify?.target).toBe("admin");
            expect(res.nextStep).toBe(12);
        });
    });

    describe("steps 20-22 - incidentes", () => {
        const baseData = { codigoChofer: "01", choferId: 1 };

        it("pide tipo de incidente en respuesta inválida", async () => {
            const state = createState("chofer", 20, baseData);
            const res = await choferFlow.handle(state, "99");
            expect(res.reply).toContain("número del tipo de incidente");
            expect(res.nextStep).toBe(20);
        });

        it("acepta tipo 1 (accidente en el tránsito)", async () => {
            const state = createState("chofer", 20, baseData);
            const res = await choferFlow.handle(state, "1");
            expect(res.data?.tipoIncidente).toBe("accidente_transito");
            expect(res.reply).toContain("Accidente en el tránsito");
            expect(res.nextStep).toBe(21);
        });

        it("acepta tipo 2 (retraso) → pregunta tiempo estimado", async () => {
            const state = createState("chofer", 20, baseData);
            const res = await choferFlow.handle(state, "2");
            expect(res.data?.tipoIncidente).toBe("retraso");
            expect(res.reply).toContain("cuánto tiempo");
            expect(res.nextStep).toBe(21);
        });

        it("acepta tipo 3 (avería) → pregunta qué avería", async () => {
            const state = createState("chofer", 20, baseData);
            const res = await choferFlow.handle(state, "3");
            expect(res.data?.tipoIncidente).toBe("averia");
            expect(res.reply).toContain("avería");
            expect(res.nextStep).toBe(21);
        });

        it("acepta tipo 4 (robo) → pregunta qué pasó y dónde", async () => {
            const state = createState("chofer", 20, baseData);
            const res = await choferFlow.handle(state, "4");
            expect(res.data?.tipoIncidente).toBe("robo");
            expect(res.reply).toContain("dónde");
            expect(res.nextStep).toBe(21);
        });

        it("acepta tipo 5 (otro)", async () => {
            const state = createState("chofer", 20, baseData);
            const res = await choferFlow.handle(state, "5");
            expect(res.data?.tipoIncidente).toBe("otro");
            expect(res.nextStep).toBe(21);
        });

        it("rechaza descripción muy corta", async () => {
            const state = createState("chofer", 21, { ...baseData, tipoIncidente: "accidente_transito" });
            const res = await choferFlow.handle(state, "si");
            expect(res.reply).toContain("más detalle");
            expect(res.nextStep).toBe(21);
        });

        it("acepta descripción válida", async () => {
            const state = createState("chofer", 21, { ...baseData, tipoIncidente: "accidente_transito" });
            const res = await choferFlow.handle(state, "Choqué con un auto estacionado en la esquina");
            expect(res.data?.descripcionIncidente).toBeTruthy();
            expect(res.reply).toContain("¿Qué tan grave");
            expect(res.nextStep).toBe(22);
        });

        it("registra gravedad y notifica admin", async () => {
            const state = createState("chofer", 22, {
                ...baseData,
                tipoIncidente: "accidente_transito",
                descripcionIncidente: "Choque con auto",
            });
            const res = await choferFlow.handle(state, "3");
            expect(res.data?.gravedadIncidente).toBe("alta");
            expect(res.reply).toContain("Incidente registrado");
            expect(res.notify?.target).toBe("admin");
            expect(res.notify?.message).toContain("INCIDENTE REPORTADO");
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

        it("no tiene opción 'problema climático' en menú de incidentes", async () => {
            const state = createState("chofer", 1, baseData);
            const res = await choferFlow.handle(state, "3");
            expect(res.reply).not.toContain("climático");
            expect(res.reply).not.toContain("Clima");
        });
    });

    describe("steps 30-32 - baja donante", () => {
        const baseData = { codigoChofer: "01", choferId: 1 };

        it("pide datos si input es muy corto", async () => {
            const state = createState("chofer", 30, baseData);
            const res = await choferFlow.handle(state, "ab");
            expect(res.nextStep).toBe(30);
        });

        it("acepta nombre/dirección y pide motivo", async () => {
            const state = createState("chofer", 30, baseData);
            const res = await choferFlow.handle(state, "María López, Belgrano 123");
            expect(res.data?.bajaDonante).toBe("María López, Belgrano 123");
            expect(res.reply).toContain("motivo");
            expect(res.nextStep).toBe(31);
        });

        it("acepta motivo y muestra confirmación", async () => {
            const state = createState("chofer", 31, { ...baseData, bajaDonante: "María López, Belgrano 123" });
            const res = await choferFlow.handle(state, "1");
            expect(res.data?.bajaMotivo).toBe("No dona más");
            expect(res.reply).toContain("Confirmar");
            expect(res.reply).toContain("contactará automáticamente");
            expect(res.nextStep).toBe(32);
        });

        it("confirmar baja → notifica admin y va a step 99", async () => {
            const state = createState("chofer", 32, {
                ...baseData,
                bajaDonante: "María de Belgrano 123",
                bajaMotivo: "No dona más",
            });
            const res = await choferFlow.handle(state, "1");
            expect(res.reply).toContain("Reporte de baja enviado");
            expect(res.data?.bajaAutoContactar).toBe(true);
            expect(res.nextStep).toBe(99);
            expect(res.notify?.target).toBe("admin");
        });

        it("cancelar baja → va a step 99", async () => {
            const state = createState("chofer", 32, baseData);
            const res = await choferFlow.handle(state, "2");
            expect(res.reply).toContain("Cancelado");
            expect(res.nextStep).toBe(99);
        });
    });

    describe("steps 50-54 - regalos", () => {
        const baseData = { codigoChofer: "01", choferId: 1 };

        it("muestra sub-menú camión/peón", async () => {
            const state = createState("chofer", 50, baseData);
            const res = await choferFlow.handle(state, "99");
            expect(res.reply).toContain("Camión");
            expect(res.reply).toContain("Peón");
            expect(res.nextStep).toBe(50);
        });

        it("opción 1 (Camión) → directo a sub-tipo", async () => {
            const state = createState("chofer", 50, baseData);
            const res = await choferFlow.handle(state, "1");
            expect(res.data?.regalosVehiculo).toBe("Camión");
            expect(res.reply).toContain("Entregados");
            expect(res.reply).toContain("Faltantes");
            expect(res.reply).toContain("Sobrantes");
            expect(res.reply).toContain("Cambios");
            expect(res.nextStep).toBe(52);
        });

        it("opción 2 (Peón 1) → pide nombre del peón", async () => {
            const state = createState("chofer", 50, baseData);
            const res = await choferFlow.handle(state, "2");
            expect(res.data?.regalosVehiculo).toBe("Peón 1");
            expect(res.data?.regalosEsPeon).toBe(true);
            expect(res.reply).toContain("nombre");
            expect(res.nextStep).toBe(51);
        });

        it("nombre del peón → sub-tipo", async () => {
            const state = createState("chofer", 51, { ...baseData, regalosVehiculo: "Peón 1", regalosEsPeon: true });
            const res = await choferFlow.handle(state, "Juan Pérez");
            expect(res.data?.regalosNombrePeon).toBe("Juan Pérez");
            expect(res.reply).toContain("Entregados");
            expect(res.nextStep).toBe(52);
        });

        it("sub-tipo entregados → pide cantidad", async () => {
            const state = createState("chofer", 52, { ...baseData, regalosVehiculo: "Camión" });
            const res = await choferFlow.handle(state, "1");
            expect(res.data?.regalosSubTipo).toBe("Entregados");
            expect(res.reply).toContain("Cuántos");
            expect(res.nextStep).toBe(53);
        });

        it("cantidad → muestra resumen y pregunta si registrar más", async () => {
            const state = createState("chofer", 53, {
                ...baseData,
                regalosVehiculo: "Camión",
                regalosSubTipo: "Entregados",
                regalosLista: [],
            });
            const res = await choferFlow.handle(state, "5");
            expect(res.data?.regalosUltimaCantidad).toBe(5);
            expect(res.reply).toContain("Registrado");
            expect(res.reply).toContain("5 entregados");
            expect(res.nextStep).toBe(54);
        });

        it("registrar otro → vuelve a elegir camión/peón", async () => {
            const state = createState("chofer", 54, {
                ...baseData,
                regalosLista: [{ vehiculo: "Camión", nombre: null, subtipo: "Entregados", cantidad: 5 }],
            });
            const res = await choferFlow.handle(state, "1");
            expect(res.reply).toContain("Camión");
            expect(res.nextStep).toBe(50);
        });

        it("confirmar regalos → notifica admin y va a step 99", async () => {
            const state = createState("chofer", 54, {
                ...baseData,
                regalosLista: [{ vehiculo: "Camión", nombre: null, subtipo: "Entregados", cantidad: 5 }],
            });
            const res = await choferFlow.handle(state, "2");
            expect(res.reply).toContain("Regalos registrados");
            expect(res.notify?.target).toBe("admin");
            expect(res.nextStep).toBe(99);
        });
    });

    describe("step 99 - volver al menú o finalizar", () => {
        const baseData = { codigoChofer: "01", choferId: 1, bidones: 17 };

        it("opción 1 → vuelve al menú chofer (step 1)", async () => {
            const state = createState("chofer", 99, baseData);
            const res = await choferFlow.handle(state, "1");
            expect(res.nextStep).toBe(1);
            expect(res.endFlow).toBeUndefined();
            expect(res.reply).toContain("Bidones recolectados");
        });

        it("opción 0 → vuelve al menú principal (endFlow)", async () => {
            const state = createState("chofer", 99, baseData);
            const res = await choferFlow.handle(state, "0");
            expect(res.endFlow).toBe(true);
            expect(res.reply).toContain("menú principal");
        });

        it("opción 2 → re-pregunta (no hay finalizar jornada)", async () => {
            const state = createState("chofer", 99, baseData);
            const res = await choferFlow.handle(state, "2");
            expect(res.endFlow).toBeFalsy();
            expect(res.nextStep).toBe(99);
        });

        it("cualquier otra respuesta → re-pregunta", async () => {
            const state = createState("chofer", 99, baseData);
            const res = await choferFlow.handle(state, "xyz");
            expect(res.endFlow).toBeFalsy();
            expect(res.nextStep).toBe(99);
        });
    });

    describe("ciclo completo", () => {
        it("bidones → foto → step 99 → volver → combustible", async () => {
            const data = { codigoChofer: "01", choferId: 1 };

            // 1. Ingreso de bidones
            let state = createState("chofer", 2, data);
            let res = await choferFlow.handle(state, "17");
            expect(res.nextStep).toBe(3);

            // 2. Confirmación
            state = createState("chofer", 3, { ...data, bidones: 17 });
            res = await choferFlow.handle(state, "1");
            expect(res.nextStep).toBe(4);

            // 3. Omitir foto → step 99
            state = createState("chofer", 4, { ...data, bidones: 17 });
            res = await choferFlow.handle(state, "omitir");
            expect(res.nextStep).toBe(99);

            // 4. Volver al menú
            state = createState("chofer", 99, { ...data, bidones: 17 });
            res = await choferFlow.handle(state, "1");
            expect(res.nextStep).toBe(1);

            // 5. Combustible
            state = createState("chofer", 1, { ...data, bidones: 17 });
            res = await choferFlow.handle(state, "2");
            expect(res.nextStep).toBe(10);
            expect(res.reply).toContain("combustible");
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
