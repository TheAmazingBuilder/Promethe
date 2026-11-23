import { describe, expect, it } from "vitest";
import { scopeTradesToCurrency } from "@/lib/analytics/currency-scope";

describe("scopeTradesToCurrency", () => {
  const accounts = [
    { id: "usd-a", currency: "USD" },
    { id: "usd-b", currency: "USD" },
    { id: "cad-a", currency: "CAD" },
  ];
  const trades = [
    { id: "1", accountId: "usd-a" },
    { id: "2", accountId: "cad-a" },
    { id: "3", accountId: "usd-b" },
    { id: "4", accountId: "missing-account" },
  ];

  it("keeps only trades denominated in the displayed currency", () => {
    const result = scopeTradesToCurrency(trades, accounts, "USD");
    expect(result.trades.map((trade) => trade.id)).toEqual(["1", "3"]);
    expect(result.excludedTradeCount).toBe(2);
  });

  it("keeps CAD trades when CAD is the selected account currency", () => {
    const result = scopeTradesToCurrency(trades, accounts, "CAD");
    expect(result.trades.map((trade) => trade.id)).toEqual(["2"]);
    expect(result.excludedTradeCount).toBe(3);
  });

  it("returns an empty sample when no account matches the currency", () => {
    const result = scopeTradesToCurrency(trades, accounts, "EUR");
    expect(result.trades).toEqual([]);
    expect(result.excludedTradeCount).toBe(4);
  });
});
