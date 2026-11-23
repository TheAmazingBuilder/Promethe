/**
 * Advanced analytics aggregation (v2.5 Module 6, Prompt 6) — powers
 * /analytics/lifecycle, /exits, /quality, /setups, /confluences, /sequences,
 * /seasonality and /anomalies: lifecycle (MFE/MAE, almost-TP, time in
 * profit/loss from stored candles), exit analysis, trader score, setup
 * ranking, sequences, seasonality and anomaly detection over CLOSED
 * non-draft trades.
 *
 * Trader score (Phase 2 perf): the headline score is served from
 * today's TraderScoreSnapshot when present (frozen daily value, one
 * indexed read) and recomputed only when it is missing; the history is
 * built from the snapshots (last one of each month) instead of the
 * O(months x N) monthly replay.
 *
 * Persistence (idempotent, user-scoped, Phase 2 perf): the GET handler
 * only writes when the stored rows actually differ — a read-only visit
 * writes nothing — and only for the modules it computed. Lifecycle rows,
 * today's TraderScoreSnapshot and the TradeAnomaly rows stay in sync
 * with the live computation. The daily cron calls recordDailyTraderScores
 * for every user instead.
 *
 * Timezone: entry/exit local parts are computed here in the user's profile
 * timezone via the charts server module (same convention as analytics).
 */
import { db } from "@/lib/db";
import {
  computeAdvancedAnalytics,
  computeAdvancedAnalyticsModules,
  computeScoreHistory,
  computeTraderScore,
  isAlmostTp,
  scoreGrade,
  type AdvancedAnalytics,
  type AdvancedTrade,
  type ScoreHistoryPoint,
} from "@/lib/analytics/advanced";
import { ADVANCED_MODULES } from "@/lib/validations/analytics";
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
import { scopeTradesToCurrency } from "@/lib/analytics/currency-scope";
import { unstable_cache } from "next/cache";

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
  excludedTradeCount: number;
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

  // Historical P&L keeps the currency recorded on each trade. An account
  // may have changed its display currency since those trades were closed.
  const scoped = scopeTradesToCurrency(rows, currency);
  const timeMap = await computeTimeInProfit(scoped.trades);
  const trades: AdvancedTrade[] = scoped.trades.map((t) =>
    toAdvancedTrade(t, timezone, prefs.tradingDay, timeMap.get(t.id))
  );
  return {
    trades,
    timezone,
    currency,
    tradingDay: prefs.tradingDay,
    excludedTradeCount: scoped.excludedTradeCount,
  };
}

/**
 * Phase 2 perf — short server cache (45 s) for the closed-trade load.
 * Keyed by user + account + period: one user's data is never served to
 * another. Shared by the advanced endpoint, the weekly plan and the
 * performance report, so the same scope loads once per 45 s window
 * instead of once per tab/widget. The daily cron keeps the uncached
 * loader (it must freeze fresh values).
 */
const loadAdvancedTradesCachedInner = unstable_cache(
  async (
    userId: string,
    accountId: string | undefined,
    period: AnalyticsQuery["period"] | undefined
  ) => loadAdvancedTrades(userId, accountId, period),
  ["advanced-trades"],
  { revalidate: 45 }
);

export async function loadAdvancedTradesCached(
  userId: string,
  accountId?: string,
  period?: AnalyticsQuery["period"]
): Promise<LoadedTrades> {
  try {
    return await loadAdvancedTradesCachedInner(userId, accountId, period);
  } catch {
    // unstable_cache needs a Next request scope (route handlers); outside
    // one (tests, scripts) fall back to the direct load — same data, no
    // cache. A DB failure still throws from the direct load below.
    return loadAdvancedTrades(userId, accountId, period);
  }
}

/**
 * Zero-trade shells for modules the client did not request: structurally
 * valid, computed the same way as a real empty result (never invented).
 */
const EMPTY_ADVANCED: AdvancedAnalytics = (() => {
  const stats = computeTradeStats([]);
  return computeAdvancedAnalytics([], stats, computeAdvancedStats([], stats));
})();

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
    grade: t.grade,
    // MRT wave 1 — confluences are Tag rows with kind CONFLUENCE (see
    // src/lib/trading/confluences.ts). Soft-deleted tags are excluded so a
    // trashed confluence never feeds the hit-rate table.
    confluenceTags: t.tags
      .filter((tt) => tt.tag.kind === "CONFLUENCE" && tt.tag.deletedAt == null)
      .map((tt) => ({ id: tt.tag.id, name: tt.tag.name, color: tt.tag.color })),
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

/**
 * Persist the computed modules — only when the stored rows actually
 * differ (a read-only visit writes nothing). Only the modules that were
 * computed are persisted: lifecycle rows come from the trades themselves,
 * the score snapshot needs the score module, the anomaly rows need the
 * anomalies module.
 *
 * Score components are stored as Int (schema): the computed 1-decimal
 * values are rounded before the comparison and the write, so a stored
 * snapshot compares equal on the next visit instead of looking changed
 * forever. (Previously the raw floats were written — rejected by the
 * Int columns — and the failure was swallowed by the caller's try/catch,
 * so snapshots were never stored.)
 */
async function persistAdvanced(
  userId: string,
  trades: AdvancedTrade[],
  computed: Partial<AdvancedAnalytics>,
  now: Date,
  persistGlobalScore: boolean
): Promise<void> {
  // Lifecycle rows (only trades with MFE/MAE or candle time data).
  const withData = trades.filter(
    (t) => t.mfeR != null || t.maeR != null || t.timeInProfitMin != null
  );
  if (withData.length > 0) {
    const existing = await db.tradeLifecycleStats.findMany({
      where: { userId, tradeId: { in: withData.map((t) => t.id) } },
      select: {
        tradeId: true,
        mfeR: true,
        maeR: true,
        timeInProfitMin: true,
        timeInLossMin: true,
        almostTp: true,
      },
    });
    const prevById = new Map(existing.map((r) => [r.tradeId, r]));
    for (const t of withData) {
      const next = {
        mfeR: t.mfeR != null ? toD(t.mfeR) : null,
        maeR: t.maeR != null ? toD(t.maeR) : null,
        timeInProfitMin: t.timeInProfitMin,
        timeInLossMin: t.timeInLossMin,
        almostTp: isAlmostTp(t),
      };
      const prev = prevById.get(t.id);
      if (
        prev != null &&
        (prev.mfeR?.toString() ?? null) === (next.mfeR?.toString() ?? null) &&
        (prev.maeR?.toString() ?? null) === (next.maeR?.toString() ?? null) &&
        prev.timeInProfitMin === next.timeInProfitMin &&
        prev.timeInLossMin === next.timeInLossMin &&
        prev.almostTp === next.almostTp
      ) {
        continue;
      }
      await db.tradeLifecycleStats.upsert({
        where: { tradeId: t.id },
        update: { ...next, computedAt: now },
        create: { tradeId: t.id, userId, ...next, computedAt: now },
      });
    }
  }

  // Today's score snapshot (only when the score module was computed).
  if (persistGlobalScore && computed.score != null && trades.length > 0) {
    const day = utcDay(now);
    const s = computed.score;
    const components = {
      discipline: Math.round(s.components.discipline),
      edge: Math.round(s.components.edge),
      consistency: Math.round(s.components.consistency),
      risk: Math.round(s.components.risk),
    };
    const prev = await db.traderScoreSnapshot.findUnique({
      where: { userId_date: { userId, date: day } },
    });
    if (
      prev == null ||
      prev.score !== s.total ||
      prev.discipline !== components.discipline ||
      prev.edge !== components.edge ||
      prev.consistency !== components.consistency ||
      prev.risk !== components.risk ||
      prev.tradeCount !== s.trades
    ) {
      await db.traderScoreSnapshot.upsert({
        where: { userId_date: { userId, date: day } },
        update: { score: s.total, ...components, tradeCount: s.trades },
        create: {
          userId,
          date: day,
          score: s.total,
          ...components,
          tradeCount: s.trades,
        },
      });
    }
  }

  // Anomalies: refresh the rows for the trades in scope, only when the
  // computed set differs from the stored one.
  if (computed.anomalies != null) {
    const tradeIds = trades.map((t) => t.id);
    if (tradeIds.length > 0) {
      const key = (r: {
        tradeId: string;
        kind: string;
        severity: string;
        zScore: { toString(): string } | number;
      }): string =>
        `${r.tradeId}|${r.kind}|${r.severity}|${Number(r.zScore.toString())}`;
      const existing = await db.tradeAnomaly.findMany({
        where: { userId, tradeId: { in: tradeIds } },
        select: { tradeId: true, kind: true, severity: true, zScore: true },
      });
      const prevKeys = new Set(existing.map(key));
      const next = computed.anomalies.anomalies;
      const changed =
        prevKeys.size !== next.length ||
        next.some((a) => !prevKeys.has(key(a)));
      if (changed) {
        await db.tradeAnomaly.deleteMany({
          where: { userId, tradeId: { in: tradeIds } },
        });
        if (next.length > 0) {
          await db.tradeAnomaly.createMany({
            data: next.map((a) => ({
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
  }
}

export async function getAdvancedAnalytics(
  userId: string,
  query: AnalyticsQuery
): Promise<AdvancedAnalyticsPayload> {
  const modules = query.module != null ? [query.module] : [...ADVANCED_MODULES];
  const { trades, timezone, currency, tradingDay, excludedTradeCount } =
    await loadAdvancedTradesCached(
      userId,
      query.account ?? undefined,
      query.period
    );
  const stats = computeTradeStats(trades, {
    dayOf: tradingDayOfTrade(timezone, tradingDay),
  });
  const advancedStats = computeAdvancedStats(trades, stats);
  const computed = computeAdvancedAnalyticsModules(
    trades,
    stats,
    advancedStats,
    modules
  );
  const now = new Date();
  // Phase 2 perf — trader score from the daily snapshot: the headline
  // score is the frozen value of the day (one indexed read), recomputed
  // only when today's snapshot is missing. The details below the score
  // still describe the currently loaded trades. History comes from the
  // snapshots (last one of each month) instead of the O(months x N)
  // monthly replay; when today's snapshot is missing, the current
  // month's point is the freshly computed score (same >= 3 trades bar
  // as the replay).
  if (modules.includes("score") && computed.score != null) {
    // Snapshots are intentionally user-global (the daily cron computes all
    // accounts together). Never apply a global snapshot to a filtered account,
    // and never let an account-scoped request overwrite that global row.
    if (query.account != null) {
      computed.scoreHistory = computeScoreHistory(trades);
    } else {
      const [history, today] = await Promise.all([
        loadScoreHistoryFromSnapshots(userId),
        db.traderScoreSnapshot.findUnique({
          where: { userId_date: { userId, date: utcDay(now) } },
        }),
      ]);
      if (today != null) {
        computed.score = {
          ...computed.score,
          total: today.score,
          grade: scoreGrade(today.score),
          components: {
            discipline: today.discipline,
            edge: today.edge,
            consistency: today.consistency,
            risk: today.risk,
          },
          trades: today.tradeCount,
        };
      }
      const currentMonth = now.toISOString().slice(0, 7);
      if (
        today == null &&
        computed.score.trades >= 3 &&
        !history.some((p) => p.month === currentMonth)
      ) {
        history.push({
          month: currentMonth,
          score: computed.score.total,
          trades: computed.score.trades,
        });
        history.sort((a, b) => a.month.localeCompare(b.month));
      }
        computed.scoreHistory = history;
    }
  }
  try {
    await persistAdvanced(userId, trades, computed, now, query.account == null);
  } catch (error) {
    // Persistence must never break the read path.
    console.error("[advanced-analytics] persist failed", error);
  }
  return {
    period: query.period,
    accountId: query.account ?? null,
    currency,
    timezone,
    excludedTradeCount,
    advanced: { ...EMPTY_ADVANCED, ...computed },
  };
}

/**
 * Phase 2 perf — score history from the daily TraderScoreSnapshot rows:
 * the last snapshot of each month (one indexed read, no monthly replay
 * over the whole history). Months without any snapshot have no point —
 * nothing is invented. The daily cron and the advanced endpoint keep
 * the snapshots fed (see persistAdvanced / recordDailyTraderScores).
 */
export async function loadScoreHistoryFromSnapshots(
  userId: string
): Promise<ScoreHistoryPoint[]> {
  const rows = await db.traderScoreSnapshot.findMany({
    where: { userId },
    orderBy: { date: "asc" },
    select: { date: true, score: true, tradeCount: true },
  });
  const byMonth = new Map<string, ScoreHistoryPoint>();
  for (const r of rows) {
    byMonth.set(r.date.toISOString().slice(0, 7), {
      month: r.date.toISOString().slice(0, 7),
      score: r.score,
      trades: r.tradeCount,
    });
  }
  return [...byMonth.values()].sort((a, b) =>
    a.month.localeCompare(b.month)
  );
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
      // Components are stored as Int (schema): round the 1-decimal
      // computed values, same fix as persistAdvanced.
      const components = {
        discipline: Math.round(score.components.discipline),
        edge: Math.round(score.components.edge),
        consistency: Math.round(score.components.consistency),
        risk: Math.round(score.components.risk),
      };
      await db.traderScoreSnapshot.upsert({
        where: { userId_date: { userId: u.id, date: day } },
        update: {
          score: score.total,
          ...components,
          tradeCount: score.trades,
        },
        create: {
          userId: u.id,
          date: day,
          score: score.total,
          ...components,
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
