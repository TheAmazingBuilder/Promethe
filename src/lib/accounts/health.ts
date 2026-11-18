/**
 * Account health badges (MRT wave 2, chantier 4) — pure, testable logic.
 *
 * One badge per account, computed from the REAL equity curve only:
 * initial balance plus the signed net P&L of closed trades, in
 * chronological exit order, with the running peak as the high-water mark
 * (the same convention as the PROP status in src/server/prop-status.ts).
 * Nothing is invented: an account with no closed trade gets no health
 * claim at all ("no-data").
 *
 * Thresholds (explicit, and the only numbers the badge depends on):
 * - IN DRAWDOWN when the account has used at least 50% of its allowed
 *   max total drawdown (PROP limit set), or — with no limit set — when it
 *   sits at least 5% below its peak equity.
 * - GROWING when the account is net positive overall (equity above the
 *   initial balance), within 2% of its peak, and its last-30-days net
 *   P&L is positive too, so a stale old profit cannot read as growth.
 * - STABLE for everything else that has trades: neither growing nor in
 *   drawdown.
 */
import { D0, toD } from "@/lib/trading/dec";

export type AccountHealthStatus =
  | "growing"
  | "stable"
  | "in-drawdown"
  | "no-data";

/** Share of the allowed max drawdown used before the badge flips to In Drawdown. */
export const IN_DRAWDOWN_USAGE_THRESHOLD = 50;
/** Drawdown from the peak (%) that reads as In Drawdown when no limit is set. */
export const IN_DRAWDOWN_NO_LIMIT_PCT = 5;
/** Max distance from the peak (%) still compatible with Growing. */
export const GROWING_MAX_DRAWDOWN_PCT = 2;

export interface AccountHealthInput {
  /** Starting balance, decimal string. */
  initialBalance: string;
  /** initialBalance + signed net P&L of closed trades, decimal string. */
  currentEquity: string;
  /** Running high-water mark of the equity curve, decimal string. */
  peakEquity: string;
  /** Closed trades behind the figures. */
  tradeCount: number;
  /** Signed net P&L of closed trades from the last 30 days, decimal string. */
  recentNetPnl: string;
  /** Allowed max total drawdown in %, null when the account has no limit. */
  maxTotalDrawdownPercent: string | null;
}

export interface AccountHealth {
  status: AccountHealthStatus;
  /** Current drawdown from the peak, account currency, always >= 0. */
  drawdown: string;
  /** Current drawdown as % of the peak, null when the peak is not positive. */
  drawdownPercent: number | null;
  /**
   * Share of the allowed max drawdown already used (0-100+, can exceed 100
   * past the limit), null when no limit is set or the peak is not positive.
   */
  drawdownUsagePercent: number | null;
  /** Net P&L since the start: currentEquity - initialBalance. */
  netPnl: string;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function assessAccountHealth(input: AccountHealthInput): AccountHealth {
  const initial = toD(input.initialBalance);
  const current = toD(input.currentEquity);
  const peak = toD(input.peakEquity);
  const recent = toD(input.recentNetPnl);
  const netPnl = current.minus(initial);

  const noData: AccountHealth = {
    status: "no-data",
    drawdown: D0.toString(),
    drawdownPercent: null,
    drawdownUsagePercent: null,
    netPnl: netPnl.toString(),
  };

  // No trades, or numbers that cannot produce a meaningful percentage.
  if (input.tradeCount <= 0) return noData;
  if (!peak.isFinite() || peak.lte(0)) return noData;
  if (!current.isFinite() || !initial.isFinite() || !recent.isFinite()) {
    return noData;
  }

  const drawdown = peak.minus(current);
  const drawdownClamped = drawdown.gt(0) ? drawdown : D0;
  const drawdownPercent = round(
    drawdownClamped.div(peak).times(100).toNumber()
  );

  const limit =
    input.maxTotalDrawdownPercent != null
      ? toD(input.maxTotalDrawdownPercent)
      : null;
  const drawdownUsagePercent =
    limit != null && limit.isFinite() && limit.gt(0)
      ? round(drawdownPercent / limit.toNumber() * 100)
      : null;

  let status: AccountHealthStatus;
  if (
    (drawdownUsagePercent != null &&
      drawdownUsagePercent >= IN_DRAWDOWN_USAGE_THRESHOLD) ||
    (drawdownUsagePercent == null &&
      drawdownPercent >= IN_DRAWDOWN_NO_LIMIT_PCT)
  ) {
    status = "in-drawdown";
  } else if (
    netPnl.gt(0) &&
    drawdownPercent < GROWING_MAX_DRAWDOWN_PCT &&
    recent.gt(0)
  ) {
    status = "growing";
  } else {
    status = "stable";
  }

  return {
    status,
    drawdown: drawdownClamped.toString(),
    drawdownPercent,
    drawdownUsagePercent,
    netPnl: netPnl.toString(),
  };
}
