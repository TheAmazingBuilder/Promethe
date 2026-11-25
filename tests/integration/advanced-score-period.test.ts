/**
 * Lot 3 — Trader Score respects the period filter (PostgreSQL schema
 * promethe_test).
 *
 * The global daily snapshot is all-time, all accounts. It may stand in
 * for the score only when the request asks for exactly that scope
 * (period "all", no account filter). Every other period — or an account
 * filter — must be recomputed from the trades in scope, and a scoped
 * read must never freeze a partial value as the global snapshot.
 *
 * Seeds use dates relative to "now" so the cutoffs stay meaningful
 * whenever the suite runs; expected counts are derived from the seeded
 * exit dates with the same cutoffs the server applies.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createUserWithDefaults } from "@/server/users";
import {
  getAdvancedAnalytics,
  loadAdvancedTrades,
  utcDay,
} from "@/server/advanced-analytics";
import { computeTraderScore } from "@/lib/analytics/advanced";
import { computeTradeStats } from "@/lib/analytics/engine";
import { computeAdvancedStats } from "@/lib/analytics/insights";
import { tradingDayOfTrade } from "@/lib/time/trading-day";
import type { AnalyticsPeriod } from "@/lib/validations/analytics";

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
let userC: { id: string };
let userD: { id: string };
let userE: { id: string };
let accountCId: string;
let accountC2Id: string;
let accountDId: string;
let accountEId: string;

/** Exit dates of user C's account-1 trades (days before now). */
const C1_AGES_DAYS = [2, 4, 6, 8, 12, 45, 120, 400];

const now = new Date();
const daysAgo = (n: number) =>
  new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - n,
    12,
    0,
    0,
  ));
const ytdStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
const cutoff30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
const cutoff90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
const currentMonth = now.toISOString().slice(0, 7);

const c1ExitDates = C1_AGES_DAYS.map(daysAgo);
const expectedCount = (period: AnalyticsPeriod) => {
  if (period === "30d") return c1ExitDates.filter((d) => d >= cutoff30).length;
  if (period === "90d") return c1ExitDates.filter((d) => d >= cutoff90).length;
  if (period === "ytd") return c1ExitDates.filter((d) => d >= ytdStart).length;
  return c1ExitDates.length;
};

async function makeUser(email: string) {
  const { user } = await createUserWithDefaults({
    email,
    password: "test-password-123",
    displayName: "Score Period Test",
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
  exit: Date,
  index: number
) {
  const win = index % 2 === 0;
  await db.trade.create({
    data: {
      userId,
      accountId,
      instrumentId,
      direction: "LONG",
      status: "CLOSED",
      entryTime: new Date(exit.getTime() - 2 * 60 * 60 * 1000),
      exitTime: exit,
      entryPrice: "2000",
      exitPrice: "2010",
      lots: "1",
      netPnl: win ? "100" : "-50",
      pnlCurrency: "USD",
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
  tradeCount: number,
  components = { discipline: 22, edge: 22, consistency: 22, risk: 22 }
) {
  await db.traderScoreSnapshot.create({
    data: { userId, date, score, ...components, tradeCount },
  });
}

/** The score the engine computes from the trades the server loads. */
async function expectedScore(
  userId: string,
  accountId: string | undefined,
  period: AnalyticsPeriod
) {
  const loaded = await loadAdvancedTrades(userId, accountId, period);
  const stats = computeTradeStats(loaded.trades, {
    dayOf: tradingDayOfTrade(loaded.timezone, loaded.tradingDay),
  });
  const advanced = computeAdvancedStats(loaded.trades, stats);
  return computeTraderScore(loaded.trades, stats, advanced);
}

async function todaySnapshot(userId: string) {
  return db.traderScoreSnapshot.findUnique({
    where: { userId_date: { userId, date: utcDay(new Date()) } },
  });
}

beforeAll(async () => {
  const existing = await db.instrument.findFirst({
    where: { userId: null, symbol: "XAUUSD" },
  });
  const instrument =
    existing ??
    (await db.instrument.create({
      data: { userId: null, ...XAUUSD_SPEC },
    }));
  instrumentId = instrument.id;

  // User C: 8 trades across 400 days + a distinctive global snapshot.
  const c = await makeUser("adv-period-c@test.local");
  userC = c.user;
  accountCId = c.accountId;
  const secondAccount = await db.account.create({
    data: {
      userId: userC.id,
      name: "Second account",
      currency: "USD",
      initialBalance: "10000",
    },
  });
  accountC2Id = secondAccount.id;
  for (let i = 0; i < c1ExitDates.length; i++) {
    await seedClosedTrade(userC.id, accountCId, c1ExitDates[i], i);
  }
  await seedClosedTrade(userC.id, accountC2Id, daysAgo(3), 100);
  await seedSnapshot(userC.id, new Date(Date.UTC(2026, 0, 15)), 40, 8);
  await seedSnapshot(userC.id, new Date(Date.UTC(2026, 0, 28)), 55, 9);
  await seedSnapshot(userC.id, new Date(Date.UTC(2026, 1, 10)), 70, 10);
  await seedSnapshot(userC.id, utcDay(new Date()), 88, 99);

  // User D: one old trade only, no snapshot — empty periods + persist.
  const d = await makeUser("adv-period-d@test.local");
  userD = d.user;
  accountDId = d.accountId;
  await seedClosedTrade(userD.id, accountDId, daysAgo(400), 0);

  // User E: 3 recent trades, no snapshot — all-time recompute + persist.
  const e = await makeUser("adv-period-e@test.local");
  userE = e.user;
  accountEId = e.accountId;
  for (let i = 0; i < 3; i++) {
    await seedClosedTrade(userE.id, accountEId, daysAgo(5 + i * 5), i);
  }
});

afterAll(async () => {
  await db.user.deleteMany({
    where: { id: { in: [userC.id, userD.id, userE.id] } },
  });
  await db.$disconnect();
});

describe("trader score respects the period filter", () => {
  it("30d uses only the last 30 days, never the global snapshot", async () => {
    const payload = await getAdvancedAnalytics(userC.id, {
      period: "30d",
      module: "score",
    });
    const score = payload.advanced.score;
    const expected = await expectedScore(userC.id, undefined, "30d");
    expect(score.trades).toBe(expectedCount("30d"));
    expect(score.trades).toBe(expected.trades);
    expect(score.total).toBe(expected.total);
    expect(score.source).toBe("computed");
    // The snapshot (88 / 99 trades) must not leak into a 30d score.
    expect(score.total).not.toBe(88);
    expect(score.trades).not.toBe(99);

    // A 30d read must not touch today's global snapshot.
    const snap = await todaySnapshot(userC.id);
    expect(snap?.score).toBe(88);
    expect(snap?.tradeCount).toBe(99);
  });

  it("90d uses only the last 90 days", async () => {
    const payload = await getAdvancedAnalytics(userC.id, {
      period: "90d",
      module: "score",
    });
    const score = payload.advanced.score;
    const expected = await expectedScore(userC.id, undefined, "90d");
    expect(score.trades).toBe(expectedCount("90d"));
    expect(score.trades).toBe(expected.trades);
    expect(score.total).toBe(expected.total);
    expect(score.source).toBe("computed");
    expect(score.trades).toBeGreaterThan(expectedCount("30d"));
  });

  it("ytd uses only this year's trades", async () => {
    const payload = await getAdvancedAnalytics(userC.id, {
      period: "ytd",
      module: "score",
    });
    const score = payload.advanced.score;
    const expected = await expectedScore(userC.id, undefined, "ytd");
    expect(score.trades).toBe(expectedCount("ytd"));
    expect(score.trades).toBe(expected.trades);
    expect(score.total).toBe(expected.total);
    expect(score.source).toBe("computed");
  });

  it("all-time serves the frozen snapshot", async () => {
    const payload = await getAdvancedAnalytics(userC.id, {
      period: "all",
      module: "score",
    });
    const score = payload.advanced.score;
    expect(score.total).toBe(88);
    expect(score.components).toEqual({
      discipline: 22,
      edge: 22,
      consistency: 22,
      risk: 22,
    });
    expect(score.trades).toBe(99);
    expect(score.source).toBe("snapshot");
    // History is the snapshot history for the global scope.
    expect(payload.advanced.scoreHistory).toEqual([
      { month: "2026-01", score: 55, trades: 9 },
      { month: "2026-02", score: 70, trades: 10 },
      { month: currentMonth, score: 88, trades: 99 },
    ]);
  });

  it("account filter scopes the score and never touches the snapshot", async () => {
    const payload = await getAdvancedAnalytics(userC.id, {
      period: "30d",
      account: accountC2Id,
      module: "score",
    });
    const score = payload.advanced.score;
    expect(payload.accountId).toBe(accountC2Id);
    expect(score.trades).toBe(1);
    expect(score.source).toBe("computed");
    const expected = await expectedScore(userC.id, accountC2Id, "30d");
    expect(score.total).toBe(expected.total);

    const all = await getAdvancedAnalytics(userC.id, {
      period: "all",
      account: accountC2Id,
      module: "score",
    });
    expect(all.advanced.score.trades).toBe(1);
    expect(all.advanced.score.source).toBe("computed");
    expect(all.advanced.score.total).not.toBe(88);

    const snap = await todaySnapshot(userC.id);
    expect(snap?.score).toBe(88);
    expect(snap?.tradeCount).toBe(99);
  });

  it("a period with no trades is an honest empty and persists nothing", async () => {
    expect(await todaySnapshot(userD.id)).toBeNull();
    const payload = await getAdvancedAnalytics(userD.id, {
      period: "30d",
      module: "score",
    });
    const score = payload.advanced.score;
    expect(score.trades).toBe(0);
    expect(score.source).toBe("computed");
    expect(score.total).not.toBe(88);
    // A scoped read with no snapshot must not create one.
    expect(await todaySnapshot(userD.id)).toBeNull();
  });

  it("all-time without a snapshot recomputes and persists it", async () => {
    const payload = await getAdvancedAnalytics(userE.id, {
      period: "all",
      module: "score",
    });
    const score = payload.advanced.score;
    const expected = await expectedScore(userE.id, undefined, "all");
    expect(score.trades).toBe(3);
    expect(score.total).toBe(expected.total);
    expect(score.source).toBe("computed");
    expect(payload.advanced.scoreHistory).toEqual([
      { month: currentMonth, score: score.total, trades: 3 },
    ]);

    const saved = await todaySnapshot(userE.id);
    expect(saved).not.toBeNull();
    expect(saved?.score).toBe(score.total);
    expect(saved?.tradeCount).toBe(3);

    // The next all-time read serves the frozen snapshot.
    const again = await getAdvancedAnalytics(userE.id, {
      period: "all",
      module: "score",
    });
    expect(again.advanced.score.source).toBe("snapshot");
    expect(again.advanced.score.total).toBe(score.total);
  });

  it("history follows the score scope, not the snapshots", async () => {
    const payload = await getAdvancedAnalytics(userC.id, {
      period: "30d",
      module: "score",
    });
    const history = payload.advanced.scoreHistory;
    expect(history.length).toBeGreaterThanOrEqual(1);
    // No snapshot month may appear in a 30d history.
    expect(history.some((p) => p.month === "2026-01")).toBe(false);
    expect(history.some((p) => p.month === "2026-02")).toBe(false);
    // The last point covers every 30d trade with the 30d score.
    const last = history[history.length - 1];
    expect(last.trades).toBe(expectedCount("30d"));
    expect(last.score).toBe(payload.advanced.score.total);
  });
});
