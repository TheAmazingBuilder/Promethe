import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  findUnique: vi.fn(),
  endpointUpdate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    outboundMessage: {
      findMany: mocks.findMany,
      updateMany: mocks.updateMany,
      findUnique: mocks.findUnique,
    },
    integrationEndpoint: { update: mocks.endpointUpdate },
  },
}));

vi.mock("@/lib/integrations/crypto", () => ({
  decryptSecret: vi.fn(() => "https://discord.com/api/webhooks/test"),
}));

vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: vi.fn(async () => ({ allowed: true, remaining: 29, resetAt: 0 })),
}));

import { processOutbox } from "@/server/integrations/delivery";

const now = new Date("2026-11-21T12:00:00.000Z");
const claimedAt = new Date("2026-11-21T12:00:01.000Z");

function candidate(status: string) {
  return {
    id: "message-1",
    status,
    updatedAt: new Date("2026-11-21T11:00:00.000Z"),
  };
}

function validRow() {
  return {
    id: "message-1",
    userId: "user-1",
    endpointId: "endpoint-1",
    eventType: "TEST",
    payloadJson: JSON.stringify({
      eventType: "TEST",
      privacyLevel: "FULL",
      data: {},
    }),
    status: "PROCESSING",
    attempts: 0,
    updatedAt: claimedAt,
    endpoint: {
      id: "endpoint-1",
      type: "DISCORD_WEBHOOK",
      secretEncrypted: "ciphertext",
      chatId: null,
      isEnabled: true,
    },
  };
}

describe("notification outbox locking and retries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([]);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(validRow());
    mocks.endpointUpdate.mockResolvedValue({ consecutiveFailures: 1 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("selects due FAILED rows and PROCESSING rows with expired leases", async () => {
    await processOutbox(20, now);

    const where = mocks.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      {
        status: { in: ["PENDING", "FAILED"] },
        nextAttemptAt: { lte: now },
      },
      {
        status: "PROCESSING",
        updatedAt: { lte: new Date(now.getTime() - 2 * 60 * 1000) },
      },
    ]);
  });

  it("does not process a row when another worker already claimed it", async () => {
    mocks.findMany.mockResolvedValue([candidate("PENDING")]);
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });

    const report = await processOutbox(20, now);

    expect(report.processed).toBe(0);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
  });

  it("retries an ordinary delivery failure instead of leaving it unselectable", async () => {
    mocks.findMany.mockResolvedValue([candidate("PENDING")]);
    mocks.findUnique.mockResolvedValue(validRow());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => null,
      }))
    );

    const report = await processOutbox(20, now);

    expect(report.processed).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.dead).toBe(0);
    const finalize = mocks.updateMany.mock.calls[1][0];
    expect(finalize.where).toEqual({
      id: "message-1",
      status: "PROCESSING",
      updatedAt: claimedAt,
    });
    expect(finalize.data.status).toBe("FAILED");
    expect(finalize.data.attempts).toBe(1);
    expect(finalize.data.nextAttemptAt).toEqual(
      new Date(now.getTime() + 2 * 60 * 1000)
    );
  });

  it("reclaims a stale PROCESSING row with a compare-and-set claim", async () => {
    mocks.findMany.mockResolvedValue([candidate("PROCESSING")]);
    mocks.findUnique.mockResolvedValue({
      ...validRow(),
      payloadJson: "not-json",
    });

    const report = await processOutbox(20, now);

    expect(report.dead).toBe(1);
    expect(mocks.updateMany.mock.calls[0][0].where).toEqual({
      id: "message-1",
      status: "PROCESSING",
      updatedAt: {
        lte: new Date(now.getTime() - 2 * 60 * 1000),
      },
    });
  });
});
