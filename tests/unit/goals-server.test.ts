/**
 * listGoalsWithProgress — Trade.grade wiring into A_PLUS_WIN_RATE
 * (MRT wave 3).
 *
 * The goal engine already filters on `grade === "A+"`; this test proves
 * the server layer actually loads Trade.grade and hands it to the engine:
 * a graded A+ trade counts, an ungraded trade does not, and with no
 * graded trade the metric honestly reports "no data" (null).
 *
 * Pure unit test: the Prisma client and display preferences are mocked,
 * no test database is touched.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  profile: { timezone: "America/Toronto" },
  goals: [] as Record<string, unknown>[],
  trades: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    profile: { findUnique: vi.fn(async () => mocks.profile) },
    goal: { findMany: vi.fn(async () => mocks.goals) },
    trade: { findMany: vi.fn(async () => mocks.trades) },
    tradeReview: { findMany: vi.fn(async () => []) },
    tradeScreenshot: { findMany: vi.fn(async () => []) },
    journalEntry: { findMany: vi.fn(async () => []) },
  },
}));

vi.mock("@/server/display-preferences", () => ({
  getDisplayPreferences: vi.fn(
    async () => ({ tradingDay: undefined }) as never
  ),
}));

import { listGoalsWithProgress } from "../../src/server/goals";

function goalRow(): Record<string, unknown> {
  return {
    id: "g1",
    name: "Win rate A+",
    description: null,
    metric: "A_PLUS_WIN_RATE",
    targetValue: "70",
    period: "ALL_TIME",
    startDate: new Date("2026-01-01T00:00:00Z"),
    endDate: null,
    status: "ACTIVE",
    createdAt: new Date("2026-11-01T00:00:00Z"),
  };
}

function tradeRow(
  id: string,
  netPnl: string,
  grade: string | null,
  exitDay = 2
): Record<string, unknown> {
  return {
    id,
    exitTime: new Date(`2026-11-${String(exitDay).padStart(2, "0")}T10:00:00-05:00`),
    netPnl,
    rMultiple: null,
    grade,
    followedPlan: null,
  };
}

describe("listGoalsWithProgress — A+ win rate grade wiring", () => {
  beforeEach(() => {
    mocks.profile = { timezone: "America/Toronto" };
    mocks.goals = [goalRow()];
    mocks.trades = [];
  });

  it("counts graded A+ trades only; ungraded and B trades are excluded", async () => {
    mocks.trades = [
      tradeRow("t1", "100", "A+", 2), // A+ win
      tradeRow("t2", "80", "A+", 3), // A+ win
      tradeRow("t3", "-40", "A+", 4), // A+ loss
      tradeRow("t4", "200", "A+", 5), // A+ win
      tradeRow("t5", "-500", "B", 6), // graded B -> out of sample
      tradeRow("t6", "300", null, 7), // ungraded -> out of sample
    ];

    const payload = await listGoalsWithProgress("user-1");

    expect(payload.goals).toHaveLength(1);
    const progress = payload.goals[0].progress;
    expect(progress.currentValue).toBe("75"); // 3 wins / 4 A+
    expect(progress.sampleSize).toBe(4);
    expect(progress.isAchieved).toBe(true); // 75 >= 70
  });

  it("reports no data when no trade is graded A+", async () => {
    mocks.trades = [
      tradeRow("t1", "100", "B", 2),
      tradeRow("t2", "50", null, 3),
    ];

    const payload = await listGoalsWithProgress("user-1");

    const progress = payload.goals[0].progress;
    expect(progress.currentValue).toBeNull();
    expect(progress.sampleSize).toBe(0);
    expect(progress.isAchieved).toBe(false);
  });
});
