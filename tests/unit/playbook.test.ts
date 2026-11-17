/**
 * Playbook pure logic (Phase 2) — health flags, compliance, setup insights.
 */
import { describe, expect, it } from "vitest";
import {
  complianceSummary,
  cumulativeR,
  setupInsight,
  strategyHealthFlags,
} from "@/lib/playbook/health";

describe("strategyHealthFlags", () => {
  const base = {
    status: "ACTIVE",
    hasRisk: true,
    hasEntryConditions: true,
    hasInvalidation: true,
    hasChecklist: true,
    lastTradeAt: new Date(),
  };

  it("returns no flags for a complete, recently traded strategy", () => {
    expect(strategyHealthFlags(base)).toEqual([]);
  });

  it("flags every missing piece, factually", () => {
    expect(
      strategyHealthFlags({
        ...base,
        hasRisk: false,
        hasEntryConditions: false,
        hasInvalidation: false,
        hasChecklist: false,
        lastTradeAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      }),
    ).toEqual([
      "NO_RECENT_TRADES",
      "MISSING_RISK",
      "MISSING_ENTRY_CONDITIONS",
      "MISSING_INVALIDATION",
      "MISSING_CHECKLIST",
    ]);
  });

  it("flags DRAFT and ARCHIVED, and skips NO_RECENT_TRADES for them", () => {
    expect(
      strategyHealthFlags({ ...base, status: "DRAFT", lastTradeAt: null }),
    ).toEqual(["DRAFT"]);
    expect(
      strategyHealthFlags({ ...base, status: "ARCHIVED", lastTradeAt: null }),
    ).toEqual(["ARCHIVED"]);
  });

  it("flags NO_RECENT_TRADES when never traded", () => {
    expect(strategyHealthFlags({ ...base, lastTradeAt: null })).toEqual([
      "NO_RECENT_TRADES",
    ]);
  });
});

describe("complianceSummary", () => {
  it("counts MATCHED only and reports unreviewed trades", () => {
    const res = complianceSummary([
      { playbookMatch: "MATCHED" },
      { playbookMatch: "MATCHED" },
      { playbookMatch: "PARTIAL" },
      { playbookMatch: "OFF_PLAYBOOK" },
      { playbookMatch: null },
    ]);
    expect(res).toEqual({
      reviewed: 4,
      matched: 2,
      partial: 1,
      offPlaybook: 1,
      unreviewed: 1,
      scorePct: 50,
    });
  });

  it("returns a null score when nothing was reviewed", () => {
    const res = complianceSummary([
      { playbookMatch: null },
      { playbookMatch: null },
    ]);
    expect(res.scorePct).toBeNull();
    expect(res.reviewed).toBe(0);
    expect(res.unreviewed).toBe(2);
  });
});

describe("setupInsight", () => {
  it("computes win rate, R totals and the dominant session", () => {
    const res = setupInsight([
      { resultType: "WIN", rMultiple: 2, instrumentId: "xau", symbol: "XAUUSD", session: "LONDON" },
      { resultType: "WIN", rMultiple: 1, instrumentId: "xau", symbol: "XAUUSD", session: "LONDON" },
      { resultType: "LOSS", rMultiple: -1, instrumentId: "eur", symbol: "EURUSD", session: "NEW_YORK" },
      { resultType: "LOSS", rMultiple: -1, instrumentId: "xau", symbol: "XAUUSD", session: "LONDON" },
      { resultType: "WIN", rMultiple: 1.5, instrumentId: "xau", symbol: "XAUUSD", session: "LONDON" },
    ]);
    expect(res.trades).toBe(5);
    expect(res.wins).toBe(3);
    expect(res.winRatePct).toBe(60);
    expect(res.totalR).toBe(2.5);
    expect(res.expectancyR).toBe(0.5);
    expect(res.topInstrument).toBe("XAUUSD");
    expect(res.topInstrumentId).toBe("xau");
    expect(res.topSession).toBe("LONDON");
    expect(res.smallSample).toBe(false);
  });

  it("flags small samples and handles empty windows", () => {
    expect(setupInsight([]).smallSample).toBe(true);
    expect(setupInsight([]).winRatePct).toBeNull();
    expect(setupInsight([]).totalR).toBeNull();
    expect(
      setupInsight([
        { resultType: "WIN", rMultiple: 1, instrumentId: "x", symbol: "X", session: null },
      ]).smallSample,
    ).toBe(true);
  });
});

describe("cumulativeR", () => {
  it("builds an oldest-first cumulative curve", () => {
    const t0 = new Date("2026-01-01");
    const t1 = new Date("2026-01-02");
    const t2 = new Date("2026-01-03");
    expect(
      cumulativeR([
        { r: 2, at: t1 },
        { r: -1, at: t0 },
        { r: 1, at: t2 },
      ]),
    ).toEqual([-1, 1, 2]);
  });
});
