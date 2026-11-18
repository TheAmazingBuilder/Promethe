/**
 * Account health badges (MRT wave 2, chantier 4) — unit tests.
 *
 * Pure function only (no DB): every threshold asserted here is the one
 * documented in src/lib/accounts/health.ts. All figures are fabricated
 * for the test, never production data.
 */
import { describe, expect, it } from "vitest";
import {
  GROWING_MAX_DRAWDOWN_PCT,
  IN_DRAWDOWN_NO_LIMIT_PCT,
  IN_DRAWDOWN_USAGE_THRESHOLD,
  assessAccountHealth,
  type AccountHealthInput,
} from "@/lib/accounts/health";

function input(partial: Partial<AccountHealthInput> = {}): AccountHealthInput {
  return {
    initialBalance: "10000",
    currentEquity: "10000",
    peakEquity: "10000",
    tradeCount: 10,
    recentNetPnl: "0",
    maxTotalDrawdownPercent: "10",
    ...partial,
  };
}

describe("assessAccountHealth — no data", () => {
  it("never claims Growing for an account with no trade", () => {
    const health = assessAccountHealth(
      input({ tradeCount: 0, currentEquity: "10000", peakEquity: "10000" })
    );
    expect(health.status).toBe("no-data");
  });

  it("returns no-data when the peak is not positive", () => {
    expect(
      assessAccountHealth(input({ peakEquity: "0", currentEquity: "0" }))
        .status
    ).toBe("no-data");
  });
});

describe("assessAccountHealth — In Drawdown", () => {
  it("flags In Drawdown at half the allowed max drawdown", () => {
    // 10% limit, 5% below the peak = 50% of the limit used.
    const health = assessAccountHealth(
      input({
        currentEquity: "9500",
        peakEquity: "10000",
        maxTotalDrawdownPercent: "10",
      })
    );
    expect(health.status).toBe("in-drawdown");
    expect(health.drawdownPercent).toBe(5);
    expect(health.drawdownUsagePercent).toBe(
      IN_DRAWDOWN_USAGE_THRESHOLD
    );
  });

  it("stays Stable just under half the allowed drawdown", () => {
    // 4.9% below the peak on a 10% limit = 49% used.
    const health = assessAccountHealth(
      input({
        currentEquity: "9510",
        peakEquity: "10000",
        maxTotalDrawdownPercent: "10",
      })
    );
    expect(health.status).toBe("stable");
    expect(health.drawdownUsagePercent).toBe(49);
  });

  it("flags In Drawdown at 5% below the peak when no limit is set", () => {
    const health = assessAccountHealth(
      input({
        currentEquity: "9500",
        peakEquity: "10000",
        maxTotalDrawdownPercent: null,
      })
    );
    expect(health.status).toBe("in-drawdown");
    expect(health.drawdownPercent).toBe(IN_DRAWDOWN_NO_LIMIT_PCT);
    expect(health.drawdownUsagePercent).toBeNull();
  });

  it("stays Stable just under 5% below the peak with no limit", () => {
    expect(
      assessAccountHealth(
        input({
          currentEquity: "9510",
          peakEquity: "10000",
          maxTotalDrawdownPercent: null,
        })
      ).status
    ).toBe("stable");
  });

  it("can exceed 100% usage past the limit", () => {
    const health = assessAccountHealth(
      input({
        currentEquity: "8500",
        peakEquity: "10000",
        maxTotalDrawdownPercent: "10",
      })
    );
    expect(health.status).toBe("in-drawdown");
    expect(health.drawdownUsagePercent).toBe(150);
  });
});

describe("assessAccountHealth — Growing", () => {
  it("flags Growing when net positive, near the peak, and recent P&L positive", () => {
    const health = assessAccountHealth(
      input({
        currentEquity: "10100",
        peakEquity: "10200",
        recentNetPnl: "300",
      })
    );
    expect(health.status).toBe("growing");
    expect(health.netPnl).toBe("100");
  });

  it("does not flag Growing when the recent 30 days are negative", () => {
    // Old profit, no recent momentum: stale, not growing.
    expect(
      assessAccountHealth(
        input({
          currentEquity: "10100",
          peakEquity: "10200",
          recentNetPnl: "-50",
        })
      ).status
    ).toBe("stable");
  });

  it("does not flag Growing when 2% or more below the peak", () => {
    // 220 below a 10420 peak = 2.1% away: too far from the highs.
    expect(
      assessAccountHealth(
        input({
          currentEquity: "10200",
          peakEquity: "10420",
          recentNetPnl: "300",
        })
      ).status
    ).toBe("stable");
  });

  it("does not flag Growing when net negative overall", () => {
    expect(
      assessAccountHealth(
        input({
          initialBalance: "11000",
          currentEquity: "10100",
          peakEquity: "10200",
          recentNetPnl: "300",
        })
      ).status
    ).toBe("stable");
  });
});

describe("assessAccountHealth — Stable and figures", () => {
  it("is Stable for a flat account with trades", () => {
    const health = assessAccountHealth(input());
    expect(health.status).toBe("stable");
    expect(health.drawdown).toBe("0");
    expect(health.drawdownPercent).toBe(0);
    expect(health.netPnl).toBe("0");
  });

  it("clamps the drawdown at zero when equity is at a new peak", () => {
    const health = assessAccountHealth(
      input({
        currentEquity: "10500",
        peakEquity: "10500",
        recentNetPnl: "500",
      })
    );
    expect(health.status).toBe("growing");
    expect(health.drawdown).toBe("0");
  });

  it("exposes the threshold constants the UI documents", () => {
    expect(IN_DRAWDOWN_USAGE_THRESHOLD).toBe(50);
    expect(IN_DRAWDOWN_NO_LIMIT_PCT).toBe(5);
    expect(GROWING_MAX_DRAWDOWN_PCT).toBe(2);
  });
});
