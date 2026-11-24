import { describe, expect, it } from "vitest";
import type { Account, Instrument } from "@prisma/client";
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

  const account = {
    currency: "USD",
  } as Account;

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
    detectionSettings: [],
  };

  return { base };
}

describe("computeDerived manual P&L and R multiple", () => {
  it("derives R multiple from the final manual net P&L", () => {
    const { base } = fixtures();

    const result = computeDerived({
      ...base,
      pnlSource: "MANUAL",
      manualNetPnl: "25",
    });

    // Initial risk = (100 - 90) × 1 lot × contract size 1 = 10 USD.
    // Manual net P&L = 25 USD, therefore net R = 25 / 10 = 2.5R.
    expect(result.netPnl?.toString()).toBe("25");
    expect(result.rMultiple?.toString()).toBe("2.5");
    expect(result.realizedRR?.toString()).toBe("2.5");
  });

  it("uses calculated net P&L when the source is CALCULATED", () => {
    const { base } = fixtures();

    const result = computeDerived({
      ...base,
      pnlSource: "CALCULATED",
      manualNetPnl: "25",
    });

    expect(result.netPnl?.toString()).toBe("10");
    expect(result.rMultiple?.toString()).toBe("1");
    expect(result.realizedRR?.toString()).toBe("1");
  });
});
