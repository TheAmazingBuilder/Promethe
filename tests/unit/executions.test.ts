/**
 * Unit tests — execution aggregation (scale-ins / partial exits).
 *
 * Reference scenario (hand-computed):
 *   EURUSD LONG, contract 100 000
 *   ENTRY 0.30 @ 1.08000, ADD 0.20 @ 1.08100
 *   PARTIAL_EXIT 0.25 @ 1.08400, FINAL_EXIT 0.25 @ 1.08600
 *
 *   avgEntry  = (0.30×1.08000 + 0.20×1.08100) / 0.50 = 1.080400
 *   avgExit   = (0.25×1.08400 + 0.25×1.08600) / 0.50 = 1.085000
 *   realized  = (1.08400−1.08040)×0.25×100000  = 90 USD
 *             + (1.08600−1.08040)×0.25×100000 = 140 USD  → 230 USD
 */
import { describe, expect, it } from "vitest";
import { aggregateExecutions } from "@/lib/trading/executions";
import { findPreset } from "@/lib/trading/instruments";

const EURUSD = findPreset("EURUSD")!;

describe("aggregateExecutions", () => {
  it("weighted average entry, partial + final exits, realized P&L", () => {
    const agg = aggregateExecutions("LONG", EURUSD, [
      { type: "ENTRY", time: "2026-01-05T09:00:00Z", price: "1.08000", lots: "0.30" },
      { type: "ADD", time: "2026-01-05T10:00:00Z", price: "1.08100", lots: "0.20" },
      { type: "PARTIAL_EXIT", time: "2026-01-05T13:00:00Z", price: "1.08400", lots: "0.25" },
      { type: "FINAL_EXIT", time: "2026-01-05T15:00:00Z", price: "1.08600", lots: "0.25" },
    ]);

    expect(agg.count).toBe(4);
    expect(agg.avgEntry!.toString()).toBe("1.0804");
    expect(agg.avgExit!.toString()).toBe("1.085");
    expect(agg.totalEntryLots.toString()).toBe("0.5");
    expect(agg.totalExitLots.toString()).toBe("0.5");
    expect(agg.remainingLots.toString()).toBe("0");
    expect(agg.grossPnlQuote!.toString()).toBe("230");
  });

  it("still-open position: remaining lots and no realized P&L", () => {
    const agg = aggregateExecutions("LONG", EURUSD, [
      { type: "ENTRY", time: "2026-01-05T09:00:00Z", price: "1.08000", lots: "0.30" },
      { type: "PARTIAL_EXIT", time: "2026-01-05T13:00:00Z", price: "1.09000", lots: "0.10" },
    ]);
    expect(agg.remainingLots.toString()).toBe("0.2");
    // (1.09 − 1.08) × 0.10 × 100000 = 100 USD realized on the partial
    expect(agg.grossPnlQuote!.toString()).toBe("100");
  });

  it("short direction signs the P&L correctly", () => {
    const agg = aggregateExecutions("SHORT", EURUSD, [
      { type: "ENTRY", time: "2026-01-05T09:00:00Z", price: "1.09000", lots: "0.10" },
      { type: "FINAL_EXIT", time: "2026-01-05T15:00:00Z", price: "1.08000", lots: "0.10" },
    ]);
    // SHORT: entry − exit = 0.01 favorable → 0.01 × 0.10 × 100000 = 100
    expect(agg.grossPnlQuote!.toString()).toBe("100");
  });

  it("over-exits are clamped to the open basis (no phantom lots)", () => {
    const agg = aggregateExecutions("LONG", EURUSD, [
      { type: "ENTRY", time: "2026-01-05T09:00:00Z", price: "1.08000", lots: "0.20" },
      { type: "FINAL_EXIT", time: "2026-01-05T15:00:00Z", price: "1.09000", lots: "0.50" },
    ]);
    expect(agg.totalExitLots.toString()).toBe("0.2");
    expect(agg.remainingLots.toString()).toBe("0");
  });

  it("commissions are summed as signed costs", () => {
    const agg = aggregateExecutions("LONG", EURUSD, [
      { type: "ENTRY", time: "2026-01-05T09:00:00Z", price: "1.08000", lots: "0.30", commission: "3.5" },
      { type: "FINAL_EXIT", time: "2026-01-05T15:00:00Z", price: "1.09000", lots: "0.30", commission: "3.5" },
    ]);
    expect(agg.totalCommission.toString()).toBe("7");
  });

  it("executions are processed chronologically regardless of input order", () => {
    const agg = aggregateExecutions("LONG", EURUSD, [
      { type: "FINAL_EXIT", time: "2026-01-05T15:00:00Z", price: "1.08600", lots: "0.25" },
      { type: "ENTRY", time: "2026-01-05T09:00:00Z", price: "1.08000", lots: "0.30" },
      { type: "PARTIAL_EXIT", time: "2026-01-05T13:00:00Z", price: "1.08400", lots: "0.25" },
      { type: "ADD", time: "2026-01-05T10:00:00Z", price: "1.08100", lots: "0.20" },
    ]);
    expect(agg.avgEntry!.toString()).toBe("1.0804");
    expect(agg.grossPnlQuote!.toString()).toBe("230");
    expect(agg.firstEntryTime!.toISOString()).toBe("2026-01-05T09:00:00.000Z");
    expect(agg.lastExitTime!.toISOString()).toBe("2026-01-05T15:00:00.000Z");
  });

  it("empty execution list → null aggregates, zero lots", () => {
    const agg = aggregateExecutions("LONG", EURUSD, []);
    expect(agg.count).toBe(0);
    expect(agg.avgEntry).toBeNull();
    expect(agg.avgExit).toBeNull();
    expect(agg.grossPnlQuote).toBeNull();
    expect(agg.remainingLots.toString()).toBe("0");
  });
});
