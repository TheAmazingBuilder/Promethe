/**
 * Monthly report - closed trades of one calendar month, aggregated for the
 * PDF export (/analytics "Rapport PDF"). Reuses the analytics engines
 * (computeTradeStats / computeAdvancedStats) over the month's trades.
 */
import { db } from "@/lib/db";
import { computeTradeStats, type StatTrade } from "@/lib/analytics/engine";
import { Decimal, toD } from "@/lib/trading/dec";
import { scopeTradesToCurrency } from "@/lib/analytics/currency-scope";
import { DEFAULT_TRADING_DAY, tradingDayStartUtc } from "@/lib/time/trading-day";
import { zonedDate } from "@/lib/time/zones";

export interface MonthlyReportGroup {
  name: string;
  trades: number;
  wins: number;
  winRate: number | null;
  netPnl: string;
}

export interface MonthlyReportTrade {
  symbol: string;
  direction: string;
  date: string;
  netPnl: string;
  rMultiple: string | null;
}

export interface MonthlyReport {
  month: string;
  monthLabel: string;
  currency: string;
  accountId: string | null;
  /** Closed trades excluded because their account currency differs from currency. */
  excludedTradeCount: number;
  tradeCount: number;
  netPnl: string | null;
  /** 0-100, as a string. */
  winRate: string | null;
  profitFactor: string | null;
  avgWin: string | null;
  avgLoss: string | null;
  totalR: string | null;
  maxDrawdown: string | null;
  /** Cumulative net P&L per trade, chronological — NOT account equity:
   * deposits/withdrawals and open positions are not in this series, so
   * the PDF renders it as the "Cumulative P&L curve". The field keeps
   * its historical `equity` name for API compatibility. */
  equity: Array<{ date: string; cumPnl: string }>;
  bySymbol: MonthlyReportGroup[];
  byStrategy: MonthlyReportGroup[];
  bestTrades: MonthlyReportTrade[];
  worstTrades: MonthlyReportTrade[];
}

/** "2026-11" -> [start, end) in the selected timezone. */
export function monthRange(month: string, timezone = "UTC"): [Date, Date] | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const m = Number(match[2]);
  const nextYear = m === 12 ? year + 1 : year;
  const nextMonth = m === 12 ? 1 : m + 1;
  return [
    tradingDayStartUtc(`${year}-${String(m).padStart(2, "0")}-01`, timezone, DEFAULT_TRADING_DAY),
    tradingDayStartUtc(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01`, timezone, DEFAULT_TRADING_DAY),
  ];
}

function groupRows(
  trades: StatTrade[]
): { bySymbol: MonthlyReportGroup[]; byStrategy: MonthlyReportGroup[] } {
  const build = (key: (t: StatTrade) => string | null) => {
    const map = new Map<string, { trades: number; wins: number; decided: number; pnl: Decimal }>();
    for (const t of trades) {
      const name = key(t) ?? "-";
      const entry = map.get(name) ?? { trades: 0, wins: 0, decided: 0, pnl: toD(0) };
      entry.trades += 1;
      const pnl = toD(t.netPnl ?? 0);
      const outcome =
        t.resultType === "WIN" || t.resultType === "LOSS" || t.resultType === "BREAKEVEN"
          ? t.resultType
          : pnl.gt(0) ? "WIN" : pnl.lt(0) ? "LOSS" : "BREAKEVEN";
      if (outcome === "WIN") {
        entry.wins += 1;
        entry.decided += 1;
      } else if (outcome === "LOSS") {
        entry.decided += 1;
      }
      entry.pnl = entry.pnl.plus(pnl);
      map.set(name, entry);
    }
    return [...map.entries()]
      .map(([name, v]) => ({
        name,
        trades: v.trades,
        wins: v.wins,
        winRate: v.decided > 0 ? (v.wins / v.decided) * 100 : null,
        netPnl: v.pnl.toString(),
      }))
      .sort((a, b) => Number(b.netPnl) - Number(a.netPnl));
  };
  return {
    bySymbol: build((t) => t.symbol),
    byStrategy: build((t) => t.strategyName ?? null),
  };
}

export async function getMonthlyReport(
  userId: string,
  month: string,
  accountId?: string | null
): Promise<MonthlyReport | null> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;

  const [profile, accounts] = await Promise.all([
    db.profile.findUnique({ where: { id: userId } }),
    db.account.findMany({ where: { userId }, select: { id: true, currency: true } }),
  ]);
  const timezone = profile?.timezone ?? "UTC";
  const range = monthRange(month, timezone);
  if (!range) return null;
  const [start, end] = range;
  const accountFilter = accountId == null ? null : accounts.find((account) => account.id === accountId) ?? null;
  if (accountId != null && accountFilter == null) return null;
  const currency = accountFilter?.currency ?? profile?.baseCurrency ?? "USD";

  const rows = await db.trade.findMany({
    where: {
      userId,
      status: "CLOSED",
      isDraft: false,
      exitTime: { gte: start, lt: end },
      ...(accountFilter ? { accountId: accountFilter.id } : {}),
    },
    include: { instrument: true, strategy: true },
    orderBy: { exitTime: "asc" },
  });
  const currencyScope = scopeTradesToCurrency(
    rows,
    currency
  );

  const trades: StatTrade[] = currencyScope.trades.map((t) => ({
    id: t.id,
    exitTime: (t.exitTime ?? t.entryTime).toISOString(),
    entryTime: t.entryTime.toISOString(),
    netPnl: t.netPnl?.toString() ?? null,
    rMultiple: t.rMultiple?.toString() ?? null,
    resultType: t.resultType,
    strategyId: t.strategyId,
    strategyName: t.strategy?.deletedAt == null ? t.strategy?.name ?? null : null,
    instrumentId: t.instrumentId,
    symbol: t.instrument.symbol,
    direction: t.direction,
    session: t.session,
    lots: t.lots.toString(),
  }));

  const stats = trades.length > 0 ? computeTradeStats(trades) : null;

  // Cumulative net P&L, chronological (rendered in the PDF as the
  // "Cumulative P&L curve" — this is not an equity curve: cash flows
  // and open positions are excluded by construction).
  let cum = toD(0);
  const equity = trades.map((t) => {
    cum = cum.plus(toD(t.netPnl ?? 0));
    return { date: zonedDate(new Date(t.exitTime), timezone), cumPnl: cum.toString() };
  });

  const byNetPnl = [...trades].sort(
    (a, b) => Number(b.netPnl ?? 0) - Number(a.netPnl ?? 0)
  );
  const toReportTrade = (t: StatTrade): MonthlyReportTrade => ({
    symbol: t.symbol,
    direction: t.direction,
    date: zonedDate(new Date(t.exitTime), timezone),
    netPnl: t.netPnl ?? "0",
    rMultiple: t.rMultiple,
  });

  const { bySymbol, byStrategy } = groupRows(trades);
  const monthLabel = new Intl.DateTimeFormat("en-CA", {
    month: "long",
    year: "numeric",
    timeZone: timezone,
  }).format(start);

  return {
    month,
    monthLabel,
    currency,
    accountId: accountFilter?.id ?? null,
    excludedTradeCount: currencyScope.excludedTradeCount,
    tradeCount: trades.length,
    netPnl: stats != null ? stats.netPnl : null,
    winRate: stats != null ? stats.winRate : null,
    profitFactor: stats != null ? stats.profitFactor : null,
    avgWin: stats != null ? stats.avgWin : null,
    avgLoss: stats != null ? stats.avgLoss : null,
    totalR: stats != null ? stats.totalR : null,
    maxDrawdown: stats != null ? stats.maxDrawdown : null,
    equity,
    bySymbol,
    byStrategy,
    bestTrades: byNetPnl.slice(0, 5).map(toReportTrade),
    worstTrades: byNetPnl.slice(-5).reverse().map(toReportTrade),
  };
}
