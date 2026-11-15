/**
 * Analytics aggregation (v2 Phase 4) — powers #/analytics: KPIs + advanced
 * stats (SQN, Sharpe/Sortino), equity curve, R distribution, breakdowns and
 * rule-based insights over CLOSED non-draft trades.
 *
 * Timezone: weekday/hour/localDate are computed here in the user's profile
 * timezone via Intl (pure engine stays TZ-agnostic). Equity follows the
 * dashboard convention: only accounts in the curve currency.
 */
import { db } from "@/lib/db";
import {
  computeEquityCurve,
  computeTradeStats,
  type StatTrade,
} from "@/lib/analytics/engine";
import {
  computeAdvancedStats,
  computeBreakdowns,
  computeInsights,
  computeRDistribution,
  weekdayOfIsoDate,
  type AnalyticsTrade,
} from "@/lib/analytics/insights";
import { toD } from "@/lib/trading/dec";
import type { AnalyticsPayload } from "@/lib/trading/dto";
import type { AnalyticsQuery } from "@/lib/validations/analytics";
import type { Prisma } from "@prisma/client";

const TRADE_INCLUDE = {
  instrument: true,
  account: true,
  strategy: true,
} as const;

type Row = Prisma.TradeGetPayload<{ include: typeof TRADE_INCLUDE }>;

/** Period start (UTC Date) — null for "all". */
function periodCutoff(period: AnalyticsQuery["period"]): Date | null {
  const now = new Date();
  switch (period) {
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case "90d":
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    case "ytd":
      return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    default:
      return null;
  }
}

/**
 * Local calendar parts (entry + exit) in `timezone` — null on invalid TZ
 * (breakdown dimensions simply skip those trades, the engine tolerates null).
 */
function localParts(
  date: Date,
  timezone: string
): { date: string; hour: number } | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(date)) {
      if (p.type !== "literal") parts[p.type] = p.value;
    }
    const hour = Number.parseInt(parts.hour ?? "", 10);
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      hour: Number.isFinite(hour) ? hour : 0,
    };
  } catch {
    return null;
  }
}

function toAnalyticsTrade(t: Row, timezone: string): AnalyticsTrade {
  const exitIso = (t.exitTime ?? t.entryTime).toISOString();
  // v2.5 M4 — a soft-deleted (trashed) strategy is excluded from breakdowns:
  // the trade itself stays, its strategy bucket reads as "none" until restore.
  const liveStrategy = t.strategy?.deletedAt == null ? t.strategy : null;
  const base: StatTrade = {
    id: t.id,
    exitTime: exitIso,
    entryTime: t.entryTime.toISOString(),
    netPnl: t.netPnl?.toString() ?? null,
    rMultiple: t.rMultiple?.toString() ?? null,
    resultType: t.resultType,
    strategyId: liveStrategy ? t.strategyId : null,
    strategyName: liveStrategy?.name ?? null,
    instrumentId: t.instrumentId,
    symbol: t.instrument.symbol,
    direction: t.direction,
    session: t.session,
    lots: t.lots.toString(),
  };

  const exitLocal = localParts(t.exitTime ?? t.entryTime, timezone);
  const entryLocal = localParts(t.entryTime, timezone);
  const durationMin =
    t.exitTime != null
      ? Math.max(
          0,
          Math.round(
            (t.exitTime.getTime() - t.entryTime.getTime()) / (60 * 1000)
          )
        )
      : null;

  return {
    ...base,
    accountId: t.accountId,
    accountName: t.account.name,
    timeframe: t.timeframe,
    setupType: t.setupType,
    marketCondition: t.marketCondition,
    exitReason: t.exitReason,
    emotionBefore: t.emotionBefore,
    followedPlan: t.followedPlan,
    commission: t.commission?.toString() ?? null,
    swap: t.swap?.toString() ?? null,
    fees: t.fees?.toString() ?? null,
    localDate: exitLocal?.date ?? null,
    localWeekday:
      entryLocal != null ? weekdayOfIsoDate(entryLocal.date) : null,
    localHour: entryLocal?.hour ?? null,
    durationMin,
  };
}

export async function getAnalytics(
  userId: string,
  query: AnalyticsQuery
): Promise<AnalyticsPayload> {
  const [profile, accounts] = await Promise.all([
    db.profile.findUnique({ where: { id: userId } }),
    db.account.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
  ]);

  // Account filter must belong to the user (silent fallback to "all").
  const accountFilter =
    query.account != null
      ? (accounts.find((a) => a.id === query.account) ?? null)
      : null;

  const where: Prisma.TradeWhereInput = {
    userId,
    status: "CLOSED",
    isDraft: false,
    ...(accountFilter ? { accountId: accountFilter.id } : {}),
  };
  const cutoff = periodCutoff(query.period);
  if (cutoff != null) where.exitTime = { gte: cutoff };

  const rows = await db.trade.findMany({
    where,
    include: TRADE_INCLUDE,
  });

  const timezone = profile?.timezone ?? "UTC";
  const currency =
    accountFilter?.currency ?? profile?.baseCurrency ?? "USD";

  const trades = rows.map((t) => toAnalyticsTrade(t, timezone));

  const stats = trades.length > 0 ? computeTradeStats(trades) : null;
  const advanced = stats != null ? computeAdvancedStats(trades, stats) : null;
  const breakdowns = computeBreakdowns(trades);
  const insights =
    stats != null && advanced != null
      ? computeInsights(trades, breakdowns, stats, advanced)
      : [];
  const rDistribution = computeRDistribution(trades);

  // Equity — same convention as the dashboard: accounts whose currency
  // matches the display currency (naive multi-currency aggregation excluded,
  // documented limitation).
  const curveAccounts = accounts.filter((a) => a.currency === currency);
  const initialBalance = curveAccounts.reduce(
    (acc, a) => acc.plus(toD(a.initialBalance)),
    toD(0)
  );
  const curveAccountIds = new Set(curveAccounts.map((a) => a.id));
  const curveTrades = trades.filter((t) => curveAccountIds.has(t.accountId));
  const equityCurve =
    curveTrades.length > 0
      ? computeEquityCurve(curveTrades, initialBalance)
      : [];

  return {
    period: query.period,
    accountId: accountFilter?.id ?? null,
    currency,
    timezone,
    stats,
    advanced,
    equityInitialBalance: initialBalance.toString(),
    equityCurve,
    rDistribution,
    breakdowns,
    insights,
  };
}
