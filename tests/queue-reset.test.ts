/**
 * P0.9 — Worker descarta jobs creados antes del arranque del bot.
 */

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.DATABASE_URL = "postgres://fake:fake@localhost:5432/fake";
process.env.DB_USER = "fake";
process.env.DB_PASSWORD = "fake";
process.env.WHATSAPP_PROVIDER = "360dialog";
process.env.WHATSAPP_TOKEN = "fake";
process.env.WHATSAPP_PHONE_NUMBER_ID = "fake";
process.env.WHATSAPP_VERIFY_TOKEN = "fake";
process.env.CEO_PHONE = "393445721753";
process.env.ADMIN_API_KEY = "1234567890abcdef1234";
process.env.OPENAI_API_KEY = "fake";
process.env.ADMIN_PHONES = "393445721753";

const mockSend = jest.fn().mockResolvedValue("job-id");
const mockWork = jest.fn().mockResolvedValue(undefined);
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

import { startInboundWorker, stopBoss, _resetWorkerStartedAt } from "../src/services/queue";

describe("P0.9 — queue reset al start", () => {
  beforeEach(() => {
    mockWork.mockReset().mockResolvedValue(undefined);
    _resetWorkerStartedAt();
  });

  afterEach(async () => {
    await stopBoss().catch(() => {});
  });

  it("descarta jobs con createdOn anterior al workerStartedAt", async () => {
    const handler = jest.fn().mockResolvedValue(undefined);

    await startInboundWorker(handler);

    const workerCb = mockWork.mock.calls[0][2];
    const oldJob = {
      data: { phone: "393445721753", text: "hola vieja", messageId: "wamid.old" },
      createdOn: new Date(Date.now() - 3600_000), // 1h antes del start
    };
    await expect(workerCb([oldJob])).resolves.toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
  });

  it("procesa jobs con createdOn posterior al workerStartedAt", async () => {
    const handler = jest.fn().mockResolvedValue(undefined);

    await startInboundWorker(handler);

    const workerCb = mockWork.mock.calls[0][2];
    const newJob = {
      data: { phone: "393445721753", text: "hola nueva", messageId: "wamid.new" },
      createdOn: new Date(Date.now() + 1000), // después del start
    };
    await expect(workerCb([newJob])).resolves.toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("procesa jobs sin createdOn (fallback: asume nuevos)", async () => {
    const handler = jest.fn().mockResolvedValue(undefined);

    await startInboundWorker(handler);

    const workerCb = mockWork.mock.calls[0][2];
    const job = { data: { phone: "x", text: "y", messageId: "z" } };
    await expect(workerCb([job])).resolves.toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
