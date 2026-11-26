/**
 * v3 Phase 1 — Redaction engine leak tests (v3 §4.4).
 *
 * The contract: serialize the FULL redacted payload and assert that no
 * forbidden key or value appears anywhere — for trades, executions,
 * screenshots and equity curves. Hidden fields must be structurally ABSENT.
 */
import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_EXPORT_PRESET,
  NO_REDACTION,
  PIPS_R_ONLY_PRESET,
  assertNoHiddenKeys,
  findLeaks,
  parseRedactionPolicy,
  redactEquityCurve,
  redactStats,
  redactTrade,
  tradeLeakProbes,
} from "@/lib/redaction";

const TRADE = {
  id: "trade_1",
  userId: "user_A",
  accountId: "acct_123",
  accountName: "FTMO Challenge 100K",
  accountCurrency: "USD",
  accountInitialBalance: "100000",
  broker: "Deriv",
  strategyId: "strat_9",
  strategyName: "London Open Gold",
  symbol: "XAUUSD",
  direction: "LONG",
  status: "CLOSED",
  entryTime: "2025-01-15T08:32:00.000Z",
  exitTime: "2025-01-15T11:05:00.000Z",
  entryPrice: "2650.50",
  exitPrice: "2655.80",
  lots: "0.73",
  riskAmount: "257.31",
  netPnl: "263.91",
  grossPnl: "263.91",
  commission: "2.47",
  swap: "0",
  fees: "0",
  pnlCurrency: "USD",
  pips: "53",
  rMultiple: "1.06",
  plannedRR: "2",
  notes: "Perfect A+ setup at the London open",
  preTradeAnalysis: "Wait for the sweep of Asian high",
  postTradeReview: "Managed well, moved SL to BE",
  lessonLearned: "Patience pays",
  notesTag: "gold",
  review: { id: "review_1", planAdherenceScore: 4, mainLesson: "Wait for confirmation", whatWentWell: "Respected the stop", whatToImprove: "Avoid early entries" },
  screenshots: [
    {
      id: "shot_1",
      tradeId: "trade_1",
      userId: "user_A",
      storagePath: "uploads/user_A/shot_1.webp",
      label: "ENTRY",
      caption: "Entry with confirmation",
      url: "/api/v1/uploads/shot_1",
    },
  ],
  executions: [
    { id: "ex_1", type: "ENTRY", time: "2025-01-15T08:32:00.000Z", price: "2650.50", lots: "0.73", commission: "2.47", pnl: null },
    { id: "ex_2", type: "FINAL_EXIT", time: "2025-01-15T11:05:00.000Z", price: "2655.80", lots: "0.73", commission: "0", pnl: "263.91" },
  ],
};

describe("redactTrade — Pips & R only preset", () => {
  const { trade } = redactTrade(TRADE, PIPS_R_ONLY_PRESET);

  it("keeps pips, R, prices, symbol and direction", () => {
    expect(trade.pips).toBe("53");
    expect(trade.rMultiple).toBe("1.06");
    expect(trade.symbol).toBe("XAUUSD");
    expect(trade.direction).toBe("LONG");
    expect(trade.entryPrice).toBe("2650.50");
  });

  it("structurally removes amounts (keys absent, not null)", () => {
    for (const key of ["netPnl", "grossPnl", "commission", "swap", "fees", "riskAmount", "lots", "pnlCurrency", "accountInitialBalance"]) {
      expect(trade).not.toHaveProperty(key);
    }
  });

  it("removes account info and screenshots", () => {
    for (const key of ["accountId", "accountName", "accountCurrency", "broker"]) {
      expect(trade).not.toHaveProperty(key);
    }
    expect(trade).not.toHaveProperty("screenshots");
  });

  it("removes money from executions too", () => {
    const executions = trade.executions as Record<string, unknown>[];
    for (const execution of executions) {
      expect(execution).not.toHaveProperty("commission");
      expect(execution).not.toHaveProperty("pnl");
      expect(execution).not.toHaveProperty("lots");
    }
  });

  it("LEAK TEST: serialized payload contains no forbidden value anywhere", () => {
    const probes = [
      ...tradeLeakProbes(TRADE, PIPS_R_ONLY_PRESET),
      "FTMO Challenge 100K",
      "100000",
      "263.91",
      "257.31",
      "0.73",
      "Deriv",
      "acct_123",
      "user_A",
      "uploads/user_A",
    ];
    const serialized = JSON.stringify(trade);
    for (const probe of probes) {
      if (typeof probe === "string" && probe.length < 2) continue;
      expect(serialized).not.toContain(probe);
    }
    expect(findLeaks(trade, probes)).toEqual([]);
  });

  it("never mutates the input payload", () => {
    expect(TRADE).toHaveProperty("netPnl");
    expect(TRADE).toHaveProperty("accountName");
    expect(TRADE.screenshots).toHaveLength(1);
  });
});

describe("redactTrade — full anonymous export", () => {
  const { trade } = redactTrade(TRADE, ANONYMOUS_EXPORT_PRESET);

  it("hides notes and truncates times to dates", () => {
    expect(trade).not.toHaveProperty("notes");
    expect(trade).not.toHaveProperty("preTradeAnalysis");
    expect(trade.entryTime).toBe("2025-01-15");
    expect(trade.exitTime).toBe("2025-01-15");
    const executions = trade.executions as Record<string, unknown>[];
    expect(executions[0].time).toBe("2025-01-15");
  });

  it("removes free-text review notes when note redaction is enabled", () => {
    const { trade } = redactTrade(TRADE, { ...NO_REDACTION, hideNotes: true });
    expect(trade.review).toEqual({ id: "review_1", planAdherenceScore: 4 });
  });

  it("keeps strategy name (allowed by the preset)", () => {
    expect(trade.strategyName).toBe("London Open Gold");
  });
});

describe("redactTrade - hidePsychology", () => {
  it("removes psychology fields but keeps notes", () => {
    const { trade } = redactTrade(TRADE, { ...NO_REDACTION, hidePsychology: true });
    for (const key of ["emotionBefore", "confidence", "followedPlan", "checklistResults", "setupQualityRating"]) {
      expect(trade).not.toHaveProperty(key);
    }
    expect(trade.notes).toBe("Perfect A+ setup at the London open");
    expect(trade).not.toHaveProperty("review");
  });
});

describe("redactTrade — no redaction keeps everything except internal ids", () => {
  it("keeps amounts and strips only internal identifiers", () => {
    const { trade, redacted } = redactTrade(TRADE, NO_REDACTION);
    expect(redacted).toBe(false);
    expect(trade.netPnl).toBe("263.91");
    expect(trade).not.toHaveProperty("userId");
    const screenshots = trade.screenshots as Record<string, unknown>[];
    expect(screenshots[0]).not.toHaveProperty("storagePath");
    expect(screenshots[0]).not.toHaveProperty("userId");
  });
});

describe("redactEquityCurve", () => {
  const points = [
    { time: "2025-01-01T00:00:00.000Z", value: 10000 },
    { time: "2025-01-02T00:00:00.000Z", value: 10250 },
    { time: "2025-01-03T00:00:00.000Z", value: 10100 },
  ];

  it("normalizes to percent when amounts hidden", () => {
    const { points: out, unit } = redactEquityCurve(points, { ...NO_REDACTION, hideAmounts: true });
    expect(unit).toBe("PERCENT");
    expect(out[0].value).toBe(0);
    expect(out[1].value).toBe(2.5);
    expect(out[2].value).toBe(1);
    expect(JSON.stringify(out)).not.toContain("10000");
  });

  it("normalizes to cumulative R with risks", () => {
    const { points: out, unit } = redactEquityCurve(
      points,
      { ...NO_REDACTION, hideAmounts: true },
      "R_CUMULATIVE",
      [0, 1, -0.5]
    );
    expect(unit).toBe("R");
    expect(out.map((p) => p.value)).toEqual([0, 1, 0.5]);
  });

  it("passes currency values through when amounts visible", () => {
    const { points: out, unit } = redactEquityCurve(points, NO_REDACTION);
    expect(unit).toBe("CURRENCY");
    expect(out[0].value).toBe(10000);
  });
});

describe("redactStats", () => {
  it("strips monetary stats, keeps ratios", () => {
    const stats = {
      netPnl: "1250.50",
      avgWin: "180.20",
      winRate: 0.62,
      profitFactor: 1.8,
      expectancyR: "0.34",
      maxDrawdownAmount: "400",
      maxDrawdownPercent: 4.2,
      trades: 42,
    };
    const out = redactStats(stats, { ...NO_REDACTION, hideAmounts: true });
    expect(out).not.toHaveProperty("netPnl");
    expect(out).not.toHaveProperty("avgWin");
    expect(out).not.toHaveProperty("maxDrawdownAmount");
    expect(out.winRate).toBe(0.62);
    expect(out.profitFactor).toBe(1.8);
    expect(out.expectancyR).toBe("0.34");
    expect(out.maxDrawdownPercent).toBe(4.2);
    expect(JSON.stringify(out)).not.toContain("1250.50");
  });

  it("strips the full v3 TradeStats monetary set (grossWin, maxDrawdown, initialBalance…)", () => {
    const stats = {
      tradeCount: 10,
      wins: 6,
      losses: 4,
      winRate: "60",
      netPnl: "610.75",
      grossWin: "900.00",
      grossLoss: "289.25",
      avgWin: "150.00",
      avgLoss: "72.31",
      maxWin: "610.75",
      maxLoss: "-120.00",
      profitFactor: "3.11",
      avgR: "0.55",
      expectancyR: "0.55",
      totalR: "5.5",
      maxDrawdown: "150.00",
      maxDrawdownPercent: "2.5",
      maxWinStreak: 3,
      maxLossStreak: 2,
      currentStreak: 2,
      tradingDays: 8,
      initialBalance: "10000",
      balance: "10610.75",
      equity: "10610.75",
    };
    const out = redactStats(stats, { ...NO_REDACTION, hideAmounts: true });
    for (const key of [
      "netPnl", "grossWin", "grossLoss", "avgWin", "avgLoss", "maxWin",
      "maxLoss", "maxDrawdown", "initialBalance", "balance", "equity",
    ]) {
      expect(out).not.toHaveProperty(key);
    }
    // Ratios and counts survive.
    expect(out.winRate).toBe("60");
    expect(out.profitFactor).toBe("3.11");
    expect(out.totalR).toBe("5.5");
    expect(out.maxDrawdownPercent).toBe("2.5");
    expect(out.tradeCount).toBe(10);
    expect(out.maxWinStreak).toBe(3);
    const leaks = findLeaks(out, [610.75, "900.00", "289.25", 10000, "10610.75"]);
    expect(leaks).toEqual([]);
  });
});

describe("findLeaks", () => {
  it("detects leaks in nested structures and array items", () => {
    const payload = { a: { b: [{ c: "secret FTMO account" }] }, d: 12345 };
    expect(findLeaks(payload, ["FTMO"])).toHaveLength(1);
    expect(findLeaks(payload, [12345])).toHaveLength(1);
    expect(findLeaks(payload, ["nothing"])).toHaveLength(0);
  });

  it("does not mistake fractional seconds in ISO timestamps for money", () => {
    expect(findLeaks({ capturedAt: "2026-11-23T15:56:50.000Z" }, ["50.00"])).toEqual([]);
    expect(findLeaks({ amount: "50.00" }, ["50.00"])).toHaveLength(1);
  });
  it("detects leaks via key names", () => {
    const payload = { accountNumber: "hidden" };
    expect(findLeaks(payload, ["accountNumber"])).toHaveLength(1);
  });
});

describe("parseRedactionPolicy", () => {
  it("round-trips a stored policy and defaults on garbage", () => {
    const policy = { ...PIPS_R_ONLY_PRESET, hideNotes: true };
    const parsed = parseRedactionPolicy(JSON.stringify(policy));
    expect(parsed).toEqual(policy);
    expect(parseRedactionPolicy("not json")).toEqual(NO_REDACTION);
    expect(parseRedactionPolicy(null)).toEqual(NO_REDACTION);
  });
});

describe("runtime key-based guard (assertNoHiddenKeys)", () => {
  it("accepte un payload propre (pas de faux positif numérique)", () => {
    // Régression v3 Phase 4 : R visible « 0.5 » vs lots masqués « 0.5 » —
    // l'ancien scan par valeur signalait une fuite à tort.
    const trade = {
      symbol: "XAUUSD",
      entryPrice: "2650.50",
      rMultiple: "0.5",
      pips: "5",
    };
    expect(() => assertNoHiddenKeys(trade, PIPS_R_ONLY_PRESET)).not.toThrow();
  });

  it("refuse un payload qui contient une clé masquée (imbriquée)", () => {
    const payload = {
      symbol: "XAUUSD",
      executions: [{ price: "2650", commission: "1.20" }],
    };
    expect(() => assertNoHiddenKeys(payload, PIPS_R_ONLY_PRESET)).toThrow(
      /commission/
    );
  });

  it("refuse screenshots quand hideScreenshots", () => {
    const payload = { symbol: "XAUUSD", screenshots: [] };
    expect(() => assertNoHiddenKeys(payload, PIPS_R_ONLY_PRESET)).toThrow(
      /screenshots/
    );
  });

  it(" laisse passer quand la politique ne masque rien", () => {
    const payload = { netPnl: "10", lots: "0.5", screenshots: [1] };
    expect(() => assertNoHiddenKeys(payload, NO_REDACTION)).not.toThrow();
  });
});

describe("tradeLeakProbes — sondes numériques strictes", () => {
  it("convertit les valeurs numériques en sondes nombre (égalité stricte)", () => {
    const trade = { accountName: "Compte FTMO", netPnl: "610.75", lots: "0.5" };
    const probes = tradeLeakProbes(trade, { ...NO_REDACTION, hideAmounts: true, hideAccountInfo: true });
    expect(probes).toContain(610.75);
    expect(probes).toContain(0.5);
    expect(probes).toContain("Compte FTMO");
    // Un prix « 2650.50 » contenant « 0.5 » n'est PAS une fuite.
    expect(findLeaks({ entryPrice: "2650.50" }, probes)).toEqual([]);
    // La valeur exacte l'est.
    expect(findLeaks({ secret: "610.75" }, probes)).toHaveLength(1);
    expect(findLeaks({ secret: "610.750" }, probes)).toHaveLength(1);
  });
});

describe("redactTrade - Lot 14 Sharing: unbounded user content", () => {
  const RICH_TRADE = {
    ...TRADE,
    // Arbitrary user-defined custom fields (JSONB) - unbounded content.
    customFields: {
      brokerLogin: "trader-007-secret",
      accountNumber: "ACC-998877",
      session: "London",
    },
    tradingViewUrl: "https://www.tradingview.com/chart/xyz/user-secret-name/",
    checklistStatus: {
      requiredTotal: 3,
      requiredChecked: 1,
      missing: ["Wait for London sweep", "Confirm HTF bias"],
      complete: false,
    },
    review: {
      ...(TRADE.review as Record<string, unknown>),
      customAnswers: [
        { questionId: "q1", question: "What did you feel?", type: "TEXT", answer: "Felt rushed after the news - note secrete-99" },
        { questionId: "q2", question: "Score it", type: "SCALE", answer: 4 },
      ],
    },
  };

  it("strips custom fields as soon as ANY hiding is requested", () => {
    const { trade } = redactTrade(RICH_TRADE, PIPS_R_ONLY_PRESET);
    expect(trade).not.toHaveProperty("customFields");
    const serialized = JSON.stringify(trade);
    expect(serialized).not.toContain("trader-007-secret");
    expect(serialized).not.toContain("ACC-998877");
  });

  it("keeps custom fields only on an explicit full share (no redaction)", () => {
    const { trade } = redactTrade(RICH_TRADE, NO_REDACTION);
    expect(trade.customFields).toEqual(RICH_TRADE.customFields);
  });

  it("strips free-text review answers when notes are hidden", () => {
    const { trade } = redactTrade(RICH_TRADE, { ...NO_REDACTION, hideNotes: true });
    const review = trade.review as Record<string, unknown>;
    expect(review).not.toHaveProperty("customAnswers");
    expect(JSON.stringify(trade)).not.toContain("note secrete-99");
    // Scores survive (not free text).
    expect(review.planAdherenceScore).toBe(4);
  });

  it("strips the checklist verdict when psychology is hidden", () => {
    const { trade } = redactTrade(RICH_TRADE, { ...NO_REDACTION, hidePsychology: true });
    expect(trade).not.toHaveProperty("checklistStatus");
    expect(JSON.stringify(trade)).not.toContain("Wait for London sweep");
  });

  it("strips the checklist verdict when the strategy name is hidden", () => {
    const { trade } = redactTrade(RICH_TRADE, { ...NO_REDACTION, hideStrategyName: true });
    expect(trade).not.toHaveProperty("checklistStatus");
    expect(trade).not.toHaveProperty("strategyName");
  });

  it("strips the TradingView URL when account info is hidden", () => {
    const { trade } = redactTrade(RICH_TRADE, { ...NO_REDACTION, hideAccountInfo: true });
    expect(trade).not.toHaveProperty("tradingViewUrl");
    expect(JSON.stringify(trade)).not.toContain("user-secret-name");
  });
});
