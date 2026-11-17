/**
 * v2.5 Module 8 — trading-day wiring tests (§3.4).
 *
 * The trading-day definition (MIDNIGHT_LOCAL / NEW_YORK_CLOSE / CUSTOM)
 * must flow from the user setting into every day-bucketed output:
 *  - analytics engine (tradingDays, dailyPnl),
 *  - dashboard period resolution ("today" preset),
 *  - goal windows and goal progress.
 *
 * Default (no options / no settings) is the historical behaviour: the UTC
 * calendar date of the exit for the engine, the local calendar day for
 * periods and goals.
 */
import { describe, expect, it } from "vitest";
import {
  computeTradeStats,
  dailyPnl,
  type StatTrade,
} from "@/lib/analytics/engine";
import { tradingDayOfTrade } from "@/lib/time/trading-day";
import { resolvePeriod } from "@/lib/dashboard/period";
import {
  computeGoalProgress,
  goalWindow,
  type GoalDef,
} from "@/lib/trading/goals";

/** Two trades around the 17:00 New York close (EDT, UTC-4, March 2024). */
function nyCloseTrades(): StatTrade[] {
  const base = {
    entryTime: "2024-03-14T20:00:00.000Z",
    rMultiple: "1.5",
    resultType: "WIN",
    strategyId: null,
    instrumentId: "xauusd",
    symbol: "XAUUSD",
    direction: "LONG",
    session: null,
    lots: "0.1",
  };
  return [
    {
      ...base,
      id: "a",
      // 17:30 New York on Mar 14 -> trading day Mar 15 (NY close).
      exitTime: "2024-03-14T22:30:00.000Z",
      netPnl: "100",
    },
    {
      ...base,
      id: "b",
      // 21:00 New York on Mar 14 -> trading day Mar 15 (NY close).
      exitTime: "2024-03-15T02:00:00.000Z",
      netPnl: "-40",
    },
  ];
}

describe("computeTradeStats / dailyPnl — trading-day attribution", () => {
  it("defaults to the UTC exit date (historical behaviour)", () => {
    const trades = nyCloseTrades();
    expect(computeTradeStats(trades).tradingDays).toBe(2);
    expect(dailyPnl(trades).map((d) => d.date)).toEqual([
      "2024-03-14",
      "2024-03-15",
    ]);
  });

  it("counts ONE trading day under NEW_YORK_CLOSE", () => {
    const trades = nyCloseTrades();
    const dayOf = tradingDayOfTrade("America/Toronto", {
      mode: "NEW_YORK_CLOSE",
    });
    expect(computeTradeStats(trades, { dayOf }).tradingDays).toBe(1);
    expect(dailyPnl(trades, { dayOf })).toEqual([
      { date: "2024-03-15", netPnl: "60", count: 2 },
    ]);
  });

  it("uses the local calendar day under MIDNIGHT_LOCAL (Toronto)", () => {
    const trades = nyCloseTrades();
    const dayOf = tradingDayOfTrade("America/Toronto", {
      mode: "MIDNIGHT_LOCAL",
    });
    // 22:30Z = 18:30 EDT Mar 14, 02:00Z = 22:00 EDT Mar 14.
    expect(computeTradeStats(trades, { dayOf }).tradingDays).toBe(1);
    expect(dailyPnl(trades, { dayOf })).toEqual([
      { date: "2024-03-14", netPnl: "60", count: 2 },
    ]);
  });

  it("honours a CUSTOM rollover (06:00 Europe/Paris)", () => {
    const trades: StatTrade[] = [
      {
        id: "c",
        entryTime: "2024-03-14T03:00:00.000Z",
        // 05:30 Paris on Mar 14 (before the 06:00 rollover) -> trading day
        // Mar 14 (the day ending at 06:00 Mar 14).
        exitTime: "2024-03-14T04:30:00.000Z",
        netPnl: "10",
        rMultiple: null,
        resultType: "WIN",
        strategyId: null,
        instrumentId: "eurusd",
        symbol: "EURUSD",
        direction: "LONG",
        session: null,
        lots: "0.1",
      },
      {
        id: "d",
        entryTime: "2024-03-14T05:00:00.000Z",
        // 06:30 Paris on Mar 14 (after the rollover) -> trading day Mar 15
        // (the day ending at 06:00 Mar 15).
        exitTime: "2024-03-14T05:30:00.000Z",
        netPnl: "20",
        rMultiple: null,
        resultType: "WIN",
        strategyId: null,
        instrumentId: "eurusd",
        symbol: "EURUSD",
        direction: "LONG",
        session: null,
        lots: "0.1",
      },
    ];
    const dayOf = tradingDayOfTrade("Europe/Paris", {
      mode: "CUSTOM",
      rolloverTime: "06:00",
      rolloverTimezone: "Europe/Paris",
    });
    // Convention (trading-day.ts): the trading-day key is the day the day
    // ENDS at the rollover — 05:30 Paris belongs to the day ending 06:00
    // Mar 14, 06:30 Paris to the day ending 06:00 Mar 15.
    expect(dailyPnl(trades, { dayOf }).map((d) => d.date)).toEqual([
      "2024-03-14",
      "2024-03-15",
    ]);
  });
});

describe("resolvePeriod — 'today' follows the trading day", () => {
  const now = new Date("2024-03-14T22:30:00.000Z"); // 18:30 EDT Mar 14
  const global = { preset: "today" as const, accountId: null };

  it("defaults to local midnight (Toronto)", () => {
    const period = resolvePeriod(global, null, "America/Toronto", now);
    expect(period.from).toBe("2024-03-14T04:00:00.000Z");
  });

  it("starts at the New York close under NEW_YORK_CLOSE", () => {
    const period = resolvePeriod(global, null, "America/Toronto", now, {
      mode: "NEW_YORK_CLOSE",
    });
    // Trading day Mar 15 starts at 17:00 EDT Mar 14 = 21:00 UTC.
    expect(period.from).toBe("2024-03-14T21:00:00.000Z");
  });
});

describe("goalWindow / computeGoalProgress — trading-day attribution", () => {
  // Sunday 2024-03-17 21:00 New York = Monday 2024-03-18 01:00 UTC.
  const now = new Date("2024-03-18T01:00:00.000Z");
  const weekly: Pick<GoalDef, "period" | "startDate" | "endDate"> = {
    period: "WEEKLY",
    startDate: "2024-01-01",
    endDate: null,
  };

  it("anchors the week on the local day by default", () => {
    const w = goalWindow(weekly, now, "America/Toronto");
    expect(w.today).toBe("2024-03-17");
    expect(w.startDay).toBe("2024-03-11"); // Monday of the Mar 11 week
  });

  it("anchors the week on the trading day under NEW_YORK_CLOSE", () => {
    const w = goalWindow(weekly, now, "America/Toronto", {
      mode: "NEW_YORK_CLOSE",
    });
    expect(w.today).toBe("2024-03-18");
    expect(w.startDay).toBe("2024-03-18"); // new week already started
  });

  it("attributes the Sunday-evening trade to the new week under NY close", () => {
    const def: GoalDef = {
      id: "g",
      name: "Trades / week",
      metric: "TRADE_COUNT",
      targetValue: "3",
      period: "WEEKLY",
      startDate: "2024-01-01",
      endDate: null,
    };
    const trades = [
      {
        exitIso: "2024-03-18T01:00:00.000Z",
        netPnl: "50",
        rMultiple: null,
      },
    ];
    const local = computeGoalProgress(def, trades, [], now, "America/Toronto");
    expect(local.currentValue).toBe("1");
    // Under NY close the same instant is already the Mar 18 trading day,
    // so the window is the new week and the trade still counts — but a
    // trade from the previous week would NOT leak into this one.
    const nyClose = computeGoalProgress(
      def,
      trades,
      [],
      now,
      "America/Toronto",
      { mode: "NEW_YORK_CLOSE" }
    );
    expect(nyClose.currentValue).toBe("1");
    expect(nyClose.windowStartDay).toBe("2024-03-18");
    expect(local.windowStartDay).toBe("2024-03-11");
  });
});
