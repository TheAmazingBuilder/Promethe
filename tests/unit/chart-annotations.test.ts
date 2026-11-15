/**
 * v2.5 Module 2 — annotations engine unit tests (spec §4.7, §7).
 * Scoping (GLOBAL/ACCOUNT/STRATEGY) and before/after stats (point + range,
 * local exit dates, sample-size warning).
 */
import { describe, expect, it } from "vitest";
import {
  annotationApplies,
  beforeAfterStats,
  type Annotation,
} from "@/lib/charts/annotations";
import type { BuilderTrade } from "@/lib/charts/builder";

let seq = 0;
const trade = (day: string, r: string, pnl: string): BuilderTrade => {
  seq += 1;
  return {
    id: `t${seq}`,
    entryTime: `${day}T10:00:00.000Z`,
    exitTime: `${day}T12:00:00.000Z`,
    netPnl: pnl,
    rMultiple: r,
    resultType: Number(pnl) > 0 ? "WIN" : "LOSS",
    strategyId: null,
    strategyName: null,
    instrumentId: "i1",
    symbol: "EURUSD",
    direction: "LONG",
    session: null,
    lots: "1",
    accountId: "a1",
    accountName: "Main",
    timeframe: null,
    setupType: null,
    marketCondition: null,
    exitReason: null,
    emotionBefore: null,
    emotionDuring: null,
    emotionAfter: null,
    confidence: null,
    setupQualityRating: null,
    followedPlan: null,
    pips: null,
    points: null,
    riskPercent: null,
    mfeR: null,
    maeR: null,
    durationMin: 120,
    tags: [],
    mistakes: [],
    localDate: day,
    localEntryDate: day,
    localWeekday: null,
    localHour: null,
    localMonth: null,
    localDayOfMonth: null,
    localIsoWeek: null,
  };
};

const ann = (patch: Partial<Annotation> = {}): Annotation => ({
  id: "x",
  date: "2025-03-01T00:00:00.000Z",
  endDate: null,
  label: "Strategy change",
  note: null,
  kind: "STRATEGY_CHANGE",
  color: null,
  scope: "GLOBAL",
  accountId: null,
  strategyId: null,
  ...patch,
});

describe("annotations — scoping", () => {
  it("GLOBAL applies everywhere", () => {
    expect(annotationApplies(ann(), { accountId: "a1", strategyId: "s1" })).toBe(true);
    expect(annotationApplies(ann(), { accountId: null, strategyId: null })).toBe(true);
  });

  it("ACCOUNT applies to its account and to all-accounts charts", () => {
    const a = ann({ scope: "ACCOUNT", accountId: "a2" });
    expect(annotationApplies(a, { accountId: "a2", strategyId: null })).toBe(true);
    expect(annotationApplies(a, { accountId: null, strategyId: null })).toBe(true);
    expect(annotationApplies(a, { accountId: "a1", strategyId: null })).toBe(false);
  });

  it("STRATEGY applies to its strategy and to all-strategies charts", () => {
    const a = ann({ scope: "STRATEGY", strategyId: "s2" });
    expect(annotationApplies(a, { accountId: null, strategyId: "s2" })).toBe(true);
    expect(annotationApplies(a, { accountId: null, strategyId: null })).toBe(true);
    expect(annotationApplies(a, { accountId: null, strategyId: "s1" })).toBe(false);
  });
});

describe("annotations — before/after stats", () => {
  it("point annotation splits on the date (after = from the date on)", () => {
    const trades = [
      trade("2025-01-10", "1", "100"),
      trade("2025-02-20", "2", "200"),
      trade("2025-03-05", "-1", "-50"),
      trade("2025-04-10", "3", "150"),
    ];
    const r = beforeAfterStats(trades, ann());
    expect(r.before.n).toBe(2);
    expect(r.after.n).toBe(2);
    expect(r.before.netPnl).toBe(300);
    expect(r.after.netPnl).toBe(100);
    // Small samples → not significant.
    expect(r.notSignificant).toBe(true);
  });

  it("range annotation excludes the range from both sides", () => {
    const trades = [
      trade("2025-01-10", "1", "100"),
      trade("2025-03-05", "-1", "-50"), // inside the range
      trade("2025-04-10", "3", "150"),
    ];
    const r = beforeAfterStats(
      trades,
      ann({ endDate: "2025-03-20T00:00:00.000Z" })
    );
    expect(r.before.n).toBe(1);
    expect(r.after.n).toBe(1);
    expect(r.before.netPnl).toBe(100);
    expect(r.after.netPnl).toBe(150);
  });

  it("win rate / expectancy / drawdown per side", () => {
    const trades = [
      trade("2025-01-01", "1", "100"),
      trade("2025-01-02", "-1", "-60"),
      trade("2025-04-01", "2", "200"),
      trade("2025-04-02", "2", "200"),
    ];
    const r = beforeAfterStats(trades, ann());
    expect(r.before.winRate).toBeCloseTo(50, 6);
    expect(r.before.expectancyR).toBeCloseTo(0, 6);
    expect(r.before.maxDrawdown).toBeCloseTo(60, 6);
    expect(r.after.winRate).toBeCloseTo(100, 6);
    expect(r.after.expectancyR).toBeCloseTo(2, 6);
  });

  it("empty sides are zeroed", () => {
    const r = beforeAfterStats([], ann());
    expect(r.before.n).toBe(0);
    expect(r.after.n).toBe(0);
    expect(r.before.winRate).toBeNull();
    expect(r.notSignificant).toBe(true);
  });
});
