import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  candidateUpdateMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { $transaction: mocks.transaction },
}));

vi.mock("@/lib/sync/process", () => ({
  recomputeSyncedTrade: vi.fn(),
}));

import { mergeCandidate } from "@/server/reconciliation";

describe("reconciliation merge claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.candidateUpdateMany.mockResolvedValue({ count: 0 });
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        reconciliationCandidate: {
          updateMany: mocks.candidateUpdateMany,
        },
      })
    );
  });

  it("rejects a candidate that is no longer pending before reading or changing trades", async () => {
    await expect(mergeCandidate("user-1", "candidate-1")).rejects.toMatchObject({
      name: "ReconciliationError",
      code: "CANDIDATE_NOT_FOUND",
      status: 404,
    });

    expect(mocks.candidateUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "candidate-1",
        userId: "user-1",
        status: "PENDING",
      },
      data: {
        status: "MERGED",
        resolvedAt: expect.any(Date),
      },
    });
  });
});
