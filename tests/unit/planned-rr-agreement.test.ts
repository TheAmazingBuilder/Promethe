/**
 * Lot 1 Phase D (MD §3.7) — client/server planned R:R agreement.
 *
 * The client (`calcPlannedRR`, used by the trade form and by
 * `previewTrade`) and the server (`computeDerived`, which stores
 * `plannedRR`) must agree on the same inputs: a planned R:R shown
 * in the form that differs from the stored one is a silent lie.
 * Both paths call the same direction-aware function, so this test
 * pins the agreement — including the null cases (wrong-side TP,
 * missing SL, TP == entry) where a naive abs() implementation
 * used to return a positive ratio.
 */
import { describe, expect, it } from "vitest";
import type { Account, Instrument } from "@prisma/client";
import { calcPlannedRR, previewTrade } from "@/lib/trading/calculate";
import { computeDerived } from "@/server/trades";

function fixtures() {
  const instrument = {
    id: "instrument-test",
    symbol: "TESTUSD",
    name: "Test instrument",
    assetClass: "FOREX",
    baseCurrency: "TEST",
    quoteCurrency: "USD",
    digits: 2,
    pipSize: "0.01",
    pointSize: "0.01",
    contractSize: "1",
    tickSize: "0.01",
    tickValue: "0.01",
  } as unknown as Instrument;

  const account = { currency: "USD" } as Account;

  const base = {
    instrument,
    account,
    direction: "LONG",
    entryPrice: "100",
    exitPrice: "110",
    stopLoss: "90",
    takeProfit: "120",
    lots: "1",
    commission: "0",
    swap: "0",
    fees: "0",
    quoteToAccountRate: null,
    entryTime: new Date("2026-01-01T12:00:00.000Z"),
    balanceAtEntry: null,
    fxRates: [],
    detectionSettings: null,
    pnlSource: "CALCULATED",
    manualNetPnl: null,
  };

  return { base };
}

function agreed(
  overrides: Record<string, unknown>
): { client: string | null; server: string | null } {
  const { base } = fixtures();
  const params = { ...base, ...overrides };
  const client = calcPlannedRR(
    params.direction as "LONG" | "SHORT",
    params.entryPrice as string,
    params.stopLoss as string | null,
    params.takeProfit as string | null
  );
  const server = computeDerived(params as never);
  return {
    client: client?.toString() ?? null,
    server: server.plannedRR?.toString() ?? null,
  };
}

describe("client/server planned R:R agreement", () => {
  it("LONG 100 / SL 90 / TP 120 agrees at 2", () => {
    expect(agreed({})).toEqual({ client: "2", server: "2" });
  });

  it("SHORT agrees with the mirrored levels", () => {
    expect(
      agreed({ direction: "SHORT", stopLoss: "110", takeProfit: "80" })
    ).toEqual({ client: "2", server: "2" });
  });

  it("fractional ratios agree (1.5)", () => {
    expect(agreed({ takeProfit: "115" })).toEqual({ client: "1.5", server: "1.5" });
  });

  it("a wrong-side TP is null on both sides, never a positive ratio", () => {
    expect(agreed({ takeProfit: "90" })).toEqual({ client: null, server: null });
    expect(
      agreed({ direction: "SHORT", stopLoss: "110", takeProfit: "110" })
    ).toEqual({ client: null, server: null });
  });

  it("a missing stop loss is null on both sides", () => {
    expect(agreed({ stopLoss: null })).toEqual({ client: null, server: null });
  });

  it("TP == entry is null on both sides", () => {
    expect(agreed({ takeProfit: "100" })).toEqual({ client: null, server: null });
  });

  it("no TP is null on both sides", () => {
    expect(agreed({ takeProfit: null })).toEqual({ client: null, server: null });
  });

  it("an open trade (no exit) still stores the same planned R:R", () => {
    expect(agreed({ exitPrice: null })).toEqual({ client: "2", server: "2" });
  });

  it("previewTrade().plannedRR agrees with calcPlannedRR for the same inputs", () => {
    const preview = previewTrade({
      instrument: {
        symbol: "TESTUSD",
        name: "Test instrument",
        assetClass: "FOREX",
        baseCurrency: "TEST",
        quoteCurrency: "USD",
        digits: 2,
        pipSize: "0.01",
        pointSize: "0.01",
        contractSize: "1",
      },
      direction: "LONG",
      lots: "1",
      entry: "100",
      exit: "110",
      stopLoss: "90",
      takeProfit: "120",
      accountCurrency: "USD",
    });
    expect(preview.plannedRR?.toString()).toBe("2");
    expect(preview.plannedRR?.toString()).toBe(
      calcPlannedRR("LONG", "100", "90", "120")?.toString()
    );
  });
});
