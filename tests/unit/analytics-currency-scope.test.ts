import { describe, expect, it } from "vitest";
import { scopeTradesToCurrency } from "@/lib/analytics/currency-scope";

describe("scopeTradesToCurrency", () => {
  const trades = [
    { id: "1", pnlCurrency: "USD" },
    { id: "2", pnlCurrency: "CAD" },
    { id: "3", pnlCurrency: "USD" },
    { id: "4", pnlCurrency: "EUR" },
  ];

  it("keeps only trades denominated in the displayed currency", () => {
    const result = scopeTradesToCurrency(trades, "USD");
    expect(result.trades.map((trade) => trade.id)).toEqual(["1", "3"]);
    expect(result.excludedTradeCount).toBe(2);
  });

  it("keeps CAD trades when CAD is the selected account currency", () => {
    const result = scopeTradesToCurrency(trades, "CAD");
    expect(result.trades.map((trade) => trade.id)).toEqual(["2"]);
    expect(result.excludedTradeCount).toBe(3);
  });

  it("returns an empty sample when no trade matches the currency", () => {
    const result = scopeTradesToCurrency(trades, "GBP");
    expect(result.trades).toEqual([]);
    expect(result.excludedTradeCount).toBe(4);
  });
});
