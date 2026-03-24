import { contactoInicialFlow } from "../../src/bot/flows/contacto-inicial";
import { createState } from "../helpers";

describe("contactoInicialFlow", () => {
    describe("step 0 - ¿está donando?", () => {
        it("acepta 'sí' y pasa a días", async () => {
            const state = createState("contacto_inicial", 0);
            const res = await contactoInicialFlow.handle(state, "sí");
            expect(res.data?.donandoActualmente).toBe(true);
            expect(res.reply).toContain("días");
            expect(res.nextStep).toBe(1);
        });

        it("acepta '1' como sí", async () => {
            const state = createState("contacto_inicial", 0);
            const res = await contactoInicialFlow.handle(state, "1");
            expect(res.data?.donandoActualmente).toBe(true);
            expect(res.nextStep).toBe(1);
        });

        it("acepta 'no' y termina", async () => {
            const state = createState("contacto_inicial", 0);
            const res = await contactoInicialFlow.handle(state, "no");
            expect(res.data?.donandoActualmente).toBe(false);
            expect(res.endFlow).toBe(true);
            expect(res.notify?.target).toBe("admin");
        });

        it("repregunta si no entiende", async () => {
            const state = createState("contacto_inicial", 0);
            const res = await contactoInicialFlow.handle(state, "qué?");
            expect(res.reply).toContain("no entendí");
            expect(res.nextStep).toBe(0);
        });
    });

    describe("step 1 - días de recolección", () => {
        it("extrae días de la semana", async () => {
            const state = createState("contacto_inicial", 1, { donandoActualmente: true });
            const res = await contactoInicialFlow.handle(state, "lunes y jueves");
            expect(res.data?.diasRecoleccion).toContain("Lunes");
            expect(res.data?.diasRecoleccion).toContain("Jueves");
            expect(res.nextStep).toBe(2);
        });

        it("acepta 'no sé'", async () => {
            const state = createState("contacto_inicial", 1, { donandoActualmente: true });
            const res = await contactoInicialFlow.handle(state, "no sé");
            expect(res.data?.diasRecoleccion).toBe("a confirmar");
            expect(res.nextStep).toBe(2);
        });

        it("pide aclaración si no detecta días", async () => {
            const state = createState("contacto_inicial", 1, { donandoActualmente: true });
            const res = await contactoInicialFlow.handle(state, "algunas veces");
            expect(res.reply).toContain("No pude identificar los días");
            expect(res.nextStep).toBe(1);
        });

        it("extrae múltiples días", async () => {
            const state = createState("contacto_inicial", 1, { donandoActualmente: true });
            const res = await contactoInicialFlow.handle(state, "lunes, miércoles y viernes");
            expect(res.data?.diasRecoleccion).toContain("Lunes");
            expect(res.data?.diasRecoleccion).toContain("Miércoles");
            expect(res.data?.diasRecoleccion).toContain("Viernes");
        });
    });

    describe("step 2 - dirección exacta", () => {
        it("rechaza dirección sin número", async () => {
            const state = createState("contacto_inicial", 2, { diasRecoleccion: "Lunes, Jueves" });
            const res = await contactoInicialFlow.handle(state, "Av. Corrientes");
            expect(res.reply).toContain("calle y número");
            expect(res.nextStep).toBe(2);
        });

        it("rechaza dirección muy corta", async () => {
            const state = createState("contacto_inicial", 2, { diasRecoleccion: "Lunes" });
            const res = await contactoInicialFlow.handle(state, "Calle 5");
            expect(res.nextStep).toBe(2);
        });

        it("acepta dirección válida", async () => {
            const state = createState("contacto_inicial", 2, { diasRecoleccion: "Lunes, Jueves" });
            const res = await contactoInicialFlow.handle(state, "Av. Corrientes 1234, CABA");
            expect(res.data?.direccionExacta).toBe("Av. Corrientes 1234, CABA");
            expect(res.reply).toContain("confirmo los datos");
            expect(res.nextStep).toBe(3);
        });
    });

    describe("step 3 - confirmación", () => {
        const baseData = { diasRecoleccion: "Lunes, Jueves", direccionExacta: "Av. Corrientes 1234" };

        it("confirma datos", async () => {
            const state = createState("contacto_inicial", 3, baseData);
            const res = await contactoInicialFlow.handle(state, "1");
            expect(res.reply).toContain("datos quedaron actualizados");
            expect(res.endFlow).toBe(true);
            expect(res.data?.confirmado).toBe(true);
            expect(res.notify?.target).toBe("admin");
        });

        it("corrige → vuelve a días", async () => {
            const state = createState("contacto_inicial", 3, baseData);
            const res = await contactoInicialFlow.handle(state, "2");
            expect(res.reply).toContain("empecemos de nuevo");
            expect(res.nextStep).toBe(1);
        });
    });

    describe("keywords", () => {
        it("no tiene keywords (solo se inicia por programación)", () => {
            expect(contactoInicialFlow.keyword).toEqual([]);
        });
    });
});
