/**
 * P1.1 — Cola persistente pg-boss.
 * Estos tests mockean pg-boss porque no hay DB en CI. Validan:
 *  - enqueueInbound pasa singletonKey = messageId
 *  - worker descarta errores permanentes sin re-lanzar
 *  - worker re-lanza errores transitorios para que pg-boss reintente
 */

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.TEST_MODE = "false";
process.env.WHATSAPP_PROVIDER = "360dialog";
process.env.WHATSAPP_TOKEN = "fake";
process.env.WHATSAPP_PHONE_NUMBER_ID = "fake";
process.env.WHATSAPP_VERIFY_TOKEN = "fake";
process.env.DATABASE_URL = "postgres://fake:fake@localhost:5432/fake";
process.env.DB_USER = "fake";
process.env.DB_PASSWORD = "fake";
process.env.CEO_PHONE = "393445721753";
process.env.ADMIN_API_KEY = "1234567890abcdef1234";
process.env.OPENAI_API_KEY = "fake";
process.env.ADMIN_PHONES = "393445721753";

const mockSend = jest.fn();
const mockWork = jest.fn();
const mockStart = jest.fn().mockResolvedValue(undefined);
const mockCreateQueue = jest.fn().mockResolvedValue(undefined);
const mockStop = jest.fn().mockResolvedValue(undefined);
const mockOn = jest.fn();

jest.mock("pg-boss", () => {
  return jest.fn().mockImplementation(() => ({
    start: mockStart,
    createQueue: mockCreateQueue,
    send: mockSend,
    work: mockWork,
    stop: mockStop,
    on: mockOn,
  }));
});

import { enqueueInbound, startInboundWorker, stopBoss } from "../src/services/queue";
import { WhatsAppAPIError } from "../src/bot/client";

describe("P1.1 — queue", () => {
  beforeEach(() => {
    mockSend.mockReset().mockResolvedValue("job-abc");
    mockWork.mockReset().mockResolvedValue(undefined);
    mockStart.mockClear();
    mockCreateQueue.mockClear();
  });

  afterEach(async () => {
    await stopBoss().catch(() => {});
  });

  it("enqueueInbound pasa singletonKey = messageId", async () => {
    await enqueueInbound({
      phone: "393445721753",
      text: "hola",
      messageId: "wamid.ABC",
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const [queueName, payload, opts] = mockSend.mock.calls[0];
    expect(queueName).toBe("process-inbound");
    expect(payload.messageId).toBe("wamid.ABC");
    expect(opts.singletonKey).toBe("wamid.ABC");
    expect(opts.retryLimit).toBe(3);
    expect(opts.retryBackoff).toBe(true);
  });

  it("worker descarta (no re-lanza) errores permanentes de WhatsApp", async () => {
    const handler = jest.fn().mockRejectedValue(new WhatsAppAPIError("re-engage", 131047, 400));

    await startInboundWorker(handler);

    expect(mockWork).toHaveBeenCalledTimes(1);
    const workerCb = mockWork.mock.calls[0][2];
    const job = { data: { phone: "393445721753", text: "x", messageId: "wamid.1" } };
    await expect(workerCb([job])).resolves.toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("worker re-lanza errores transitorios para que pg-boss reintente", async () => {
    const handler = jest.fn().mockRejectedValue(new Error("transient"));

    await startInboundWorker(handler);

    const workerCb = mockWork.mock.calls[0][2];
    const job = { data: { phone: "393445721753", text: "x", messageId: "wamid.2" } };
    await expect(workerCb([job])).rejects.toThrow("transient");
  });

  it("worker retorna OK si el handler completa", async () => {
    const handler = jest.fn().mockResolvedValue(undefined);

    await startInboundWorker(handler);

    const workerCb = mockWork.mock.calls[0][2];
    await expect(workerCb([{ data: { phone: "x", text: "y", messageId: "z" } }])).resolves.toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
