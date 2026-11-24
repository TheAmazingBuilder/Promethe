/**
 * Pure Risk/Reward summary aggregation.
 *
 * Monetary values are scoped to the profile's base currency, matching the
 * Analytics module's pnlCurrency convention. Breakevens are excluded from
 * win-rate's denominator; money averages still follow actual P&L signs.
 */
import Decimal from "decimal.js";
import { D0, toD } from "@/lib/trading/dec";
import type { RiskRewardRealStats } from "@/lib/trading/dto";

export interface RiskRewardTradeLike {
  pnlCurrency: string;
  netPnl: string | null;
  rMultiple: string | null;
  realizedRR: string | null;
  plannedRR: string | null;
  resultType: string | null;
  exitTime: Date | null;
}

export interface RiskRewardStatsResult {
  realStats: RiskRewardRealStats;
  excludedTradeCount: number;
  realizedLossToday: string;
  realizedPnlToday: string;
}

export function computeRiskRewardStats(
  trades: RiskRewardTradeLike[],
  currency: string,
  today: string,
  dayOf: (date: Date) => string
): RiskRewardStatsResult {
  const scoped = trades.filter((trade) => trade.pnlCurrency === currency);
  let wins = 0;
  let losses = 0;
  let breakevens = 0;
  let sumPnl = D0;
  let sumR = D0;
  let countR = 0;
  let sumRealizedRR = D0;
  let countRealizedRR = 0;
  let sumPlannedRR = D0;
  let countPlannedRR = 0;
  let realizedLossToday = D0;
  let realizedPnlToday = D0;
  const positivePnls: Decimal[] = [];
  const negativePnls: Decimal[] = [];

  for (const trade of scoped) {
    const pnl = toD(trade.netPnl);
    sumPnl = sumPnl.plus(pnl);

    const outcome =
      trade.resultType === "WIN" ||
      trade.resultType === "LOSS" ||
      trade.resultType === "BREAKEVEN"
        ? trade.resultType
        : pnl.gt(0)
          ? "WIN"
          : pnl.lt(0)
            ? "LOSS"
            : "BREAKEVEN";

    if (outcome === "WIN") wins++;
    else if (outcome === "LOSS") losses++;
    else breakevens++;

    // Money averages use realized cash signs, not the R-aware outcome label.
    if (pnl.gt(0)) positivePnls.push(pnl);
    if (pnl.lt(0)) negativePnls.push(pnl.abs());

    if (trade.rMultiple != null) {
      sumR = sumR.plus(toD(trade.rMultiple));
      countR++;
    }
    if (trade.realizedRR != null) {
      sumRealizedRR = sumRealizedRR.plus(toD(trade.realizedRR));
      countRealizedRR++;
    }
    if (trade.plannedRR != null) {
      sumPlannedRR = sumPlannedRR.plus(toD(trade.plannedRR));
      countPlannedRR++;
    }
    if (trade.exitTime != null && dayOf(trade.exitTime) === today) {
      realizedPnlToday = realizedPnlToday.plus(pnl);
      if (pnl.lt(0)) realizedLossToday = realizedLossToday.plus(pnl.abs());
    }
  }

  const n = scoped.length;
  const decidedTrades = wins + losses;
  const avg = (values: Decimal[]): string | null =>
    values.length === 0
      ? null
      : values.reduce((sum, value) => sum.plus(value), D0).div(values.length).toString();

  return {
    realStats: {
      closedTrades: n,
      wins,
      losses,
      breakevens,
      winRate:
        decidedTrades === 0
          ? null
          : new Decimal(wins).div(decidedTrades).toString(),
      avgRealizedRR:
        countRealizedRR === 0
          ? null
          : sumRealizedRR.div(countRealizedRR).toString(),
      avgPlannedRR:
        countPlannedRR === 0
          ? null
          : sumPlannedRR.div(countPlannedRR).toString(),
      expectancyMoney: n === 0 ? null : sumPnl.div(n).toString(),
      expectancyR: countR === 0 ? null : sumR.div(countR).toString(),
      avgWin: avg(positivePnls),
      avgLoss: avg(negativePnls),
    },
    excludedTradeCount: trades.length - scoped.length,
    realizedLossToday: realizedLossToday.toString(),
    realizedPnlToday: realizedPnlToday.toString(),
  };
}
