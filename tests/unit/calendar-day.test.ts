/**
 * Unit tests — calendar day detail (MRT wave 2).
 * Pure logic only: the day totals shared by the day endpoint
 * (src/server/calendar.ts) and the query validation for
 * GET /api/v1/calendar/day. No DOM, no network, no database.
 */
import { describe, expect, it } from "vitest";
import { summarizeDayTrades } from "@/lib/analytics/calendar";
import { calendarDayQuerySchema } from "@/lib/validations/journal";

describe("summarizeDayTrades", () => {
  it("sums P&L and R, counts wins and losses", () => {
    const s = summarizeDayTrades([
      { netPnl: "120.5", rMultiple: "1.5", resultType: "WIN" },
      { netPnl: "-40", rMultiple: "-1", resultType: "LOSS" },
      { netPnl: "0", rMultiple: "0", resultType: "BREAKEVEN" },
    ]);
    expect(s.netPnl).toBe("80.5");
    expect(s.tradeCount).toBe(3);
    expect(s.wins).toBe(1);
    expect(s.losses).toBe(1);
    expect(s.totalR).toBe("0.5");
  });

  it("returns zero totals and null R for a day without trades", () => {
    const s = summarizeDayTrades([]);
    expect(s.netPnl).toBe("0");
    expect(s.tradeCount).toBe(0);
    expect(s.wins).toBe(0);
    expect(s.losses).toBe(0);
    expect(s.totalR).toBeNull();
  });

  it("returns null R when no trade has an R multiple", () => {
    const s = summarizeDayTrades([
      { netPnl: "10", rMultiple: null, resultType: "WIN" },
    ]);
    expect(s.totalR).toBeNull();
    expect(s.netPnl).toBe("10");
  });

  it("treats a null P&L as zero, never as an invented number", () => {
    const s = summarizeDayTrades([
      { netPnl: null, rMultiple: null, resultType: null },
    ]);
    expect(s.netPnl).toBe("0");
    expect(s.tradeCount).toBe(1);
    expect(s.wins).toBe(0);
    expect(s.losses).toBe(0);
  });
});

describe("calendarDayQuerySchema", () => {
  it("accepts a valid day, with or without an account", () => {
    expect(
      calendarDayQuerySchema.safeParse({ date: "2026-11-17" }).success
    ).toBe(true);
    expect(
      calendarDayQuerySchema.safeParse({ date: "2026-11-17", account: "acc-1" })
        .success
    ).toBe(true);
  });

  it("rejects a missing or malformed date", () => {
    expect(calendarDayQuerySchema.safeParse({}).success).toBe(false);
    expect(
      calendarDayQuerySchema.safeParse({ date: "17-11-2026" }).success
    ).toBe(false);
    expect(
      calendarDayQuerySchema.safeParse({ date: "2026-13-01" }).success
    ).toBe(false);
  });
});
