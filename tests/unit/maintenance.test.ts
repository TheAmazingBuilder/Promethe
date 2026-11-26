import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeDueDeletions: vi.fn(),
  pruneRateLimits: vi.fn(),
  syncPayloadPurge: vi.fn(),
  mergeLogPrune: vi.fn(),
  shareLinkPrune: vi.fn(),
  notificationPrune: vi.fn(),
  purgeExpiredTrash: vi.fn(),
  recordDailyTraderScores: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    syncEventLog: { updateMany: mocks.syncPayloadPurge },
    tradeMergeLog: { deleteMany: mocks.mergeLogPrune },
    shareLink: { deleteMany: mocks.shareLinkPrune },
    notificationLog: { deleteMany: mocks.notificationPrune },
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  pruneRateLimits: mocks.pruneRateLimits,
}));

vi.mock("@/server/account-deletion", () => ({
  executeDueDeletions: mocks.executeDueDeletions,
}));

vi.mock("@/server/trash", () => ({
  purgeExpiredTrash: mocks.purgeExpiredTrash,
}));

vi.mock("@/server/advanced-analytics", () => ({
  recordDailyTraderScores: mocks.recordDailyTraderScores,
}));

import { runDailyMaintenance } from "@/server/maintenance";

const now = new Date("2026-11-21T12:00:00.000Z");

describe("runDailyMaintenance failure isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeDueDeletions.mockResolvedValue({ executed: 1, tombstones: ["hash"] });
    mocks.pruneRateLimits.mockResolvedValue(4);
    mocks.syncPayloadPurge.mockResolvedValue({ count: 5 });
    mocks.mergeLogPrune.mockResolvedValue({ count: 6 });
    mocks.shareLinkPrune.mockResolvedValue({ count: 8 });
    mocks.notificationPrune.mockResolvedValue({ count: 9 });
    mocks.purgeExpiredTrash.mockResolvedValue({
      trades: 1,
      journalEntries: 2,
      strategies: 3,
      tags: 4,
      changeLogsPruned: 5,
    });
    mocks.recordDailyTraderScores.mockResolvedValue({ users: 10, snapshots: 11 });
  });

  it("continues every later cleanup step when account deletion fails", async () => {
    mocks.executeDueDeletions.mockRejectedValueOnce(new Error("Storage unavailable"));

    const report = await runDailyMaintenance(now);

    expect(report.deletions).toEqual({ executed: 0, tombstones: [] });
    expect(report.failures).toContain("account deletions");
    expect(report.rateLimitBucketsPruned).toBe(4);
    expect(report.syncPayloadsPurged).toBe(5);
    expect(report.mergeLogsDeleted).toBe(6);
    expect(report.shareLinksDeleted).toBe(8);
    expect(report.notificationsPruned).toBe(9);
    expect(report.trashPurged.trades).toBe(1);
    expect(report.traderScoreSnapshots).toBe(11);
    expect(mocks.recordDailyTraderScores).toHaveBeenCalledWith(now);
  });

  it("reports a failed cleanup step without hiding successful later steps", async () => {
    mocks.syncPayloadPurge.mockRejectedValueOnce(new Error("Table unavailable"));

    const report = await runDailyMaintenance(now);

    expect(report.failures).toContain("sync payload purge");
    expect(report.syncPayloadsPurged).toBe(0);
    expect(report.mergeLogsDeleted).toBe(6);
    expect(report.traderScoreSnapshots).toBe(11);
  });
});
