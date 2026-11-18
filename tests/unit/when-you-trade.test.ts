/**
 * When you trade (MRT wave 2) — unit tests.
 *
 * Pure functions only (no DB): hour / weekday aggregation, the
 * session x weekday matrix, the minimum-sample rule for "best" slots,
 * and the guarantee that no session is ever invented.
 */
import { describe, expect, it } from "vitest";
import {
  MIN_SAMPLE_WHEN_YOU_TRADE,
  computeWhenYouTrade,
  type WhenYouTradeTrade,
} from "@/lib/analytics/when-you-trade";

function makeTrade(partial: Partial<WhenYouTradeTrade> = {}): WhenYouTradeTrade {
  return {
    localWeekday: 2,
    localHour: 9,
    session: "LONDON",
    netPnl: "100",
    resultType: "WIN",
    ...partial,
  };
}

describe("computeWhenYouTrade — empty input", () => {
  it("returns 24 hours, 7 weekdays, no sessions, no best slot", () => {
    const r = computeWhenYouTrade([]);
    expect(r.total).toBe(0);
    expect(r.byHour).toHaveLength(24);
    expect(r.byHour.map((h) => h.hour)).toEqual(
      Array.from({ length: 24 }, (_, h) => h)
    );
    expect(r.byHour.every((h) => h.count === 0)).toBe(true);
    expect(r.byWeekday).toHaveLength(7);
    expect(r.byWeekday.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(r.sessions).toEqual([]);
    expect(r.matrix).toEqual([]);
    expect(r.bestHour).toBeNull();
    expect(r.bestWeekday).toBeNull();
    expect(r.minSample).toBe(MIN_SAMPLE_WHEN_YOU_TRADE);
  });
});

describe("computeWhenYouTrade — hour and weekday aggregation", () => {
  it("sums P&L, counts wins and losses, and computes win rate per slot", () => {
    const trades = [
      makeTrade({ localHour: 9, localWeekday: 2, netPnl: "100", resultType: "WIN" }),
      makeTrade({ localHour: 9, localWeekday: 2, netPnl: "-40", resultType: "LOSS" }),
      makeTrade({ localHour: 9, localWeekday: 3, netPnl: "20", resultType: "WIN" }),
      makeTrade({ localHour: 15, localWeekday: 2, netPnl: "50", resultType: "BREAKEVEN" }),
    ];
    const r = computeWhenYouTrade(trades);
    expect(r.total).toBe(4);

    const h9 = r.byHour[9];
    expect(h9.count).toBe(3);
    expect(h9.wins).toBe(2);
    expect(h9.losses).toBe(1);
    expect(h9.netPnl).toBe("80");
    expect(h9.winRate).toBe(66.7);

    const h15 = r.byHour[15];
    expect(h15.count).toBe(1);
    expect(h15.netPnl).toBe("50");
    // Breakeven is not a decided trade: no win rate.
    expect(h15.winRate).toBeNull();

    const tue = r.byWeekday[1];
    expect(tue.weekday).toBe(2);
    expect(tue.count).toBe(3);
    expect(tue.netPnl).toBe("110");
    expect(tue.winRate).toBe(50);

    const wed = r.byWeekday[2];
    expect(wed.count).toBe(1);
    expect(wed.netPnl).toBe("20");
  });

  it("ignores trades without a usable local hour or weekday", () => {
    const r = computeWhenYouTrade([
      makeTrade({ localHour: null, localWeekday: null }),
      makeTrade({ localHour: 25, localWeekday: 0 }),
      makeTrade({ localHour: 9, localWeekday: 2 }),
    ]);
    expect(r.total).toBe(1);
    expect(r.byHour[9].count).toBe(1);
  });

  it("keeps a trade with only one usable dimension in that dimension", () => {
    const r = computeWhenYouTrade([
      makeTrade({ localHour: null, localWeekday: 5, netPnl: "30" }),
    ]);
    expect(r.total).toBe(1);
    expect(r.byWeekday[4].count).toBe(1);
    expect(r.byHour.every((h) => h.count === 0)).toBe(true);
  });
});

describe("computeWhenYouTrade — best slot and minimum sample", () => {
  it("picks the best hour and weekday by net P&L once the sample is big enough", () => {
    const trades = [
      ...Array.from({ length: 6 }, () =>
        makeTrade({ localHour: 9, localWeekday: 2, netPnl: "10", resultType: "WIN" })
      ),
      ...Array.from({ length: 6 }, () =>
        makeTrade({ localHour: 15, localWeekday: 4, netPnl: "100", resultType: "WIN" })
      ),
    ];
    const r = computeWhenYouTrade(trades);
    expect(r.bestHour?.hour).toBe(15);
    expect(r.bestHour?.netPnl).toBe("600");
    expect(r.bestWeekday?.weekday).toBe(4);
    expect(r.bestWeekday?.netPnl).toBe("600");
  });

  it("returns no best slot when every slot is below the minimum sample", () => {
    const trades = Array.from({ length: 4 }, () =>
      makeTrade({ localHour: 9, localWeekday: 2, netPnl: "500", resultType: "WIN" })
    );
    const r = computeWhenYouTrade(trades);
    expect(r.bestHour).toBeNull();
    expect(r.bestWeekday).toBeNull();
  });

  it("does not crown a slot with fewer trades over a bigger-sample winner", () => {
    const trades = [
      ...Array.from({ length: 6 }, () =>
        makeTrade({ localHour: 8, localWeekday: 1, netPnl: "10", resultType: "WIN" })
      ),
      ...Array.from({ length: 3 }, () =>
        makeTrade({ localHour: 20, localWeekday: 1, netPnl: "1000", resultType: "WIN" })
      ),
    ];
    const r = computeWhenYouTrade(trades);
    expect(r.bestHour?.hour).toBe(8);
  });
});

describe("computeWhenYouTrade — session x weekday matrix", () => {
  it("only lists sessions present in the data, most traded first", () => {
    const trades = [
      makeTrade({ session: "NEW_YORK", localWeekday: 2 }),
      makeTrade({ session: "LONDON", localWeekday: 2 }),
      makeTrade({ session: "LONDON", localWeekday: 3 }),
      makeTrade({ session: "LONDON", localWeekday: 3 }),
    ];
    const r = computeWhenYouTrade(trades);
    expect(r.sessions).toEqual(["LONDON", "NEW_YORK"]);
    expect(r.matrix).toHaveLength(3);
    const londonTue = r.matrix.find(
      (c) => c.session === "LONDON" && c.weekday === 2
    );
    expect(londonTue?.count).toBe(1);
    expect(londonTue?.key).toBe("LONDON|2");
    const londonWed = r.matrix.find(
      (c) => c.session === "LONDON" && c.weekday === 3
    );
    expect(londonWed?.count).toBe(2);
    // No cell for a session x weekday pair with zero trades.
    expect(
      r.matrix.find((c) => c.session === "NEW_YORK" && c.weekday === 3)
    ).toBeUndefined();
  });

  it("never invents the MRT demo session names", () => {
    const trades = [
      makeTrade({ session: "ASIAN", localWeekday: 1 }),
      makeTrade({ session: null, localWeekday: 1 }),
      makeTrade({ session: "", localWeekday: 1 }),
    ];
    const r = computeWhenYouTrade(trades);
    expect(r.sessions).toEqual(["ASIAN"]);
    expect(r.matrix).toHaveLength(1);
    expect(r.matrix[0].session).toBe("ASIAN");
  });

  it("keeps a custom session name exactly as stored", () => {
    const trades = [makeTrade({ session: "New York AM", localWeekday: 2 })];
    const r = computeWhenYouTrade(trades);
    expect(r.sessions).toEqual(["New York AM"]);
  });
});
