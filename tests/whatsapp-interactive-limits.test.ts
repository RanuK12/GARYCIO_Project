/**
 * Guard de límites WhatsApp Cloud API:
 *  - Buttons: max 3
 *  - List: max 10 rows totales
 *  - row.title 24 / row.description 72 / button.title 20 / body 1024
 *
 * Violaciones devuelven error 100 (permanente). Truncamos antes de enviar.
 */
import {
  sendInteractiveButtons,
  sendInteractiveList,
  WHATSAPP_LIMITS,
} from "../src/bot/client";
import { _resetRateLimit } from "../src/services/rate-limit-adaptive";

jest.mock("../src/services/whatsapp-window", () => ({
  isConversationWindowOpen: jest.fn().mockResolvedValue(true),
}));

describe("WhatsApp interactive limits guard", () => {
  let fetchSpy: jest.SpyInstance;
  let lastBody: any;

  beforeEach(() => {
    jest.resetAllMocks();
    _resetRateLimit();
    lastBody = null;
    fetchSpy = jest.spyOn(global, "fetch").mockImplementation((async (
      _url: string,
      init: any,
    ) => {
      lastBody = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ id: "fake-msg-id" }] }),
      } as any;
    }) as any);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("trunca buttons a 3 y deja log de error", async () => {
    const tooMany = [
      { id: "1", title: "A" },
      { id: "2", title: "B" },
      { id: "3", title: "C" },
      { id: "4", title: "D" }, // exceso
      { id: "5", title: "E" }, // exceso
    ];
    await sendInteractiveButtons("393445721753", "body", tooMany);
    const sent = lastBody.interactive.action.buttons;
    expect(sent).toHaveLength(WHATSAPP_LIMITS.MAX_BUTTONS);
    expect(sent.map((b: any) => b.reply.id)).toEqual(["1", "2", "3"]);
  });

  it("trunca títulos de botones largos a 20 chars", async () => {
    await sendInteractiveButtons("393445721753", "body", [
      { id: "1", title: "Un titulo demasiado largo para WhatsApp" },
    ]);
    const sent = lastBody.interactive.action.buttons[0].reply.title as string;
    expect(sent.length).toBeLessThanOrEqual(WHATSAPP_LIMITS.MAX_BUTTON_TITLE);
  });

  it("trunca lista a 10 rows totales aunque haya múltiples secciones", async () => {
    const sections = [
      {
        title: "S1",
        rows: Array.from({ length: 7 }, (_, i) => ({
          id: `a${i}`,
          title: `A${i}`,
        })),
      },
      {
        title: "S2",
        rows: Array.from({ length: 7 }, (_, i) => ({
          id: `b${i}`,
          title: `B${i}`,
        })),
      },
    ];
    await sendInteractiveList(
      "393445721753",
      "body",
      "Ver opciones",
      sections,
    );
    const sentSections = lastBody.interactive.action.sections;
    const totalRows = sentSections.reduce(
      (n: number, s: any) => n + s.rows.length,
      0,
    );
    expect(totalRows).toBe(WHATSAPP_LIMITS.MAX_LIST_ROWS);
    // S1 keeps 7, S2 keeps 3 (7 + 3 = 10)
    expect(sentSections[0].rows).toHaveLength(7);
    expect(sentSections[1].rows).toHaveLength(3);
  });

  it("trunca títulos y descripciones de rows", async () => {
    await sendInteractiveList("393445721753", "body", "Ver", [
      {
        rows: [
          {
            id: "1",
            title: "Un título extremadamente largo que excede el límite",
            description:
              "Una descripción muy muy larga que también excede el límite que impone Meta para los rows de listas interactivas",
          },
        ],
      },
    ]);
    const row = lastBody.interactive.action.sections[0].rows[0];
    expect(row.title.length).toBeLessThanOrEqual(WHATSAPP_LIMITS.MAX_ROW_TITLE);
    expect(row.description.length).toBeLessThanOrEqual(
      WHATSAPP_LIMITS.MAX_ROW_DESCRIPTION,
    );
  });

  it("trunca body a 1024 chars", async () => {
    const huge = "x".repeat(1500);
    await sendInteractiveButtons("393445721753", huge, [
      { id: "1", title: "ok" },
    ]);
    const sent = lastBody.interactive.body.text as string;
    expect(sent.length).toBeLessThanOrEqual(WHATSAPP_LIMITS.MAX_BODY);
  });

  it("dentro del límite: no toca nada", async () => {
    await sendInteractiveList("393445721753", "body", "Ver", [
      {
        rows: [
          { id: "1", title: "Uno" },
          { id: "2", title: "Dos" },
        ],
      },
    ]);
    expect(lastBody.interactive.action.sections).toHaveLength(1);
    expect(lastBody.interactive.action.sections[0].rows).toHaveLength(2);
  });
});
