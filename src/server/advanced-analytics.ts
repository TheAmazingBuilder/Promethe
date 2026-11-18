/**
 * Advanced analytics aggregation (v2.5 Module 6, Prompt 6) — powers
 * /analytics/lifecycle, /exits, /quality, /setups, /sequences,
 * /seasonality and /anomalies: lifecycle (MFE/MAE, almost-TP, time in
 * profit/loss from stored candles), exit analysis, trader score, setup
 * ranking, sequences, seasonality and anomaly detection over CLOSED
 * non-draft trades.
 *
 * Persistence (idempotent, user-scoped): the GET handler upserts
 * TradeLifecycleStats rows, today's TraderScoreSnapshot and refreshes
 * TradeAnomaly rows for the trades in scope, so the tables stay in sync
 * with the live computation. The daily cron calls recordDailyTraderScores
 * for every user instead.
 *
 * Timezone: entry/exit local parts are computed here in the user's profile
 * timezone via the charts server module (same convention as analytics).
 */
import { db } from "@/lib/db";
import {
  computeAdvancedAnalytics,
  computeTraderScore,
  isAlmostTp,
  type AdvancedAnalytics,
  type AdvancedTrade,
} from "@/lib/analytics/advanced";
import {
  computeAdvancedStats,
} from "@/lib/analytics/insights";
import { computeTradeStats } from "@/lib/analytics/engine";
import { excursionR } from "@/lib/charts/builder";
import { localParts } from "@/server/charts";
import { CANDLE_TIMEFRAMES, TF_MINUTES } from "@/lib/validations/charts";
import { toD } from "@/lib/trading/dec";
import type { AnalyticsQuery } from "@/lib/validations/analytics";
import type { AdvancedAnalyticsPayload } from "@/lib/trading/dto";
import type { Prisma } from "@prisma/client";
import { parseCustomFields } from "@/lib/custom-fields/validate";
import { getDisplayPreferences } from "@/server/display-preferences";
import { getTradingDay, tradingDayOfTrade } from "@/lib/time/trading-day";

const TRADE_INCLUDE = {
  instrument: true,
  account: true,
  strategy: true,
  tags: { include: { tag: true } },
  ruleViolations: { select: { ruleId: true } },
  review: { select: { playbookMatch: true } },
} as const;

type Row = Prisma.TradeGetPayload<{ include: typeof TRADE_INCLUDE }>;

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

/** UTC midnight of a date (snapshot day key). */
export function utcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

interface LoadedTrades {
  trades: AdvancedTrade[];
  timezone: string;
  currency: string;
  tradingDay: Parameters<typeof getTradingDay>[2];
}

/** Closed trades mapped to the advanced engine shape (no persistence). */
export async function loadAdvancedTrades(
  userId: string,
  accountId?: string,
  period?: AnalyticsQuery["period"]
): Promise<LoadedTrades> {
  const [profile, accounts, prefs] = await Promise.all([
    db.profile.findUnique({ where: { id: userId } }),
    db.account.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    getDisplayPreferences(userId),
  ]);
  const accountFilter =
    accountId != null
      ? (accounts.find((a) => a.id === accountId) ?? null)
      : null;
  const where: Prisma.TradeWhereInput = {
    userId,
    status: "CLOSED",
    isDraft: false,
    ...(accountFilter ? { accountId: accountFilter.id } : {}),
  };
  if (period) {
    const cutoff = periodCutoff(period);
    if (cutoff != null) where.exitTime = { gte: cutoff };
  }
  const rows = await db.trade.findMany({
    where,
    include: TRADE_INCLUDE,
    orderBy: { entryTime: "asc" },
  });
  const timezone = profile?.timezone ?? "UTC";
  const currency = accountFilter?.currency ?? profile?.baseCurrency ?? "USD";

  const timeMap = await computeTimeInProfit(rows);
  const trades: AdvancedTrade[] = rows.map((t) =>
    toAdvancedTrade(t, timezone, prefs.tradingDay, timeMap.get(t.id))
  );
  return { trades, timezone, currency, tradingDay: prefs.tradingDay };
}

function toAdvancedTrade(
  t: Row,
  timezone: string,
  tradingDay: Parameters<typeof getTradingDay>[2],
  time?: { profitMin: number | null; lossMin: number | null }
): AdvancedTrade {
  const exit = t.exitTime ?? t.entryTime;
  // Daily attribution follows the user's TRADING day (default MIDNIGHT_LOCAL
  // = the local calendar day). Weekday/hour stay on the local ENTRY time.
  const tradingDayOfExit = getTradingDay(exit, timezone, tradingDay);
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
  const { mfeR, maeR } = excursionR(
    t.direction,
    t.entryPrice?.toString() ?? null,
    t.mfePrice?.toString() ?? null,
    t.maePrice?.toString() ?? null,
    t.initialStopLoss?.toString() ?? null,
    t.stopLoss?.toString() ?? null
  );
  const liveStrategy = t.strategy?.deletedAt == null ? t.strategy : null;
  return {
    id: t.id,
    exitTime: exit.toISOString(),
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
    localDate: tradingDayOfExit,
    localWeekday: entryLocal?.weekday ?? null,
    localHour: entryLocal?.hour ?? null,
    durationMin,
    customFields: parseCustomFields(t.customFields),
    mfeR,
    maeR,
    takeProfit: t.takeProfit?.toString() ?? null,
    plannedRR: t.plannedRR?.toString() ?? null,
    entryPrice: t.entryPrice?.toString() ?? null,
    initialStopLoss: t.initialStopLoss?.toString() ?? null,
    tags: t.tags.map((tt) => tt.tag.name),
    violationCount: t.ruleViolations.length,
    playbookMatch: t.review?.playbookMatch ?? null,
    riskPercent: t.riskPercent?.toString() ?? null,
    setupQualityRating: t.setupQualityRating,
    localYear: entryLocal != null ? Number(entryLocal.date.slice(0, 4)) : null,
    localMonth: entryLocal?.month ?? null,
    localDayOfMonth: entryLocal?.dayOfMonth ?? null,
    localIsoWeek: entryLocal?.isoWeek ?? null,
    localEntryDate: entryLocal?.date ?? null,
    timeInProfitMin: time?.profitMin ?? null,
    timeInLossMin: time?.lossMin ?? null,
  };
}

/**
 * Time in profit / loss from stored candles (PriceCandle). Per instrument,
 * the finest stored timeframe is used; a trade is covered only when the
 * overlapping candles span at least 80 % of its duration. Returns nulls
 * when there is no candle coverage — never invented. Bounded: skipped
 * entirely above 500 trades, 6 000 candles per instrument max.
 */
async function computeTimeInProfit(
  rows: Row[]
): Promise<Map<string, { profitMin: number | null; lossMin: number | null }>> {
  const out = new Map<string, { profitMin: number | null; lossMin: number | null }>();
  if (rows.length === 0 || rows.length > 500) return out;
  const byInstrument = new Map<string, Row[]>();
  for (const t of rows) {
    if (t.exitTime == null) continue;
    const list = byInstrument.get(t.instrumentId) ?? [];
    list.push(t);
    byInstrument.set(t.instrumentId, list);
  }
  for (const [instrumentId, trades] of byInstrument) {
    try {
      const groups = await db.priceCandle.groupBy({
        by: ["timeframe"],
        where: { instrumentId },
        _count: { _all: true },
      });
      const available = groups
        .map((g) => g.timeframe)
        .filter((tf) => (CANDLE_TIMEFRAMES as readonly string[]).includes(tf))
        .sort((a, b) => TF_MINUTES[a as keyof typeof TF_MINUTES] - TF_MINUTES[b as keyof typeof TF_MINUTES]);
      const chosen = available[0];
      if (!chosen) continue;
      const tfMin = TF_MINUTES[chosen as keyof typeof TF_MINUTES];
      const from = new Date(Math.min(...trades.map((t) => t.entryTime.getTime())));
      const to = new Date(Math.max(...trades.map((t) => (t.exitTime as Date).getTime())));
      const candles = await db.priceCandle.findMany({
        where: {
          instrumentId,
          timeframe: chosen,
          openTime: { gte: from, lte: to },
        },
        orderBy: { openTime: "asc" },
        take: 6000,
      });
      if (candles.length === 0) continue;
      for (const t of trades) {
        const entry = toD(t.entryPrice);
        const long = t.direction === "LONG";
        const exit = t.exitTime as Date;
        const overlapping = candles.filter(
          (c) => c.openTime >= t.entryTime && c.openTime <= exit
        );
        const coveredMin = overlapping.length * tfMin;
        const durationMin = Math.max(
          1,
          Math.round((exit.getTime() - t.entryTime.getTime()) / 60000)
        );
        if (overlapping.length === 0 || coveredMin < 0.8 * durationMin) {
          continue;
        }
        let profitMin = 0;
        let lossMin = 0;
        for (const c of overlapping) {
          const close = toD(c.close);
          const inProfit = long ? close.gt(entry) : close.lt(entry);
          if (inProfit) profitMin += tfMin;
          else lossMin += tfMin;
        }
        out.set(t.id, { profitMin, lossMin });
      }
    } catch {
      // Candle coverage is best-effort: a failure leaves nulls.
      continue;
    }
  }
  return out;
}

/** Persist the computed modules (idempotent, user-scoped). */
async function persistAdvanced(
  userId: string,
  trades: AdvancedTrade[],
  computed: AdvancedAnalytics,
  now: Date
): Promise<void> {
  // Lifecycle rows (only trades with MFE/MAE or candle time data).
  for (const t of trades) {
    if (t.mfeR == null && t.maeR == null && t.timeInProfitMin == null) {
      continue;
    }
    await db.tradeLifecycleStats.upsert({
      where: { tradeId: t.id },
      update: {
        mfeR: t.mfeR != null ? toD(t.mfeR) : null,
        maeR: t.maeR != null ? toD(t.maeR) : null,
        timeInProfitMin: t.timeInProfitMin,
        timeInLossMin: t.timeInLossMin,
        almostTp: isAlmostTp(t),
        computedAt: now,
      },
      create: {
        tradeId: t.id,
        userId,
        mfeR: t.mfeR != null ? toD(t.mfeR) : null,
        maeR: t.maeR != null ? toD(t.maeR) : null,
        timeInProfitMin: t.timeInProfitMin,
        timeInLossMin: t.timeInLossMin,
        almostTp: isAlmostTp(t),
        computedAt: now,
      },
    });
  }

  // Today's score snapshot.
  if (trades.length > 0) {
    const day = utcDay(now);
    const s = computed.score;
    await db.traderScoreSnapshot.upsert({
      where: { userId_date: { userId, date: day } },
      update: {
        score: s.total,
        discipline: s.components.discipline,
        edge: s.components.edge,
        consistency: s.components.consistency,
        risk: s.components.risk,
        tradeCount: s.trades,
      },
      create: {
        userId,
        date: day,
        score: s.total,
        discipline: s.components.discipline,
        edge: s.components.edge,
        consistency: s.components.consistency,
        risk: s.components.risk,
        tradeCount: s.trades,
      },
    });
  }

  // Anomalies: refresh the rows for the trades in scope.
  const tradeIds = trades.map((t) => t.id);
  if (tradeIds.length > 0) {
    await db.tradeAnomaly.deleteMany({
      where: { userId, tradeId: { in: tradeIds } },
    });
    if (computed.anomalies.anomalies.length > 0) {
      await db.tradeAnomaly.createMany({
        data: computed.anomalies.anomalies.map((a) => ({
          tradeId: a.tradeId,
          userId,
          kind: a.kind,
          severity: a.severity,
          zScore: toD(a.zScore),
        })),
      });
    }
  }
}

export async function getAdvancedAnalytics(
  userId: string,
  query: AnalyticsQuery
): Promise<AdvancedAnalyticsPayload> {
  const { trades, timezone, currency, tradingDay } = await loadAdvancedTrades(
    userId,
    query.account ?? undefined,
    query.period
  );
  const stats = computeTradeStats(trades, {
    dayOf: tradingDayOfTrade(timezone, tradingDay),
  });
  const advancedStats = computeAdvancedStats(trades, stats);
  const computed = computeAdvancedAnalytics(trades, stats, advancedStats);
  const now = new Date();
  try {
    await persistAdvanced(userId, trades, computed, now);
  } catch (error) {
    // Persistence must never break the read path.
    console.error("[advanced-analytics] persist failed", error);
  }
  return {
    period: query.period,
    accountId: query.account ?? null,
    currency,
    timezone,
    advanced: computed,
  };
}

/**
 * Daily cron: freeze today's trader score snapshot for every user with
 * closed trades. Idempotent (upsert on [userId, date]). Returns the number
 * of snapshots written.
 */
export async function recordDailyTraderScores(
  now: Date = new Date()
): Promise<{ users: number; snapshots: number }> {
  const users = await db.user.findMany({ select: { id: true } });
  let snapshots = 0;
  const day = utcDay(now);
  for (const u of users) {
    try {
      const { trades } = await loadAdvancedTrades(u.id);
      if (trades.length === 0) continue;
      const stats = computeTradeStats(trades);
      const advancedStats = computeAdvancedStats(trades, stats);
      const score = computeTraderScore(trades, stats, advancedStats);
      await db.traderScoreSnapshot.upsert({
        where: { userId_date: { userId: u.id, date: day } },
        update: {
          score: score.total,
          discipline: score.components.discipline,
          edge: score.components.edge,
          consistency: score.components.consistency,
          risk: score.components.risk,
          tradeCount: score.trades,
        },
        create: {
          userId: u.id,
          date: day,
          score: score.total,
          discipline: score.components.discipline,
          edge: score.components.edge,
          consistency: score.components.consistency,
          risk: score.components.risk,
          tradeCount: score.trades,
        },
      });
      snapshots += 1;
    } catch (error) {
      console.error("[advanced-analytics] daily score failed", u.id, error);
    }
  }
  return { users: users.length, snapshots };
}
