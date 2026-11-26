/**
 * Confluences (MRT wave 1) — unit tests.
 *
 * Pure functions only (no DB): the hit-rate computation, the preset list
 * invariants, the tag validation kind, and the clean route. Thresholds
 * asserted here are the ones documented in the UI (10 trades minimum).
 */
import { describe, expect, it } from "vitest";
import {
  MIN_SAMPLE_CONFLUENCE,
  computeAdvancedAnalytics,
  computeConfluences,
  type AdvancedTrade,
} from "@/lib/analytics/advanced";
import { computeTradeStats } from "@/lib/analytics/engine";
import { computeAdvancedStats } from "@/lib/analytics/insights";
import { parsePathname, routeToPath } from "@/lib/routes";
import {
  CONFLUENCE_CUSTOM_COLOR,
  CONFLUENCE_PRESETS,
  CONFLUENCE_PRESET_NAMES,
} from "@/lib/trading/confluences";
import { tagInputSchema } from "@/lib/validations/trade";

let seq = 0;

function makeTrade(partial: Partial<AdvancedTrade> = {}): AdvancedTrade {
  seq += 1;
  const day = String(1 + (seq % 28)).padStart(2, "0");
  const base: AdvancedTrade = {
    id: `trade-${seq}`,
    exitTime: `2026-01-${day}T12:00:00.000Z`,
    entryTime: `2026-01-${day}T10:00:00.000Z`,
    netPnl: "100",
    rMultiple: "1",
    resultType: "WIN",
    strategyId: null,
    strategyName: null,
    instrumentId: "inst-1",
    symbol: "XAUUSD",
    direction: "LONG",
    session: "LONDON",
    lots: "0.1",
    accountId: "acc-1",
    accountName: "Main",
    timeframe: "H1",
    setupType: "BOS",
    marketCondition: null,
    exitReason: "MANUAL",
    emotionBefore: null,
    followedPlan: true,
    commission: "0",
    swap: "0",
    fees: "0",
    localDate: `2026-01-${day}`,
    localWeekday: 3,
    localHour: 10,
    durationMin: 120,
    customFields: null,
    mfeR: null,
    maeR: null,
    takeProfit: null,
    plannedRR: null,
    entryPrice: "2000",
    initialStopLoss: "1990",
    tags: [],
    confluenceTags: [],
    violationCount: 0,
    riskPercent: "1",
    setupQualityRating: 4,
    localYear: 2026,
    localMonth: 1,
    localDayOfMonth: Number(day),
    localIsoWeek: 2,
    localEntryDate: `2026-01-${day}`,
    timeInProfitMin: null,
    timeInLossMin: null,
  };
  return { ...base, ...partial };
}

const FVG = { id: "tag-fvg", name: "Fair Value Gap", color: "#10b981" };
const OB = { id: "tag-ob", name: "Order Block", color: "#14b8a6" };

describe("CONFLUENCE_PRESETS — code-only list, never seeded", () => {
  it("holds the ten ICT/SMC confluences for XAUUSD/forex", () => {
    expect(CONFLUENCE_PRESETS.map((p) => p.name)).toEqual([
      "Liquidity Sweep",
      "Fair Value Gap",
      "Order Block",
      "Break of Structure",
      "Change of Character",
      "Killzone",
      "HTF Aligned",
      "Premium / Discount",
      "Equal Highs/Lows",
      "Session Liquidity",
    ]);
  });

  it("has unique names, valid hex colors, and names that fit a tag (max 40)", () => {
    const names = CONFLUENCE_PRESETS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    for (const p of CONFLUENCE_PRESETS) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.name.length).toBeLessThanOrEqual(40);
      expect(p.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(CONFLUENCE_PRESET_NAMES.has(p.name)).toBe(true);
    }
    expect(CONFLUENCE_CUSTOM_COLOR).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("uses the documented minimum sample of 10 trades", () => {
    expect(MIN_SAMPLE_CONFLUENCE).toBe(10);
  });
});

describe("tagInputSchema — CONFLUENCE kind", () => {
  it("accepts a confluence tag and rejects an unknown kind", () => {
    expect(
      tagInputSchema.safeParse({
        name: "Fair Value Gap",
        color: "#10b981",
        kind: "CONFLUENCE",
      }).success
    ).toBe(true);
    expect(
      tagInputSchema.safeParse({
        name: "Nope",
        color: "#10b981",
        kind: "BOGUS",
      }).success
    ).toBe(false);
  });
});

describe("computeConfluences — hit rate per confluence", () => {
  it("returns honest zeros on an empty scope", () => {
    expect(computeConfluences([])).toEqual({
      total: 0,
      tagged: 0,
      untagged: 0,
      rows: [],
    });
  });

  it("computes win rate, expectancy, total R and net P&L for one confluence", () => {
    const trades = [
      makeTrade({
        resultType: "WIN",
        rMultiple: "2",
        netPnl: "200",
        confluenceTags: [FVG],
      }),
      makeTrade({
        resultType: "WIN",
        rMultiple: "1",
        netPnl: "100",
        confluenceTags: [FVG],
      }),
      makeTrade({
        resultType: "LOSS",
        rMultiple: "-1",
        netPnl: "-100",
        confluenceTags: [FVG],
      }),
      makeTrade({
        resultType: "BREAKEVEN",
        rMultiple: "0",
        netPnl: "0",
        confluenceTags: [FVG],
      }),
    ];
    const result = computeConfluences(trades);
    expect(result.total).toBe(4);
    expect(result.tagged).toBe(4);
    expect(result.untagged).toBe(0);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.tagId).toBe("tag-fvg");
    expect(row.name).toBe("Fair Value Gap");
    expect(row.count).toBe(4);
    expect(row.rSampleSize).toBe(4);
    expect(row.decidedSampleSize).toBe(3);
    expect(row.wins).toBe(2);
    expect(row.losses).toBe(1);
    expect(row.breakevens).toBe(1);
    // Win rate over decided trades only (2 wins / 3 decided).
    expect(row.winRate).toBeCloseTo(66.7, 1);
    expect(row.wilsonLower).not.toBeNull();
    expect(row.wilsonUpper).not.toBeNull();
    // Mean R over all four trades: (2 + 1 - 1 + 0) / 4.
    expect(row.expectancy).toBe(0.5);
    expect(row.avgR).toBe(0.5);
    expect(row.totalR).toBe(2);
    expect(row.netPnl).toBe("200");
  });

  it("counts a multi-confluence trade once per confluence and once as tagged", () => {
    const trades = [
      makeTrade({
        resultType: "WIN",
        rMultiple: "1",
        netPnl: "50",
        confluenceTags: [FVG, OB],
      }),
      makeTrade({
        resultType: "LOSS",
        rMultiple: "-1",
        netPnl: "-50",
        confluenceTags: [OB],
      }),
      makeTrade({ resultType: "WIN", rMultiple: "1", netPnl: "50" }),
    ];
    const result = computeConfluences(trades);
    expect(result.total).toBe(3);
    expect(result.tagged).toBe(2);
    expect(result.untagged).toBe(1);
    expect(result.rows).toHaveLength(2);
    const fvg = result.rows.find((r) => r.tagId === "tag-fvg");
    const ob = result.rows.find((r) => r.tagId === "tag-ob");
    expect(fvg?.count).toBe(1);
    expect(ob?.count).toBe(2);
    // Most-tagged first.
    expect(result.rows[0].tagId).toBe("tag-ob");
  });

  it("counts a repeated tag on one trade only once", () => {
    const trades = [
      makeTrade({
        resultType: "WIN",
        rMultiple: "1",
        netPnl: "10",
        confluenceTags: [FVG, FVG],
      }),
    ];
    const result = computeConfluences(trades);
    expect(result.tagged).toBe(1);
    expect(result.rows[0].count).toBe(1);
  });

  it("treats a trade without confluenceTags (legacy) as untagged", () => {
    const trade = makeTrade({ resultType: "WIN" });
    delete (trade as Partial<AdvancedTrade>).confluenceTags;
    const result = computeConfluences([trade]);
    expect(result.total).toBe(1);
    expect(result.tagged).toBe(0);
    expect(result.untagged).toBe(1);
    expect(result.rows).toEqual([]);
  });

  it("leaves win rate null when no trade is decided (breakevens only)", () => {
    const trades = [
      makeTrade({
        resultType: "BREAKEVEN",
        rMultiple: "0",
        netPnl: "0",
        confluenceTags: [FVG],
      }),
    ];
    const row = computeConfluences(trades).rows[0];
    expect(row.winRate).toBeNull();
    expect(row.wilsonLower).toBeNull();
    expect(row.expectancy).toBe(0);
  });

  it("is exposed through computeAdvancedAnalytics", () => {
    const trades = [
      makeTrade({
        resultType: "WIN",
        rMultiple: "1",
        netPnl: "100",
        confluenceTags: [FVG],
      }),
    ];
    const stats = computeTradeStats(trades);
    const advanced = computeAdvancedStats(trades, stats);
    const computed = computeAdvancedAnalytics(trades, stats, advanced);
    expect(computed.confluences.total).toBe(1);
    expect(computed.confluences.rows).toHaveLength(1);
    expect(computed.confluences.rows[0].name).toBe("Fair Value Gap");
  });
});

describe("routes — /analytics/confluences", () => {
  it("parses the clean path and round-trips it", () => {
    expect(parsePathname("/analytics/confluences").view).toBe(
      "analytics-confluences"
    );
    expect(routeToPath({ view: "analytics-confluences" })).toBe(
      "/analytics/confluences"
    );
  });
});
