import { describe, it, expect } from "vitest";
import {
  evaluatePropPhase,
  firmDayKey,
  type PropEngineInput,
  type PropEngineTrade,
} from "../../src/lib/prop/engine";
import type { PropPhaseRuleInput } from "../../src/lib/validations/prop-firms";

const BASE_RULE: PropPhaseRuleInput = {
  phase: "PHASE_1",
  profitTargetPercent: "10",
  maxDailyLossPercent: "5",
  maxTotalDrawdownPercent: "10",
  drawdownType: "STATIC",
  minTradingDays: 5,
  maxTradingDays: 30,
  consistencyRulePercent: null,
  newsTradingRestricted: false,
  weekendHoldingAllowed: true,
  leverage: null,
};

function trade(
  exit: Date,
  netPnl: string,
  entry?: Date,
): PropEngineTrade {
  return {
    entryTime: entry ?? new Date(exit.getTime() - 2 * 60 * 60 * 1000),
    exitTime: exit,
    netPnl,
  };
}

function input(overrides: Partial<PropEngineInput> = {}): PropEngineInput {
  return {
    phaseStartingBalance: "100000",
    rule: BASE_RULE,
    timezone: "UTC",
    resetTimeLocal: "00:00",
    trades: [],
    cashFlows: [],
    equityPoints: [],
    phaseStart: new Date("2025-01-01T00:00:00Z"),
    now: new Date("2025-01-10T12:00:00Z"),
    ...overrides,
  };
}

function ruleOf(result: ReturnType<typeof evaluatePropPhase>, id: string) {
  const found = result.rules.find((r) => r.rule === id);
  expect(found).toBeDefined();
  return found!;
}

const day = (iso: string, hour = 12) =>
  new Date(`${iso}T${String(hour).padStart(2, "0")}:00:00Z`);

// ── Daily loss ───────────────────────────────────────────────────────────────

describe("daily loss", () => {
  it("exactly at the limit breaches", () => {
    const result = evaluatePropPhase(
      input({ trades: [trade(day("2025-01-02"), "-5000")] }),
    );
    expect(ruleOf(result, "DAILY_LOSS").status).toBe("BREACH");
    expect(ruleOf(result, "DAILY_LOSS").used).toBe("5000");
    expect(ruleOf(result, "DAILY_LOSS").limit).toBe("5000");
    expect(result.phaseOutcome.outcome).toBe("FAILED");
    expect(result.phaseOutcome.failReason).toBe("MAX_DAILY_LOSS");
    expect(result.phaseOutcome.failRule).toBe("DAILY_LOSS");
    expect(result.phaseOutcome.recommendedAction).toBe("MARK_PHASE_FAILED");
  });

  it("beyond the limit breaches", () => {
    const result = evaluatePropPhase(
      input({ trades: [trade(day("2025-01-02"), "-5200")] }),
    );
    expect(ruleOf(result, "DAILY_LOSS").status).toBe("BREACH");
    expect(Number(ruleOf(result, "DAILY_LOSS").usedPercent)).toBe(104);
  });

  it("95% of the limit is IMMINENT, 75% is WARNING", () => {
    const imminent = evaluatePropPhase(
      input({ trades: [trade(day("2025-01-02"), "-4750")] }),
    );
    expect(ruleOf(imminent, "DAILY_LOSS").status).toBe("IMMINENT");
    const warning = evaluatePropPhase(
      input({ trades: [trade(day("2025-01-02"), "-3750")] }),
    );
    expect(ruleOf(warning, "DAILY_LOSS").status).toBe("WARNING");
    const ok = evaluatePropPhase(
      input({ trades: [trade(day("2025-01-02"), "-3000")] }),
    );
    expect(ruleOf(ok, "DAILY_LOSS").status).toBe("PASS");
  });

  it("is measured per firm day, not cumulatively", () => {
    const result = evaluatePropPhase(
      input({
        trades: [
          trade(day("2025-01-02"), "-4000"),
          trade(day("2025-01-03"), "-4000"),
        ],
      }),
    );
    // Worst day 4000 of 5000 = 80% WARNING, not a breach of 8000 total.
    expect(ruleOf(result, "DAILY_LOSS").status).toBe("WARNING");
    expect(ruleOf(result, "DAILY_LOSS").used).toBe("4000");
    expect(result.phaseOutcome.outcome).toBe("IN_PROGRESS");
  });

  it("a winning day consumes nothing", () => {
    const result = evaluatePropPhase(
      input({ trades: [trade(day("2025-01-02"), "1500")] }),
    );
    expect(ruleOf(result, "DAILY_LOSS").used).toBe("0");
    expect(ruleOf(result, "DAILY_LOSS").status).toBe("PASS");
  });

  it("no daily limit configured → SKIPPED", () => {
    const result = evaluatePropPhase(
      input({
        rule: { ...BASE_RULE, maxDailyLossPercent: null },
        trades: [trade(day("2025-01-02"), "-9000")],
      }),
    );
    expect(ruleOf(result, "DAILY_LOSS").status).toBe("SKIPPED");
    expect(ruleOf(result, "DAILY_LOSS").limit).toBeNull();
  });
});

// ── Global loss / drawdown ───────────────────────────────────────────────────

describe("global loss and drawdown", () => {
  it("static drawdown exactly at the limit breaches", () => {
    const result = evaluatePropPhase(
      input({
        trades: [
          trade(day("2025-01-02"), "-4000"),
          trade(day("2025-01-03"), "-4000"),
          trade(day("2025-01-04"), "-2000"),
        ],
      }),
    );
    expect(ruleOf(result, "TOTAL_DRAWDOWN").status).toBe("BREACH");
    expect(ruleOf(result, "TOTAL_DRAWDOWN").used).toBe("10000");
    expect(result.phaseOutcome.failReason).toBe("MAX_DRAWDOWN");
  });

  it("static drawdown below the limit stays OK", () => {
    const result = evaluatePropPhase(
      input({ trades: [trade(day("2025-01-02"), "-5000")] }),
    );
    expect(ruleOf(result, "TOTAL_DRAWDOWN").status).toBe("PASS");
    expect(ruleOf(result, "TOTAL_DRAWDOWN").used).toBe("5000");
  });

  it("trailing drawdown measures from the peak", () => {
    const result = evaluatePropPhase(
      input({
        rule: { ...BASE_RULE, drawdownType: "TRAILING" },
        trades: [
          trade(day("2025-01-02"), "10000"),
          trade(day("2025-01-03"), "-8000"),
        ],
      }),
    );
    // Peak 110000, now 102000 → 8000 used of 10000.
    expect(ruleOf(result, "TOTAL_DRAWDOWN").used).toBe("8000");
    expect(ruleOf(result, "TOTAL_DRAWDOWN").status).toBe("WARNING");
    expect(result.peakEquity).toBe("110000");
  });

  it("trailing drawdown at the peak is zero", () => {
    const result = evaluatePropPhase(
      input({
        rule: { ...BASE_RULE, drawdownType: "TRAILING" },
        trades: [trade(day("2025-01-02"), "10000")],
      }),
    );
    expect(ruleOf(result, "TOTAL_DRAWDOWN").used).toBe("0");
    expect(ruleOf(result, "TOTAL_DRAWDOWN").status).toBe("PASS");
  });

  it("trailing breach from the peak fails the phase", () => {
    const result = evaluatePropPhase(
      input({
        rule: { ...BASE_RULE, drawdownType: "TRAILING" },
        trades: [
          trade(day("2025-01-02"), "10000"),
          trade(day("2025-01-03"), "-10000"),
        ],
      }),
    );
    expect(ruleOf(result, "TOTAL_DRAWDOWN").status).toBe("BREACH");
    expect(result.phaseOutcome.outcome).toBe("FAILED");
  });

  it("a breach stays breached even after recovery", () => {
    const result = evaluatePropPhase(
      input({
        trades: [
          trade(day("2025-01-02"), "-11000"),
          trade(day("2025-01-03"), "11000"),
        ],
      }),
    );
    expect(ruleOf(result, "TOTAL_DRAWDOWN").status).toBe("BREACH");
    expect(result.phaseOutcome.outcome).toBe("FAILED");
  });
});

// ── Timezones and DST ────────────────────────────────────────────────────────

describe("firm day, timezones and DST", () => {
  it("reset 22:00 Europe/Paris moves 22:00 CET to the next firm day", () => {
    expect(
      firmDayKey(new Date("2025-01-06T20:59:00Z"), "Europe/Paris", "22:00").day,
    ).toBe("2025-01-06");
    expect(
      firmDayKey(new Date("2025-01-06T21:00:00Z"), "Europe/Paris", "22:00").day,
    ).toBe("2025-01-07");
    expect(
      firmDayKey(new Date("2025-01-06T23:30:00Z"), "Europe/Paris", "22:00").day,
    ).toBe("2025-01-07");
  });

  it("DST spring forward in New York keeps the midnight boundary", () => {
    // 2025-03-09 02:00 EST jumps to 03:00 EDT.
    expect(
      firmDayKey(new Date("2025-03-09T04:30:00Z"), "America/New_York", "00:00").day,
    ).toBe("2025-03-08"); // 23:30 EST Mar 8
    expect(
      firmDayKey(new Date("2025-03-09T05:30:00Z"), "America/New_York", "00:00").day,
    ).toBe("2025-03-09"); // 00:30 EST Mar 9
    expect(
      firmDayKey(new Date("2025-03-09T07:30:00Z"), "America/New_York", "00:00").day,
    ).toBe("2025-03-09"); // 03:30 EDT Mar 9
  });

  it("DST fall back in Berlin does not duplicate the day", () => {
    // 2025-10-26 03:00 CEST falls back to 02:00 CET (repeated hour).
    expect(
      firmDayKey(new Date("2025-10-25T21:30:00Z"), "Europe/Berlin", "00:00").day,
    ).toBe("2025-10-25"); // 23:30 CEST Oct 25
    expect(
      firmDayKey(new Date("2025-10-26T00:30:00Z"), "Europe/Berlin", "00:00").day,
    ).toBe("2025-10-26"); // 02:30 CEST Oct 26
    expect(
      firmDayKey(new Date("2025-10-26T01:30:00Z"), "Europe/Berlin", "00:00").day,
    ).toBe("2025-10-26"); // 02:30 CET Oct 26, second occurrence
  });

  it("daily loss splits across the firm-day boundary, not the UTC day", () => {
    const trades = [
      trade(new Date("2025-01-06T20:00:00Z"), "-3000"), // 21:00 CET Jan 6
      trade(new Date("2025-01-06T22:30:00Z"), "-3000"), // 23:30 CET Jan 6
    ];
    const paris = evaluatePropPhase(
      input({
        timezone: "Europe/Paris",
        resetTimeLocal: "22:00",
        trades,
        now: new Date("2025-01-07T12:00:00Z"),
      }),
    );
    expect(ruleOf(paris, "DAILY_LOSS").used).toBe("3000");
    expect(ruleOf(paris, "DAILY_LOSS").status).toBe("PASS");
    const utc = evaluatePropPhase(
      input({ timezone: "UTC", resetTimeLocal: "00:00", trades }),
    );
    expect(ruleOf(utc, "DAILY_LOSS").used).toBe("6000");
    expect(ruleOf(utc, "DAILY_LOSS").status).toBe("BREACH");
  });

  it("invalid timezone falls back to UTC and says so", () => {
    const result = evaluatePropPhase(
      input({ timezone: "Mars/Olympus", resetTimeLocal: "99:99" }),
    );
    expect(result.timezoneFallback).toBe(true);
    expect(result.todayDayKey).toBe("2025-01-10");
  });
});

// ── Balance vs equity ────────────────────────────────────────────────────────

describe("balance vs equity", () => {
  const dip = new Date("2025-01-03T12:00:00Z");

  it("BALANCE_BASED ignores an intraday equity dip", () => {
    const result = evaluatePropPhase(
      input({
        rule: { ...BASE_RULE, drawdownType: "BALANCE_BASED" },
        equityPoints: [{ time: dip, equity: "90000" }],
      }),
    );
    expect(ruleOf(result, "TOTAL_DRAWDOWN").used).toBe("0");
    expect(ruleOf(result, "TOTAL_DRAWDOWN").status).toBe("PASS");
    expect(result.equityData).toBe("SNAPSHOTS");
    expect(result.equityDataNote).toMatch("balance");
  });

  it("EQUITY_BASED counts the same intraday dip", () => {
    const result = evaluatePropPhase(
      input({
        rule: { ...BASE_RULE, drawdownType: "EQUITY_BASED" },
        equityPoints: [{ time: dip, equity: "90000" }],
      }),
    );
    expect(ruleOf(result, "TOTAL_DRAWDOWN").used).toBe("10000");
    expect(ruleOf(result, "TOTAL_DRAWDOWN").status).toBe("BREACH");
    expect(result.equityDataNote).toBeNull();
  });

  it("TRAILING counts an intraday dip below the peak", () => {
    const result = evaluatePropPhase(
      input({
        rule: { ...BASE_RULE, drawdownType: "TRAILING" },
        trades: [trade(day("2025-01-02"), "10000")],
        equityPoints: [{ time: dip, equity: "102000" }],
      }),
    );
    // Peak 110000 (closed) then snapshot 102000 → 8000 used.
    expect(ruleOf(result, "TOTAL_DRAWDOWN").used).toBe("8000");
    expect(ruleOf(result, "TOTAL_DRAWDOWN").status).toBe("WARNING");
  });

  it("STATIC ignores an intraday equity dip too", () => {
    const result = evaluatePropPhase(
      input({
        rule: { ...BASE_RULE, drawdownType: "STATIC" },
        equityPoints: [{ time: dip, equity: "90000" }],
      }),
    );
    expect(ruleOf(result, "TOTAL_DRAWDOWN").used).toBe("0");
    expect(ruleOf(result, "TOTAL_DRAWDOWN").status).toBe("PASS");
  });
});

// ── Deposits, withdrawals and balance operations ────────────────────────────

describe("deposits and withdrawals", () => {
  it("a deposit does not hide a drawdown", () => {
    const result = evaluatePropPhase(
      input({
        cashFlows: [{ date: day("2025-01-02", 9), amount: "20000" }],
        trades: [trade(day("2025-01-03"), "-4000")],
      }),
    );
    expect(result.currentBalance).toBe("116000");
    expect(result.currentEquity).toBe("96000");
    expect(ruleOf(result, "TOTAL_DRAWDOWN").used).toBe("4000");
    expect(ruleOf(result, "DAILY_LOSS").used).toBe("4000");
  });

  it("a withdrawal does not cause a drawdown and does not fake profit", () => {
    const result = evaluatePropPhase(
      input({
        cashFlows: [{ date: day("2025-01-02", 9), amount: "-20000" }],
        trades: [trade(day("2025-01-03"), "5000")],
      }),
    );
    expect(result.currentBalance).toBe("85000");
    expect(result.currentEquity).toBe("105000");
    expect(ruleOf(result, "TOTAL_DRAWDOWN").used).toBe("0");
    expect(ruleOf(result, "PROFIT_TARGET").used).toBe("5000");
    expect(Number(ruleOf(result, "PROFIT_TARGET").usedPercent)).toBe(50);
  });

  it("a withdrawal alone is not a trading loss", () => {
    const result = evaluatePropPhase(
      input({
        cashFlows: [{ date: day("2025-01-02", 9), amount: "-6000" }],
      }),
    );
    expect(ruleOf(result, "DAILY_LOSS").used).toBe("0");
    expect(ruleOf(result, "TOTAL_DRAWDOWN").used).toBe("0");
    expect(result.todayPnl).toBe("0");
  });
});

// ── Profit target and minimum days ───────────────────────────────────────────

describe("profit target and minimum days", () => {
  it("target reached but minimum days not met stays in progress", () => {
    const result = evaluatePropPhase(
      input({ trades: [trade(day("2025-01-02"), "12000")] }),
    );
    expect(ruleOf(result, "PROFIT_TARGET").status).toBe("PASS");
    expect(ruleOf(result, "MIN_TRADING_DAYS").status).toBe("PENDING");
    expect(result.phaseOutcome.outcome).toBe("IN_PROGRESS");
    expect(result.phaseOutcome.recommendedAction).toBe("NONE");
  });

  it("target reached exactly counts as reached", () => {
    const result = evaluatePropPhase(
      input({
        trades: [trade(day("2025-01-02"), "10000")],
        rule: { ...BASE_RULE, minTradingDays: 1 },
      }),
    );
    expect(ruleOf(result, "PROFIT_TARGET").status).toBe("PASS");
    expect(result.phaseOutcome.outcome).toBe("PASSED");
  });

  it("target reached and minimum days met passes the phase", () => {
    const trades = ["2025-01-02", "2025-01-03", "2025-01-06", "2025-01-07", "2025-01-08"].map(
      (d) => trade(day(d), "2500"),
    );
    const result = evaluatePropPhase(input({ trades }));
    expect(ruleOf(result, "PROFIT_TARGET").used).toBe("12500");
    expect(ruleOf(result, "MIN_TRADING_DAYS").status).toBe("PASS");
    expect(result.tradingDays).toBe(5);
    expect(result.phaseOutcome.outcome).toBe("PASSED");
    expect(result.phaseOutcome.recommendedAction).toBe("MARK_PHASE_PASSED");
  });

  it("no profit target configured → SKIPPED", () => {
    const result = evaluatePropPhase(
      input({ rule: { ...BASE_RULE, profitTargetPercent: "0" } }),
    );
    expect(ruleOf(result, "PROFIT_TARGET").status).toBe("SKIPPED");
    expect(ruleOf(result, "PROFIT_TARGET").limit).toBeNull();
  });
});

// ── Phase pass, fail and progression ─────────────────────────────────────────

describe("phase outcome", () => {
  it("maximum trading days exceeded without passing fails with TIME_LIMIT", () => {
    const dated = Array.from({ length: 31 }, (_, i) => {
      const date = new Date(Date.UTC(2025, 0, 1 + i, 12));
      return trade(date, "100");
    });
    const result = evaluatePropPhase(
      input({ trades: dated, now: new Date("2025-02-15T12:00:00Z") }),
    );
    expect(result.tradingDays).toBe(31);
    expect(ruleOf(result, "MAX_TRADING_DAYS").status).toBe("BREACH");
    expect(result.phaseOutcome.outcome).toBe("FAILED");
    expect(result.phaseOutcome.failReason).toBe("TIME_LIMIT");
  });

  it("no maximum days configured → SKIPPED", () => {
    const result = evaluatePropPhase(
      input({ rule: { ...BASE_RULE, maxTradingDays: null } }),
    );
    expect(ruleOf(result, "MAX_TRADING_DAYS").status).toBe("SKIPPED");
  });

  it("each phase is evaluated against its own rule", () => {
    const phase2: PropPhaseRuleInput = {
      ...BASE_RULE,
      phase: "PHASE_2",
      profitTargetPercent: "5",
      minTradingDays: 2,
    };
    const result = evaluatePropPhase(
      input({
        rule: phase2,
        trades: [trade(day("2025-01-02"), "3000"), trade(day("2025-01-03"), "3000")],
      }),
    );
    expect(ruleOf(result, "PROFIT_TARGET").limit).toBe("5000");
    expect(result.phaseOutcome.outcome).toBe("PASSED");
  });

  it("daily loss breach outranks a reached target", () => {
    const result = evaluatePropPhase(
      input({
        trades: [
          trade(day("2025-01-02"), "15000"),
          trade(day("2025-01-03"), "-5000"),
        ],
        rule: { ...BASE_RULE, minTradingDays: 1 },
      }),
    );
    // Gained 10000 = target reached, but the -5000 day breaches first.
    expect(ruleOf(result, "PROFIT_TARGET").status).toBe("PASS");
    expect(result.phaseOutcome.outcome).toBe("FAILED");
    expect(result.phaseOutcome.failReason).toBe("MAX_DAILY_LOSS");
  });
});

// ── Consistency, weekend, news, leverage ─────────────────────────────────────

describe("consistency, weekend, news and leverage", () => {
  it("best day above the consistency limit breaches", () => {
    const result = evaluatePropPhase(
      input({
        rule: { ...BASE_RULE, consistencyRulePercent: "50", minTradingDays: 1 },
        trades: [trade(day("2025-01-02"), "8000"), trade(day("2025-01-03"), "2000")],
      }),
    );
    expect(ruleOf(result, "CONSISTENCY").status).toBe("BREACH");
    expect(Number(ruleOf(result, "CONSISTENCY").used)).toBe(80);
    expect(result.phaseOutcome.failReason).toBe("RULE_VIOLATION");
  });

  it("best day below the consistency limit warns but does not breach", () => {
    const result = evaluatePropPhase(
      input({
        rule: { ...BASE_RULE, consistencyRulePercent: "90" },
        trades: [trade(day("2025-01-02"), "8000"), trade(day("2025-01-03"), "2000")],
      }),
    );
    expect(ruleOf(result, "CONSISTENCY").status).toBe("WARNING");
  });

  it("no profitable day → consistency passes", () => {
    const result = evaluatePropPhase(
      input({
        rule: { ...BASE_RULE, consistencyRulePercent: "50" },
        trades: [trade(day("2025-01-02"), "-1000")],
      }),
    );
    expect(ruleOf(result, "CONSISTENCY").status).toBe("PASS");
  });

  it("holding over a weekend breaches when forbidden", () => {
    const result = evaluatePropPhase(
      input({
        rule: { ...BASE_RULE, weekendHoldingAllowed: false },
        trades: [
          trade(
            new Date("2025-01-06T09:00:00Z"),
            "100",
            new Date("2025-01-03T20:00:00Z"),
          ),
        ],
      }),
    );
    expect(ruleOf(result, "WEEKEND_HOLDING").status).toBe("BREACH");
    expect(result.phaseOutcome.failReason).toBe("RULE_VIOLATION");
  });

  it("no weekend holding when trades stay inside the week", () => {
    const result = evaluatePropPhase(
      input({
        rule: { ...BASE_RULE, weekendHoldingAllowed: false },
        trades: [trade(day("2025-01-06"), "100")],
      }),
    );
    expect(ruleOf(result, "WEEKEND_HOLDING").status).toBe("PASS");
  });

  it("weekend holding allowed → SKIPPED", () => {
    const result = evaluatePropPhase(
      input({
        rule: { ...BASE_RULE, weekendHoldingAllowed: true },
        trades: [
          trade(
            new Date("2025-01-06T09:00:00Z"),
            "100",
            new Date("2025-01-03T20:00:00Z"),
          ),
        ],
      }),
    );
    expect(ruleOf(result, "WEEKEND_HOLDING").status).toBe("SKIPPED");
  });

  it("restricted news trading without news data is UNKNOWN, not guessed", () => {
    const result = evaluatePropPhase(
      input({ rule: { ...BASE_RULE, newsTradingRestricted: true } }),
    );
    expect(ruleOf(result, "NEWS_TRADING").status).toBe("UNKNOWN");
    expect(ruleOf(result, "NEWS_TRADING").detail).toMatch("not available");
  });

  it("leverage without per-trade data is UNKNOWN, not guessed", () => {
    const result = evaluatePropPhase(
      input({ rule: { ...BASE_RULE, leverage: "30" } }),
    );
    expect(ruleOf(result, "LEVERAGE").status).toBe("UNKNOWN");
    expect(ruleOf(result, "LEVERAGE").detail).toMatch("not recorded");
  });

  it("news and leverage unconfigured → SKIPPED", () => {
    const result = evaluatePropPhase(input());
    expect(ruleOf(result, "NEWS_TRADING").status).toBe("SKIPPED");
    expect(ruleOf(result, "LEVERAGE").status).toBe("SKIPPED");
  });
});

// ── Missing data ─────────────────────────────────────────────────────────────

describe("missing data", () => {
  it("no trades → honest empty states, no invented values", () => {
    const result = evaluatePropPhase(input());
    expect(ruleOf(result, "DAILY_LOSS").used).toBe("0");
    expect(ruleOf(result, "TOTAL_DRAWDOWN").used).toBe("0");
    expect(ruleOf(result, "PROFIT_TARGET").used).toBe("0");
    expect(ruleOf(result, "MIN_TRADING_DAYS").status).toBe("PENDING");
    expect(result.tradingDays).toBe(0);
    expect(result.equityData).toBe("CLOSED_ONLY");
    expect(result.equityDataNote).toMatch("No equity snapshots");
    expect(result.phaseOutcome.outcome).toBe("IN_PROGRESS");
    expect(result.days.length).toBeGreaterThan(0);
    expect(result.days[0].day).toBe("2025-01-01");
    expect(result.days.at(-1)!.day).toBe("2025-01-10");
  });

  it("an open trade without snapshots does not move equity", () => {
    const result = evaluatePropPhase(
      input({
        trades: [
          {
            entryTime: day("2025-01-09"),
            exitTime: null,
            netPnl: null,
          },
        ],
      }),
    );
    expect(result.currentEquity).toBe("100000");
    expect(result.equityData).toBe("CLOSED_ONLY");
    expect(result.tradingDays).toBe(1);
  });

  it("day history lists every firm day with its equity", () => {
    const result = evaluatePropPhase(
      input({ trades: [trade(day("2025-01-03"), "2000")] }),
    );
    const jan3 = result.days.find((d) => d.day === "2025-01-03");
    expect(jan3).toBeDefined();
    expect(jan3!.netPnl).toBe("2000");
    expect(jan3!.equity).toBe("102000");
    expect(jan3!.isTradingDay).toBe(true);
    const jan4 = result.days.find((d) => d.day === "2025-01-04");
    expect(jan4!.isTradingDay).toBe(false);
    expect(jan4!.equity).toBe("102000");
  });
});
