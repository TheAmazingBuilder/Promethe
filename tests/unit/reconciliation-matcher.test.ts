/**
 * v3 Phase 3 — Reconciliation matcher unit tests (pure).
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MATCHER_CONFIG,
  findCandidates,
  highConfidencePairs,
  scorePair,
} from "@/lib/reconciliation/matcher";

const BASE = {
  instrumentId: "inst_gold",
  direction: "LONG",
  entryTime: "2025-01-15T08:32:00.000Z",
  entryPrice: "2650.50",
  exitTime: "2025-01-15T11:05:00.000Z",
  exitPrice: "2655.80",
  lots: "0.50",
};

function manual(overrides: Record<string, unknown> = {}) {
  return { id: "manual-1", externalId: null, ...BASE, ...overrides };
}

function broker(overrides: Record<string, unknown> = {}) {
  return { id: "broker-1", externalId: "MT5:SRV:1:9001", ...BASE, ...overrides };
}

describe("scorePair — hard requirements", () => {
  it("rejects different instruments or directions", () => {
    expect(scorePair(manual(), broker({ instrumentId: "inst_fx" })).score).toBe(0);
    expect(scorePair(manual(), broker({ direction: "SHORT" })).score).toBe(0);
  });

  it("exact externalId = certain match", () => {
    const result = scorePair(manual({ externalId: "MT5:SRV:1:9001" }), broker());
    expect(result.score).toBe(1);
    expect(result.reasons[0]?.code).toBe("EXTERNAL_ID_MATCH");
  });
});

describe("scorePair — proximity scoring", () => {
  it("full proximity = high score with human-readable reasons", () => {
    const result = scorePair(manual(), broker());
    expect(result.score).toBe(1); // time 0.35 + price 0.25 + lots 0.2 + exit 0.2
    const codes = result.reasons.map((r) => r.code);
    expect(codes).toContain("ENTRY_TIME_STRONG");
    expect(codes).toContain("ENTRY_PRICE_MATCH");
    expect(codes).toContain("LOTS_MATCH");
    expect(codes).toContain("EXIT_MATCH");
  });

  it("same day, date-only manual trade still scores", () => {
    const pipSizeOf = () => "0.10"; // gold pips
    const result = scorePair(
      manual({
        dateOnly: true,
        entryTime: "2025-01-15T00:00:00.000Z",
        exitTime: null,
        exitPrice: null,
        entryPrice: "2650.70",
      }),
      broker(),
      DEFAULT_MATCHER_CONFIG,
      pipSizeOf
    );
    expect(result.score).toBeGreaterThan(0.4);
    expect(result.score).toBeLessThan(DEFAULT_MATCHER_CONFIG.autoMergeScore);
    expect(result.reasons.some((r) => r.code === "ENTRY_TIME_SAME_DAY_DATE_ONLY")).toBe(true);
  });

  it("different days scores below the candidate threshold", () => {
    const result = scorePair(manual({ entryTime: "2025-01-16T08:32:00.000Z" }), broker());
    expect(result.score).toBeLessThan(DEFAULT_MATCHER_CONFIG.minScore);
  });

  it("entry price tolerance in pips uses the instrument pip size", () => {
    const pipSizeOf = () => "0.10"; // XAUUSD
    // 1.20 apart on gold = 12 pips > tolerance 3 → no ENTRY_PRICE_MATCH
    const far = scorePair(manual({ entryPrice: "2651.70" }), broker(), DEFAULT_MATCHER_CONFIG, pipSizeOf);
    expect(far.reasons.some((r) => r.code === "ENTRY_PRICE_MATCH")).toBe(false);
    // 0.20 apart = 2 pips ≤ 3 → match
    const near = scorePair(manual({ entryPrice: "2650.70" }), broker(), DEFAULT_MATCHER_CONFIG, pipSizeOf);
    expect(near.reasons.some((r) => r.code === "ENTRY_PRICE_MATCH")).toBe(true);
  });
});

describe("findCandidates", () => {
  const manuals = [
    manual({ id: "m1", entryTime: "2025-01-15T08:32:00.000Z" }),
    manual({ id: "m2", entryTime: "2025-01-15T08:34:00.000Z", lots: "0.51", entryPrice: "2650.51" }),
    manual({ id: "m3", entryTime: "2025-01-20T10:00:00.000Z" }), // different day → excluded
  ];
  const brokers = [broker({ id: "b1" })];

  it("returns only pairs above the threshold, sorted by score", () => {
    const candidates = findCandidates(manuals, brokers);
    expect(candidates.map((c) => c.manual.id)).toEqual(["m1", "m2"]);
    expect(candidates[0]!.score).toBeGreaterThan(candidates[1]!.score);
  });

  it("high-confidence filter requires exactly one candidate ≥ 0.9", () => {
    const candidates = findCandidates(manuals, brokers);
    // m2 scores below 0.9 (no EXIT_MATCH?) — actually m2 has exit too…
    // m1 = 1.0, m2 ≈ 0.95 → broker b1 has TWO candidates → NOT auto-mergeable.
    expect(highConfidencePairs(candidates)).toEqual([]);

    const single = findCandidates([manuals[0]!], brokers);
    expect(highConfidencePairs(single)).toHaveLength(1);
  });
});
