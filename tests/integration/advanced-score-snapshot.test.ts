/**
 * Phase 2 perf item 3 — trader score served from TraderScoreSnapshot
 * (PostgreSQL schema promethe_test).
 *
 * Today's snapshot (when present) freezes the headline score: one
 * indexed read, no recompute. History is built from the snapshots
 * (last one of each month), never from the monthly replay. When today's
 * snapshot is missing, the score is recomputed and the snapshot is
 * persisted (integer components, so the write succeeds).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createUserWithDefaults } from "@/server/users";
import {
  getAdvancedAnalytics,
  loadScoreHistoryFromSnapshots,
  utcDay,
} from "@/server/advanced-analytics";

const XAUUSD_SPEC = {
  symbol: "XAUUSD",
  name: "Gold / US Dollar",
  assetClass: "METAL",
  baseCurrency: "XAU",
  quoteCurrency: "USD",
  digits: 2,
  pipSize: "0.10",
  pointSize: "0.01",
  contractSize: "100",
  tickSize: "0.01",
  isActive: true,
};

let instrumentId: string;
let userA: { id: string };
let userB: { id: string };
let accountAId: string;
let accountA2Id: string;
let accountBId: string;

async function makeUser(email: string) {
  const { user } = await createUserWithDefaults({
    email,
    password: "test-password-123",
    displayName: "Score Test",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  const accounts = await db.account.findMany({ where: { userId: user.id } });
  return { user, accountId: accounts[0].id };
}

async function seedClosedTrade(
  userId: string,
  accountId: string,
  index: number,
  pnlCurrency = "USD"
) {
  const day = new Date(Date.UTC(2026, 9, 10 + index, 14, 0, 0));
  const win = index % 2 === 0;
  await db.trade.create({
    data: {
      userId,
      accountId,
      instrumentId,
      direction: "LONG",
      status: "CLOSED",
      entryTime: day,
      exitTime: new Date(day.getTime() + 2 * 60 * 60 * 1000),
      entryPrice: "2000",
      exitPrice: "2010",
      lots: "1",
      netPnl: win ? "100" : "-50",
      pnlCurrency,
      rMultiple: win ? "1" : "-0.5",
      resultType: win ? "WIN" : "LOSS",
      followedPlan: true,
      riskPercent: "1",
      preTradeAnalysis: "",
      postTradeReview: "",
    },
  });
}

async function seedSnapshot(
  userId: string,
  date: Date,
  score: number,
  tradeCount: number
) {
  await db.traderScoreSnapshot.create({
    data: {
      userId,
      date,
      score,
      discipline: 20,
      edge: 20,
      consistency: 20,
      risk: 20,
      tradeCount,
    },
  });
}

beforeAll(async () => {
  // Global XAUUSD may already exist (other integration files create it
  // in the same test db) — the (userId, symbol) pair is unique.
  const existing = await db.instrument.findFirst({
    where: { userId: null, symbol: "XAUUSD" },
  });
  const instrument =
    existing ??
    (await db.instrument.create({
      data: { userId: null, ...XAUUSD_SPEC },
    }));
  instrumentId = instrument.id;

  const a = await makeUser("adv-score-a@test.local");
  userA = a.user;
  accountAId = a.accountId;
  const secondAccount = await db.account.create({
    data: {
      userId: userA.id,
      name: "Second account",
      currency: "CAD",
      initialBalance: "10000",
    },
  });
  accountA2Id = secondAccount.id;

  const b = await makeUser("adv-score-b@test.local");
  userB = b.user;
  accountBId = b.accountId;

  // User A: past snapshots + today's snapshot + 5 closed trades.
  await seedSnapshot(userA.id, new Date(Date.UTC(2026, 0, 15)), 40, 8);
  await seedSnapshot(userA.id, new Date(Date.UTC(2026, 0, 28)), 55, 9);
  await seedSnapshot(userA.id, new Date(Date.UTC(2026, 1, 10)), 70, 10);
  await seedSnapshot(userA.id, utcDay(new Date()), 80, 12);
  for (let i = 0; i < 5; i++) {
    await seedClosedTrade(userA.id, accountAId, i);
  }

  // User B: past snapshots only (no snapshot for today) + 5 closed trades.
  await seedSnapshot(userB.id, new Date(Date.UTC(2026, 0, 15)), 40, 8);
  await seedSnapshot(userB.id, new Date(Date.UTC(2026, 0, 28)), 55, 9);
  await seedSnapshot(userB.id, new Date(Date.UTC(2026, 1, 10)), 70, 10);
  for (let i = 0; i < 5; i++) {
    await seedClosedTrade(userB.id, accountBId, i);
  }

  // User A's second account has its own trade sample; its score must not
  // reuse or overwrite the user's global daily snapshot.
  for (let i = 20; i < 23; i++) {
    await seedClosedTrade(userA.id, accountA2Id, i, "CAD");
  }
});

afterAll(async () => {
  await db.user.deleteMany({
    where: { id: { in: [userA.id, userB.id] } },
  });
  await db.$disconnect();
});

describe("trader score from snapshots", () => {
  it("serves today's snapshot (frozen score) and snapshot history", async () => {
    const payload = await getAdvancedAnalytics(userA.id, {
      period: "all",
      module: "score",
    });
    const score = payload.advanced.score;
    expect(score.total).toBe(80);
    expect(score.components).toEqual({
      discipline: 20,
      edge: 20,
      consistency: 20,
      risk: 20,
    });
    expect(score.trades).toBe(12);
    // History: last snapshot of each month — January keeps the 28th
    // (55), not the 15th (40); the current month is today's snapshot.
    const currentMonth = new Date().toISOString().slice(0, 7);
    expect(payload.advanced.scoreHistory).toEqual([
      { month: "2026-01", score: 55, trades: 9 },
      { month: "2026-02", score: 70, trades: 10 },
      { month: currentMonth, score: 80, trades: 12 },
    ]);

    // The read is live, not cached: changing the snapshot changes the
    // served score on the next call.
    await db.traderScoreSnapshot.update({
      where: {
        userId_date: { userId: userA.id, date: utcDay(new Date()) },
      },
      data: { score: 42 },
    });
    const again = await getAdvancedAnalytics(userA.id, {
      period: "all",
      module: "score",
    });
    expect(again.advanced.score.total).toBe(42);
    expect(
      again.advanced.scoreHistory.find((p) => p.month === currentMonth)
    ).toEqual({ month: currentMonth, score: 42, trades: 12 });
  });

  it("recomputes when today's snapshot is missing, then persists it", async () => {
    const payload = await getAdvancedAnalytics(userB.id, {
      period: "all",
      module: "score",
    });
    const score = payload.advanced.score;
    expect(score.trades).toBe(5);
    expect(score.total).toBeGreaterThanOrEqual(0);
    expect(score.total).toBeLessThanOrEqual(100);
    const currentMonth = new Date().toISOString().slice(0, 7);
    expect(payload.advanced.scoreHistory).toEqual([
      { month: "2026-01", score: 55, trades: 9 },
      { month: "2026-02", score: 70, trades: 10 },
      { month: currentMonth, score: score.total, trades: 5 },
    ]);

    // The recompute persisted today's snapshot (integer components).
    const saved = await db.traderScoreSnapshot.findUnique({
      where: {
        userId_date: { userId: userB.id, date: utcDay(new Date()) },
      },
    });
    expect(saved).not.toBeNull();
    expect(saved?.score).toBe(score.total);
    expect(saved?.tradeCount).toBe(5);
    for (const c of [
      saved?.discipline,
      saved?.edge,
      saved?.consistency,
      saved?.risk,
    ]) {
      expect(Number.isInteger(c)).toBe(true);
    }
  });

  it("does not reuse or overwrite the global snapshot for an account filter", async () => {
    const globalBefore = await db.traderScoreSnapshot.findUnique({
      where: { userId_date: { userId: userA.id, date: utcDay(new Date()) } },
    });
    expect(globalBefore).not.toBeNull();

    const payload = await getAdvancedAnalytics(userA.id, {
      period: "all",
      account: accountA2Id,
      module: "score",
    });

    expect(payload.accountId).toBe(accountA2Id);
    expect(payload.advanced.score.trades).toBe(3);
    expect(payload.excludedTradeCount).toBe(0);
    expect(payload.advanced.score.total).not.toBe(globalBefore?.score);
    const globalAfter = await db.traderScoreSnapshot.findUnique({
      where: { userId_date: { userId: userA.id, date: utcDay(new Date()) } },
    });
    expect(globalAfter?.score).toBe(globalBefore?.score);
    expect(globalAfter?.tradeCount).toBe(12);
  });

  it("loads history from snapshots only (no replay)", async () => {
    const history = await loadScoreHistoryFromSnapshots(userA.id);
    expect(history.map((p) => p.month)).toEqual([
      "2026-01",
      "2026-02",
      new Date().toISOString().slice(0, 7),
    ]);
    expect(history[0]).toEqual({ month: "2026-01", score: 55, trades: 9 });
  });
});
