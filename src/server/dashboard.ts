/**
 * Dashboard aggregation (v2 Phase 1) — one scoped query set powering the home
 * view: KPIs (30 days + all time), open positions, review queue count, equity
 * curve, per-strategy stats and recent trades.
 */
import { db } from "@/lib/db";
import {
  computeEquityCurve,
  computeTradeStats,
  groupStats,
  type StatTrade,
} from "@/lib/analytics/engine";
import { toD } from "@/lib/trading/dec";
import type {
  AccountDTO,
  DashboardPayload,
  OpenPositionDTO,
} from "@/lib/trading/dto";
import { toAccountDTO } from "@/server/reference";
import { toTradeListItem } from "@/server/trades";
import type { Prisma } from "@prisma/client";
import { getDisplayPreferences } from "@/server/display-preferences";
import { tradingDayOfTrade } from "@/lib/time/trading-day";
import { scopeTradesToCurrency } from "@/lib/analytics/currency-scope";

const TRADE_INCLUDE = {
  instrument: true,
  account: true,
  strategy: true,
  tags: { include: { tag: true } },
} as const;

type Row = Prisma.TradeGetPayload<{ include: typeof TRADE_INCLUDE }>;

function toStatTrade(t: Row): StatTrade {
  return {
    id: t.id,
    exitTime: (t.exitTime ?? t.entryTime).toISOString(),
    entryTime: t.entryTime.toISOString(),
    netPnl: t.netPnl?.toString() ?? null,
    rMultiple: t.rMultiple?.toString() ?? null,
    resultType: t.resultType,
    strategyId: t.strategyId,
    strategyName: t.strategy?.name ?? null,
    instrumentId: t.instrumentId,
    symbol: t.instrument.symbol,
    direction: t.direction,
    session: t.session,
    lots: t.lots.toString(),
  };
}

export async function getDashboard(userId: string): Promise<DashboardPayload> {
  const [profile, accounts, strategies, prefs] = await Promise.all([
    db.profile.findUnique({ where: { id: userId } }),
    db.account.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.strategy.findMany({
      where: { userId },
      include: { checklistItems: { orderBy: { order: "asc" } } },
      orderBy: { createdAt: "asc" },
    }),
    getDisplayPreferences(userId),
  ]);
  const currency = profile?.baseCurrency ?? "USD";
  const timezone = profile?.timezone ?? "UTC";
  // KPI "trading days" counts TRADING days (default MIDNIGHT_LOCAL = the
  // local calendar day, i.e. the previous behaviour).
  const dayOf = tradingDayOfTrade(timezone, prefs.tradingDay);

  // Closed non-draft trades (full history — the demo dataset stays small;
  // larger books are covered by the paginated trades list).
  const closedRows = await db.trade.findMany({
    where: { userId, status: "CLOSED", isDraft: false },
    include: TRADE_INCLUDE,
  });
  const currencyScope = scopeTradesToCurrency(closedRows, currency);
  const statTrades = currencyScope.trades.map(toStatTrade);

  const now = Date.now();
  const cutoff = now - 30 * 24 * 60 * 60 * 1000;
  const last30 = statTrades.filter(
    (t) => new Date(t.exitTime).getTime() >= cutoff
  );

  const kpisAllTime =
    statTrades.length > 0 ? computeTradeStats(statTrades, { dayOf }) : null;
  const kpis30d =
    last30.length > 0 ? computeTradeStats(last30, { dayOf }) : null;

  // Equity in the profile currency — accounts in other currencies are excluded
  // from the curve (documented limitation: naive multi-currency aggregation).
  const curveAccounts = accounts.filter((a) => a.currency === currency);
  const initialBalance = curveAccounts.reduce(
    (acc, a) => acc.plus(toD(a.initialBalance)),
    toD(0)
  );
  const curveAccountIds = new Set(curveAccounts.map((a) => a.id));
  const curveTradeIds = new Set(
    currencyScope.trades
      .filter((trade) => curveAccountIds.has(trade.accountId))
      .map((trade) => trade.id)
  );
  const curveTrades = statTrades.filter((trade) => curveTradeIds.has(trade.id));
  const equityCurve = computeEquityCurve(curveTrades, initialBalance);

  // Open positions + counters + recent trades.
  const [openRows, toReviewCount, draftCount, recentRows] = await Promise.all([
    db.trade.findMany({
      where: { userId, status: "OPEN", isDraft: false },
      include: TRADE_INCLUDE,
      orderBy: { entryTime: "desc" },
    }),
    db.trade.count({ where: { userId, reviewStatus: "NOT_REVIEWED", isDraft: false } }),
    db.trade.count({ where: { userId, isDraft: true } }),
    db.trade.findMany({
      where: { userId, isDraft: false },
      include: TRADE_INCLUDE,
      orderBy: { entryTime: "desc" },
      take: 6,
    }),
  ]);

  const openPositions: OpenPositionDTO[] = openRows.map((t) => ({
    id: t.id,
    symbol: t.instrument.symbol,
    digits: t.instrument.digits,
    direction: t.direction,
    entryTime: t.entryTime.toISOString(),
    entryPrice: t.entryPrice.toString(),
    stopLoss: t.stopLoss?.toString() ?? null,
    takeProfit: t.takeProfit?.toString() ?? null,
    lots: t.lots.toString(),
    riskAmount: t.riskAmount?.toString() ?? null,
    riskPercent: t.riskPercent?.toString() ?? null,
    pnlCurrency: t.pnlCurrency,
    accountName: t.account.name,
    accountId: t.accountId,
    strategyName: t.strategy?.name ?? null,
    timeframe: t.timeframe,
  }));

  const byStrategy = groupStats(statTrades, (t) => t.strategyName ?? null);
  const strategyStats = byStrategy.map((g) => {
    const match = strategies.find((sm) => sm.name === g.key);
    return {
      ...g,
      name: g.key,
      color: match?.color ?? "#64748b",
    };
  });

  return {
    currency,
    excludedTradeCount: currencyScope.excludedTradeCount,
    accounts: accounts.map(toAccountDTO),
    kpis30d,
    kpisAllTime,
    openPositions,
    toReviewCount,
    draftCount,
    equityInitialBalance: initialBalance.toString(),
    equityCurve,
    strategyStats,
    recentTrades: recentRows.map(toTradeListItem),
  };
}
