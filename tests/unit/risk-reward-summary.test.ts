import { describe, expect, it } from "vitest";
import { computeRiskRewardStats, type RiskRewardTradeLike } from "@/lib/tools/risk-reward";

function trade(
  patch: Partial<RiskRewardTradeLike> & Pick<RiskRewardTradeLike, "pnlCurrency" | "netPnl">
): RiskRewardTradeLike {
  return {
    pnlCurrency: patch.pnlCurrency,
    netPnl: patch.netPnl,
    rMultiple: null,
    realizedRR: null,
    plannedRR: null,
    resultType: null,
    exitTime: new Date("2026-11-24T15:00:00.000Z"),
    ...patch,
  };
}

describe("computeRiskRewardStats", () => {
  it("scopes money to one currency and excludes breakevens from win rate", () => {
    const trades = [
      trade({ pnlCurrency: "USD", netPnl: "100", resultType: "WIN", rMultiple: "1", realizedRR: "2", plannedRR: "2.5" }),
      trade({ pnlCurrency: "USD", netPnl: "5", resultType: "BREAKEVEN", plannedRR: "1" }),
      trade({ pnlCurrency: "USD", netPnl: "-50", resultType: "LOSS", rMultiple: "-1", realizedRR: "1", plannedRR: "1.5" }),
      trade({ pnlCurrency: "EUR", netPnl: "-200", resultType: "LOSS" }),
    ];

    const result = computeRiskRewardStats(
      trades,
      "USD",
      "2026-11-24",
      (date) => date.toISOString().slice(0, 10)
    );

    expect(result.realStats.closedTrades).toBe(3);
    expect(result.realStats.wins).toBe(1);
    expect(result.realStats.losses).toBe(1);
    expect(result.realStats.breakevens).toBe(1);
    expect(result.realStats.winRate).toBe("0.5");
    expect(result.realStats.avgWin).toBe("52.5");
    expect(result.realStats.avgLoss).toBe("50");
    expect(result.realStats.expectancyMoney).toBe("18.33333333333333333333333333");
    expect(result.realStats.expectancyR).toBe("0");
    expect(result.realStats.avgRealizedRR).toBe("1.5");
    expect(result.realStats.avgPlannedRR).toBe("1.666666666666666666666666667");
    expect(result.excludedTradeCount).toBe(1);
    expect(result.realizedLossToday).toBe("50");
    expect(result.realizedPnlToday).toBe("55");
  });

  it("returns null ratios when there are no trades in the selected currency", () => {
    const result = computeRiskRewardStats(
      [trade({ pnlCurrency: "EUR", netPnl: "25", resultType: "WIN" })],
      "USD",
      "2026-11-24",
      (date) => date.toISOString().slice(0, 10)
    );

    expect(result.realStats.closedTrades).toBe(0);
    expect(result.realStats.winRate).toBeNull();
    expect(result.realStats.expectancyMoney).toBeNull();
    expect(result.excludedTradeCount).toBe(1);
    expect(result.realizedPnlToday).toBe("0");
  });
});
