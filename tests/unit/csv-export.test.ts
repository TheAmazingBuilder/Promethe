import { describe, expect, it } from "vitest";
import { tradesToCsv } from "@/lib/trading/csv-export";
import type { TradeListItemDTO } from "@/lib/trading/dto";

function trade(overrides: Partial<TradeListItemDTO> = {}): TradeListItemDTO {
  return {
    id: "trade-1",
    accountId: "account-1",
    accountName: "Primary",
    strategyId: null,
    strategyName: null,
    instrumentId: "instrument-1",
    symbol: "XAUUSD",
    digits: 2,
    direction: "LONG",
    orderType: "MARKET",
    status: "CLOSED",
    timeframe: null,
    session: null,
    setupType: null,
    setupId: null,
    strategyVersion: null,
    entryTime: "2026-11-20T10:00:00.000Z",
    exitTime: null,
    entryPrice: "2345.00",
    exitPrice: null,
    stopLoss: null,
    takeProfit: null,
    lots: "0.10",
    riskPercent: null,
    pips: null,
    netPnl: "-125.50",
    pnlCurrency: "USD",
    rMultiple: null,
    plannedRR: null,
    resultType: "LOSS",
    exitReason: null,
    reviewStatus: "NOT_REVIEWED",
    isDraft: false,
    emotionBefore: null,
    followedPlan: null,
    grade: null,
    createdAt: "2026-11-20T10:00:00.000Z",
    updatedAt: "2026-11-20T10:00:00.000Z",
    tags: [],
    customFields: null,
    currentPrice: null,
    ...overrides,
  };
}

describe("tradesToCsv spreadsheet formula protection", () => {
  it("prefixes formula-like text, including after leading whitespace/control characters", () => {
    const csv = tradesToCsv([
      trade({
        symbol: "=1+1",
        accountName: "+SUM(1,2)",
        strategyName: "@SUM(1,2)",
        session: "\t=HYPERLINK(\"https://example.invalid\")",
        exitReason: "\r\n=1+1",
        emotionBefore: " -cmd|payload",
      }),
    ]);

    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'+SUM(1,2)");
    expect(csv).toContain("'@SUM(1,2)");
    expect(csv).toContain("'\t=HYPERLINK");
    expect(csv).toContain("'\r\n=1+1");
    expect(csv).toContain("' -cmd|payload");
  });

  it("preserves valid negative numeric values as numbers", () => {
    const csv = tradesToCsv([trade({ netPnl: "-125.50", lots: "-0.10" })]);
    expect(csv).toContain("-125.50");
    expect(csv).toContain("-0.10");
    expect(csv).not.toContain("'-125.50");
    expect(csv).not.toContain("'-0.10");
  });

  it("neutralizes formula payloads even in fields designated numeric", () => {
    const csv = tradesToCsv([trade({ netPnl: "-1+cmd", lots: "=1+1" })]);
    expect(csv).toContain("'-1+cmd");
    expect(csv).toContain("'=1+1");
  });

  it("keeps RFC 4180 quote escaping after neutralization", () => {
    const csv = tradesToCsv([trade({ symbol: '=HYPERLINK("https://example.invalid","open")' })]);
    expect(csv).toContain('"'=HYPERLINK(""https://example.invalid"",""open"")"');
  });
});
