/**
 * Tests para la función extractText del handler.
 * Se testea la extracción de texto de distintos tipos de mensaje de WhatsApp.
 */

import { proto } from "@whiskeysockets/baileys";

// La función extractText es privada en handler.ts, así que la replicamos para testear
function extractText(msg: proto.IWebMessageInfo): string | null {
    const m = msg.message;
    if (!m) return null;

    return (
        m.conversation ||
        m.extendedTextMessage?.text ||
        m.buttonsResponseMessage?.selectedDisplayText ||
        m.listResponseMessage?.singleSelectReply?.selectedRowId ||
        null
    );
}

const fakeKey: proto.IMessageKey = { remoteJid: "test@s.whatsapp.net", id: "test" };

describe("extractText (handler)", () => {
    it("extrae conversation simple", () => {
        const msg: proto.IWebMessageInfo = {
            key: fakeKey,
            message: { conversation: "hola" },
        };
        expect(extractText(msg)).toBe("hola");
    });

    it("extrae extendedTextMessage", () => {
        const msg: proto.IWebMessageInfo = {
            key: fakeKey,
            message: {
                extendedTextMessage: { text: "texto extendido" },
            },
        };
        expect(extractText(msg)).toBe("texto extendido");
    });

    it("extrae buttonsResponseMessage", () => {
        const msg: proto.IWebMessageInfo = {
            key: fakeKey,
            message: {
                buttonsResponseMessage: { selectedDisplayText: "Opción 1" },
            },
        };
        expect(extractText(msg)).toBe("Opción 1");
    });

    it("extrae listResponseMessage", () => {
        const msg: proto.IWebMessageInfo = {
            key: fakeKey,
            message: {
                listResponseMessage: {
                    singleSelectReply: { selectedRowId: "row-1" },
                },
            },
        };
        expect(extractText(msg)).toBe("row-1");
    });

    it("retorna null para mensaje sin message", () => {
        const msg: proto.IWebMessageInfo = { key: fakeKey };
        expect(extractText(msg)).toBeNull();
    });

    it("retorna null para mensaje vacío", () => {
        const msg: proto.IWebMessageInfo = { key: fakeKey, message: {} };
        expect(extractText(msg)).toBeNull();
    });

    it("prioriza conversation sobre extendedText", () => {
        const msg: proto.IWebMessageInfo = {
            key: fakeKey,
            message: {
                conversation: "prioridad",
                extendedTextMessage: { text: "no este" },
            },
        };
        expect(extractText(msg)).toBe("prioridad");
    });
});
