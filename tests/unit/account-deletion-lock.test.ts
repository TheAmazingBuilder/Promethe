import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deletionFindMany: vi.fn(),
  deletionFindUnique: vi.fn(),
  deletionUpdateMany: vi.fn(),
  screenshotFindMany: vi.fn(),
  txUpdateMany: vi.fn(),
  tombstoneUpsert: vi.fn(),
  userDelete: vi.fn(),
  transaction: vi.fn(),
  deleteUploadObjects: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    accountDeletionRequest: {
      findMany: mocks.deletionFindMany,
      findUnique: mocks.deletionFindUnique,
      updateMany: mocks.deletionUpdateMany,
    },
    tradeScreenshot: { findMany: mocks.screenshotFindMany },
    deletedUserTombstone: { upsert: mocks.tombstoneUpsert },
    user: { delete: mocks.userDelete },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/server/uploads", () => ({
  deleteUploadObjects: mocks.deleteUploadObjects,
}));

vi.mock("@/server/notifications", () => ({
  notifyInApp: vi.fn(),
}));

import { executeDueDeletions } from "@/server/account-deletion";

const now = new Date("2026-11-21T12:00:00.000Z");
const staleAt = new Date(now.getTime() - 10 * 60 * 1000);

describe("scheduled account deletion locking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deletionFindMany.mockResolvedValue([
      { userId: "user-1", status: "PENDING", completedAt: null },
    ]);
    mocks.deletionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.screenshotFindMany.mockResolvedValue([]);
    mocks.txUpdateMany.mockResolvedValue({ count: 1 });
    mocks.tombstoneUpsert.mockResolvedValue({});
    mocks.userDelete.mockResolvedValue({});
    mocks.deleteUploadObjects.mockResolvedValue(undefined);
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        accountDeletionRequest: { updateMany: mocks.txUpdateMany },
        deletedUserTombstone: { upsert: mocks.tombstoneUpsert },
        user: { delete: mocks.userDelete },
      })
    );
  });

  it("does not delete data when the pending request was cancelled before the claim", async () => {
    mocks.deletionUpdateMany.mockResolvedValueOnce({ count: 0 });

    const report = await executeDueDeletions(now);

    expect(report.executed).toBe(0);
    expect(mocks.screenshotFindMany).not.toHaveBeenCalled();
    expect(mocks.deleteUploadObjects).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("claims the request before deleting storage and rechecks the lease in the transaction", async () => {
    mocks.screenshotFindMany.mockResolvedValue([{ storagePath: "private/user-1/a.png" }]);

    const report = await executeDueDeletions(now);

    expect(report.executed).toBe(1);
    expect(mocks.deletionUpdateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        status: "PENDING",
        scheduledFor: { lte: now },
      },
      data: { status: "PROCESSING", completedAt: now },
    });
    expect(mocks.deleteUploadObjects).toHaveBeenCalledWith([
      "private/user-1/a.png",
    ]);
    expect(mocks.txUpdateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        status: "PROCESSING",
        completedAt: now,
      },
      data: { completedAt: now },
    });
    expect(mocks.userDelete).toHaveBeenCalledWith({
      where: { id: "user-1" },
    });
  });

  it("releases its own lease when Storage fails so a later cron can retry", async () => {
    mocks.deleteUploadObjects.mockRejectedValueOnce(new Error("Storage unavailable"));

    const report = await executeDueDeletions(now);

    expect(report.executed).toBe(0);
    expect(mocks.deletionUpdateMany).toHaveBeenCalledTimes(2);
    expect(mocks.deletionUpdateMany.mock.calls[1][0]).toEqual({
      where: {
        userId: "user-1",
        status: "PROCESSING",
        completedAt: now,
      },
      data: { status: "PENDING", completedAt: null },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("reclaims a PROCESSING request only after its lease expires", async () => {
    mocks.deletionFindMany.mockResolvedValue([
      { userId: "user-1", status: "PROCESSING", completedAt: staleAt },
    ]);

    await executeDueDeletions(now);

    expect(mocks.deletionUpdateMany.mock.calls[0][0]).toEqual({
      where: {
        userId: "user-1",
        status: "PROCESSING",
        completedAt: staleAt,
      },
      data: { status: "PROCESSING", completedAt: now },
    });
  });
});
