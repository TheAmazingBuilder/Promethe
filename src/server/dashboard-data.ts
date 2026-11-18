/**
 * Dashboard widget data loader (v2.5 Module 1, spec §4.4).
 *
 * One POST /api/v1/dashboards/[id]/data call resolves EVERY widget of a
 * dashboard: the closed-trade dataset is fetched ONCE (rich rows reused by
 * the analytics engine AND the custom-metric evaluator), then each widget
 * gets its period resolved (global filter + per-widget override), its
 * account scope (override ?? global) and its typed payload. Failures are
 * isolated per widget ({ data: null, error: code }) — one broken widget
 * never blanks the whole dashboard.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { D0, Decimal, toD } from "@/lib/trading/dec";
import {
  computeEquityCurve,
  computeTradeStats,
  sortChronologically,
  type EquityPoint,
  type GroupStat,
  type StatTrade,
  type TradeStats,
} from "@/lib/analytics/engine";
import {
  computeAdvancedStats,
  computeBreakdowns,
  computeRDistribution,
  weekdayOfIsoDate,
  type AdvancedStats,
  type AnalyticsTrade,
  type RDistBucket,
} from "@/lib/analytics/insights";
import {
  buildMonthGrid,
  computeMonthSummary,
  isoDayBetween,
  monthBounds,
  type CalendarDay,
  type MonthSummary,
} from "@/lib/analytics/calendar";
import { applyComparePeriod, applyPeriod, resolvePeriod } from "@/lib/dashboard/period";
import {
  customMetricConfigSchema,
  getWidgetDefinition,
  nextNewsConfigSchema,
  pnlCalendarConfigSchema,
  recentTradesConfigSchema,
} from "@/lib/dashboard/registry";
import type {
  DashboardWidgetDTO,
  PeriodPreset,
  ResolvedPeriod,
} from "@/lib/dashboard/types";
import {
  evaluateMetric,
  type MetricDefinition,
  type MetricTrade,
} from "@/lib/metrics/evaluator";
import type { OpenPositionDTO, TradeListItemDTO } from "@/lib/trading/dto";
import { toTradeListItem } from "@/server/trades";
import { getDisplayPreferences } from "@/server/display-preferences";
import {
  getTradingDay,
  tradingDayOfTrade,
  type TradingDaySettings,
} from "@/lib/time/trading-day";
import { getPropStatus } from "@/server/prop-status";
import { getSyncOverview } from "@/server/broker-sync";
import { listGoalsWithProgress } from "@/server/goals";
import { recentViolations } from "@/server/rules";
import { DashboardValidationError } from "@/server/dashboards";
import { toDashboardDTO } from "@/server/dashboards";

// ── Requirements (feature prerequisites, registry "requires") ────────────────

export interface Requirements {
  prop: boolean;
  news: boolean;
  sync: boolean;
  goals: boolean;
  metrics: boolean;
  savedCharts: boolean;
}

export async function getRequirements(userId: string): Promise<Requirements> {
  const now = new Date();
  const [prop, news, sync, activeGoal, rule, metric] = await Promise.all([
    db.propChallenge.findFirst({
      where: { userId, status: "IN_PROGRESS" },
      select: { id: true },
    }),
    db.economicEvent.findFirst({
      where: { scheduledAt: { gte: now }, OR: [{ userId: null }, { userId }] },
      select: { id: true },
    }),
    db.brokerConnection.findFirst({
      where: { userId, status: { not: "REVOKED" } },
      select: { id: true },
    }),
    db.goal.findFirst({ where: { userId, status: "ACTIVE" }, select: { id: true } }),
    db.tradingRule.findFirst({ where: { userId }, select: { id: true } }),
    db.customMetric.findFirst({ where: { userId }, select: { id: true } }),
  ]);
  return {
    prop: prop != null,
    news: news != null,
    sync: sync != null,
    goals: activeGoal != null || rule != null,
    metrics: metric != null,
    savedCharts: (await db.savedChart.count({ where: { userId } })) > 0,
  };
}

// ── Payload types ────────────────────────────────────────────────────────────

export interface DashboardWidgetDataPayload {
  currency: string;
  timezone: string;
  /** ISO production instant. */
  generatedAt: string;
  widgets: Record<string, { data: unknown | null; error: string | null }>;
  requirements: Requirements;
}

export interface KpiExtras {
  totalPips: string | null;
  avgRiskPercent: string | null;
  reviewedPercent: string | null;
  currentDrawdown: string;
  bestTrade: string | null;
  worstTrade: string | null;
  tradingDays: number;
}

export interface KpiBlock {
  stats: TradeStats;
  advanced: AdvancedStats;
  extras: KpiExtras;
}

export interface KpiWidgetData extends KpiBlock {
  compare: KpiBlock | null;
  /** Cumulative net P&L per trade, chronological - mini equity curve used
      for the KPI sparklines (capped at 30 points). */
  sparkline: string[];
}

export interface CurveWidgetData {
  curve: EquityPoint[];
  initialBalance: string;
}

export interface CalendarCellDTO {
  date: string;
  inMonth: boolean;
  netPnl: string;
  tradeCount: number;
}

export interface PnlCalendarWidgetData {
  months: Array<{ year: number; month: number; grid: CalendarCellDTO[][]; summary: MonthSummary }>;
}

export interface NewsEventDTO {
  id: string;
  title: string;
  currency: string;
  impact: string;
  category: string;
  scheduledAt: string;
}

export interface CustomMetricWidgetData {
  name: string;
  format: string;
  value: string | null;
  sampleSize: number;
  lowSample: boolean;
}

// ── Trade dataset ────────────────────────────────────────────────────────────

const TRADE_INCLUDE = {
  instrument: true,
  account: true,
  strategy: true,
  tags: { include: { tag: true } },
} as const;

type TradeRow = Prisma.TradeGetPayload<{ include: typeof TRADE_INCLUDE }>;
type AccountRow = Prisma.AccountGetPayload<Record<string, never>>;

/**
 * Closed trade carrying every dimension the widget loaders need: the StatTrade
 * subset (engine), the AnalyticsTrade extensions (insights) and the
 * MetricTrade fields (custom-metric evaluator) — plus the raw row for the
 * list-item DTOs.
 */
interface DashboardTrade extends AnalyticsTrade {
  /** Narrowed from StatTrade's optional - always set by the mapper below. */
  strategyName: string | null;
  pips: string | null;
  riskPercent: string | null;
  tags: string[];
  row: TradeRow;
}

/** Local calendar parts in `timezone` - null on invalid TZ (same as analytics). */
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

function toDashboardTrade(
  t: TradeRow,
  timezone: string,
  tradingDay: TradingDaySettings
): DashboardTrade {
  const exit = t.exitTime ?? t.entryTime;
  // Daily attribution follows the user's TRADING day (default MIDNIGHT_LOCAL
  // = the local calendar day). Weekday/hour stay on the local ENTRY time.
  const tradingDayOfExit = getTradingDay(exit, timezone, tradingDay);
  const entryLocal = localParts(t.entryTime, timezone);
  return {
    id: t.id,
    exitTime: exit.toISOString(),
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
    localWeekday:
      entryLocal != null ? weekdayOfIsoDate(entryLocal.date) : null,
    localHour: entryLocal?.hour ?? null,
    durationMin:
      t.exitTime != null
        ? Math.max(
            0,
            Math.round(
              (t.exitTime.getTime() - t.entryTime.getTime()) / (60 * 1000)
            )
          )
        : null,
    pips: t.pips?.toString() ?? null,
    riskPercent: t.riskPercent?.toString() ?? null,
    tags: t.tags.map((tt) => tt.tag.name),
    row: t,
  };
}

function toOpenPositionDTO(t: TradeRow): OpenPositionDTO {
  return {
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
  };
}

// ── Config parsing (typed, defaults on corruption) ───────────────────────────

interface SafeParseLike<T> {
  safeParse: (data: unknown) => { success: true; data: T } | { success: false };
}

function widgetConfig<T>(
  config: unknown,
  schema: SafeParseLike<T>,
  fallback: T
): T {
  const result = schema.safeParse(config ?? {});
  return result.success ? result.data : fallback;
}

// ── KPI blocks ───────────────────────────────────────────────────────────────

function computeKpiExtras(sample: DashboardTrade[], stats: TradeStats): KpiExtras {
  const pips = sample
    .filter((t) => t.pips != null)
    .map((t) => toD(t.pips!));
  const risks = sample
    .filter((t) => t.riskPercent != null)
    .map((t) => toD(t.riskPercent!));
  const pnls = sample.map((t) => toD(t.netPnl ?? 0));
  const reviewed = sample.filter(
    (t) => t.row.reviewStatus === "REVIEWED"
  ).length;

  // Current drawdown: distance of the final cumulative P&L from its running
  // peak (same basis as the equity curve's per-point `drawdown`).
  let cum = D0;
  let peak = D0;
  for (const t of sortChronologically(sample)) {
    cum = cum.plus(toD(t.netPnl ?? 0));
    if (cum.gt(peak)) peak = cum;
  }
  const drawdown = Decimal.max(D0, peak.minus(cum));

  return {
    totalPips: pips.length === 0 ? null : pips.reduce((a, b) => a.plus(b), D0).toString(),
    avgRiskPercent:
      risks.length === 0
        ? null
        : risks.reduce((a, b) => a.plus(b), D0).div(risks.length).toString(),
    reviewedPercent:
      sample.length === 0
        ? null
        : new Decimal(reviewed).div(sample.length).times(100).toString(),
    currentDrawdown: drawdown.toString(),
    bestTrade: pnls.length === 0 ? null : Decimal.max(...pnls).toString(),
    worstTrade: pnls.length === 0 ? null : Decimal.min(...pnls).toString(),
    tradingDays: stats.tradingDays,
  };
}

function computeKpiBlock(
  sample: DashboardTrade[],
  dayOf: (t: StatTrade) => string
): KpiBlock {
  const stats = computeTradeStats(sample, { dayOf });
  return {
    stats,
    advanced: computeAdvancedStats(sample, stats),
    extras: computeKpiExtras(sample, stats),
  };
}

/** Cumulative net P&L per trade, chronological, capped at 30 points
    (downsampled, always keeping the final point). */
function computeSparkline(sample: DashboardTrade[]): string[] {
  let cum = D0;
  const points = sortChronologically(sample).map((t) => {
    cum = cum.plus(toD(t.netPnl ?? 0));
    return cum.toString();
  });
  if (points.length <= 30) return points;
  const step = Math.ceil(points.length / 30);
  const down = points.filter((_, i) => i % step === 0);
  if (down[down.length - 1] !== points[points.length - 1]) {
    down.push(points[points.length - 1]);
  }
  return down;
}

// ── Journal prompts (deterministic daily rotation) ───────────────────────────

const JOURNAL_PROMPTS: readonly string[] = [
  "What was your emotional state before your best trade today?",
  "Which setup are you executing best this week, and why?",
  "Did you follow your trading plan on every trade today?",
  "What is one mistake you keep repeating, and what will you change?",
  "How did market conditions match your strategy today?",
  "What would you do differently on your worst trade today?",
  "Were you distracted at any point during your session?",
  "Which rule protected you from a bad trade recently?",
  "How confident were you in your last trade, on a scale of 1 to 5?",
  "What is your main focus for tomorrow's session?",
  "Did position sizing match your risk plan today?",
  "What did the market teach you today?",
];

function dayOfYear(isoDay: string): number {
  const date = Date.parse(`${isoDay}T00:00:00Z`);
  const yearStart = Date.parse(`${isoDay.slice(0, 4)}-01-01T00:00:00Z`);
  if (!Number.isFinite(date) || !Number.isFinite(yearStart)) return 1;
  return Math.floor((date - yearStart) / 86_400_000) + 1;
}

// ── Custom metric definition guard (stored JSON → evaluator input) ──────────

function isMetricDefinition(value: unknown): value is MetricDefinition {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.aggregate === "string" && Array.isArray(v.filterGroups)
  );
}

// ── Widget loaders ───────────────────────────────────────────────────────────

interface WidgetContext {
  userId: string;
  currency: string;
  timezone: string;
  accounts: AccountRow[];
  /** strategy name → color (strategy-table merge, same as getDashboard). */
  strategyColors: Map<string, string>;
  /** Trading-day key function for day-bucketed widgets (KPI "trading days",
   * P&L calendar, journal prompt). */
  dayOf: (t: StatTrade) => string;
  /** Today's TRADING day (journal prompt, P&L calendar month window). */
  todayTradingDay: string;
}

async function computeWidgetData(
  ctx: WidgetContext,
  widget: DashboardWidgetDTO,
  account: AccountRow | null,
  scoped: DashboardTrade[],
  sample: DashboardTrade[],
  period: ResolvedPeriod
): Promise<unknown> {
  switch (widget.type) {
    case "kpi-strip":
    case "single-kpi":
    case "period-compare": {
      const compareSample =
        widget.periodOverride?.compareToPrevious === true &&
        period.compareFrom != null
          ? applyComparePeriod(scoped, period)
          : null;
      const data: KpiWidgetData = {
        ...computeKpiBlock(sample, ctx.dayOf),
        compare:
          compareSample != null
            ? computeKpiBlock(compareSample, ctx.dayOf)
            : null,
        sparkline: computeSparkline(sample),
      };
      return data;
    }

    case "equity-curve":
    case "drawdown-curve": {
      // Curve convention (dashboard.ts): accounts in the profile currency —
      // or the single filtered account when one is active.
      const curveAccounts =
        account != null
          ? [account]
          : ctx.accounts.filter((a) => a.currency === ctx.currency);
      const initialBalance = curveAccounts.reduce(
        (acc, a) => acc.plus(toD(a.initialBalance)),
        D0
      );
      const curveAccountIds = new Set(curveAccounts.map((a) => a.id));
      const curveTrades = sample.filter((t) =>
        curveAccountIds.has(t.accountId)
      );
      const data: CurveWidgetData = {
        curve: computeEquityCurve(curveTrades, initialBalance),
        initialBalance: initialBalance.toString(),
      };
      return data;
    }

    case "pnl-calendar": {
      const { months: monthCount } = widgetConfig(
        widget.config,
        pnlCalendarConfigSchema,
        { months: 1 }
      );
      // Local-day buckets (P&L attribution on the local exit day).
      const daily = new Map<
        string,
        { pnl: Decimal; count: number; wins: number; losses: number; rSum: Decimal; rCount: number }
      >();
      for (const t of sample) {
        const day = t.localDate ?? t.exitTime.slice(0, 10);
        const bucket = daily.get(day) ?? {
          pnl: D0,
          count: 0,
          wins: 0,
          losses: 0,
          rSum: D0,
          rCount: 0,
        };
        const pnl = toD(t.netPnl ?? 0);
        bucket.pnl = bucket.pnl.plus(pnl);
        bucket.count += 1;
        if (pnl.gt(0)) bucket.wins += 1;
        else if (pnl.lt(0)) bucket.losses += 1;
        if (t.rMultiple != null) {
          bucket.rSum = bucket.rSum.plus(toD(t.rMultiple));
          bucket.rCount += 1;
        }
        daily.set(day, bucket);
      }

      const todayLocal = ctx.todayTradingDay;
      let y = Number(todayLocal.slice(0, 4));
      let m = Number(todayLocal.slice(5, 7));
      for (let i = 1; i < monthCount; i++) {
        m -= 1;
        if (m === 0) {
          m = 12;
          y -= 1;
        }
      }

      const months: PnlCalendarWidgetData["months"] = [];
      for (let i = 0; i < monthCount; i++) {
        const { first, last } = monthBounds(y, m);
        const days: CalendarDay[] = [...daily.entries()]
          .filter(([day]) => isoDayBetween(day, first, last))
          .map(([day, v]) => ({
            date: day,
            netPnl: v.pnl.toString(),
            tradeCount: v.count,
            wins: v.wins,
            losses: v.losses,
            totalR: v.rCount > 0 ? v.rSum.toString() : null,
            hasJournal: false,
          }));
        const grid = buildMonthGrid(y, m).map((week) =>
          week.map((cell) => {
            const bucket = daily.get(cell.date);
            const cellDto: CalendarCellDTO = {
              date: cell.date,
              inMonth: cell.inMonth,
              netPnl: bucket ? bucket.pnl.toString() : "0",
              tradeCount: bucket ? bucket.count : 0,
            };
            return cellDto;
          })
        );
        months.push({ year: y, month: m, grid, summary: computeMonthSummary(days) });
        m += 1;
        if (m === 13) {
          m = 1;
          y += 1;
        }
      }
      const data: PnlCalendarWidgetData = { months };
      return data;
    }

    case "open-trades": {
      const openRows = await db.trade.findMany({
        where: {
          userId: ctx.userId,
          status: "OPEN",
          isDraft: false,
          ...(account != null ? { accountId: account.id } : {}),
        },
        include: TRADE_INCLUDE,
        orderBy: { entryTime: "desc" },
      });
      return { openPositions: openRows.map(toOpenPositionDTO) };
    }

    case "recent-trades": {
      const { limit } = widgetConfig(
        widget.config,
        recentTradesConfigSchema,
        { limit: 6 }
      );
      const recent = [...sample]
        .sort(
          (a, b) =>
            b.entryTime.localeCompare(a.entryTime) || b.id.localeCompare(a.id)
        )
        .slice(0, limit);
      const trades: TradeListItemDTO[] = recent.map((t) => toTradeListItem(t.row));
      return { trades };
    }

    case "session-performance":
    case "weekday-performance":
    case "hour-performance": {
      const breakdowns = computeBreakdowns(sample);
      const groups: GroupStat[] =
        widget.type === "session-performance"
          ? breakdowns.session
          : widget.type === "weekday-performance"
            ? breakdowns.weekday
            : breakdowns.hour;
      return { groups };
    }

    case "strategy-table": {
      const breakdowns = computeBreakdowns(sample);
      const groups: Array<GroupStat & { color: string }> =
        breakdowns.strategy.map((g) => ({
          ...g,
          color: ctx.strategyColors.get(g.key) ?? "#64748b",
        }));
      return { groups };
    }

    case "instrument-table": {
      const breakdowns = computeBreakdowns(sample);
      const groups: GroupStat[] = breakdowns.symbol;
      return { groups };
    }

    case "r-histogram": {
      const distribution: { buckets: RDistBucket[]; withoutR: number } =
        computeRDistribution(sample);
      return { buckets: distribution };
    }

    case "win-loss": {
      const stats = computeTradeStats(sample);
      return {
        wins: stats.wins,
        losses: stats.losses,
        breakevens: stats.breakevens,
      };
    }

    case "streak": {
      const stats = computeTradeStats(sample);
      return {
        current: stats.currentStreak,
        maxWin: stats.maxWinStreak,
        maxLoss: stats.maxLossStreak,
      };
    }

    case "goals-progress": {
      const [goalsPayload, violations] = await Promise.all([
        listGoalsWithProgress(ctx.userId),
        recentViolations(ctx.userId, 30),
      ]);
      return { goals: goalsPayload.goals, violations };
    }

    case "journal-prompt": {
      const todayLocal = ctx.todayTradingDay;
      const entry = await db.journalEntry.findFirst({
        where: { userId: ctx.userId, date: todayLocal },
        select: { id: true },
      });
      return {
        prompt: JOURNAL_PROMPTS[dayOfYear(todayLocal) % JOURNAL_PROMPTS.length],
        hasEntryToday: entry != null,
      };
    }

    case "review-queue": {
      const accountFilter = account != null ? { accountId: account.id } : {};
      const [toReviewCount, draftCount] = await Promise.all([
        db.trade.count({
          where: {
            userId: ctx.userId,
            reviewStatus: "NOT_REVIEWED",
            isDraft: false,
            ...accountFilter,
          },
        }),
        db.trade.count({
          where: { userId: ctx.userId, isDraft: true, ...accountFilter },
        }),
      ]);
      return { toReviewCount, draftCount };
    }

    case "next-news": {
      const { limit } = widgetConfig(widget.config, nextNewsConfigSchema, {
        limit: 5,
      });
      const events = await db.economicEvent.findMany({
        where: {
          scheduledAt: { gte: new Date() },
          impact: "HIGH",
          OR: [{ userId: null }, { userId: ctx.userId }],
        },
        orderBy: { scheduledAt: "asc" },
        take: limit,
      });
      const dto: NewsEventDTO[] = events.map((e) => ({
        id: e.id,
        title: e.title,
        currency: e.currency,
        impact: e.impact,
        category: e.category,
        scheduledAt: e.scheduledAt.toISOString(),
      }));
      return { events: dto };
    }

    case "prop-status": {
      const payload = await getPropStatus(ctx.userId, account?.id);
      return { status: payload ?? { account: null, status: null } };
    }

    case "sync-status": {
      return { overview: await getSyncOverview(ctx.userId) };
    }

    case "custom-metric": {
      const { metricId } = widgetConfig(widget.config, customMetricConfigSchema, {
        metricId: "",
      });
      if (!metricId) {
        throw new DashboardValidationError("METRIC_NOT_FOUND", 422);
      }
      const metric = await db.customMetric.findFirst({
        where: { id: metricId, userId: ctx.userId },
      });
      if (!metric) {
        throw new DashboardValidationError("METRIC_NOT_FOUND", 422);
      }
      let definition: unknown = null;
      try {
        definition = JSON.parse(metric.definition);
      } catch {
        definition = null;
      }
      if (!isMetricDefinition(definition)) {
        throw new Error(`Corrupt metric definition on custom metric ${metric.id}`);
      }
      const metricTrades: MetricTrade[] = sample;
      const result = evaluateMetric(definition, metricTrades);
      const data: CustomMetricWidgetData = {
        name: metric.name,
        format: metric.format,
        value: result.value,
        sampleSize: result.sampleSize,
        lowSample: result.lowSample,
      };
      return data;
    }

    default:
      // Static widgets (sticky-note, quick-actions) and unknown types are
      // filtered before the loader runs — unreachable safety net.
      return null;
  }
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function getDashboardData(
  userId: string,
  dashboardId: string,
  query: { preset: PeriodPreset; accountId: string | null }
): Promise<DashboardWidgetDataPayload> {
  const [profile, accounts, dashboardRow, prefs] = await Promise.all([
    db.profile.findUnique({ where: { id: userId } }),
    db.account.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.dashboard.findFirst({
      where: { id: dashboardId, userId },
      include: { widgets: { orderBy: { createdAt: "asc" } } },
    }),
    getDisplayPreferences(userId),
  ]);
  if (!dashboardRow) {
    throw new DashboardValidationError("DASHBOARD_NOT_FOUND", 404);
  }

  const timezone = profile?.timezone ?? "UTC";
  const currency = profile?.baseCurrency ?? "USD";
  // Day-bucketed widgets (KPI "trading days", P&L calendar, journal prompt)
  // follow the user's TRADING day (default MIDNIGHT_LOCAL = previous
  // behaviour).
  const dayOf = tradingDayOfTrade(timezone, prefs.tradingDay);
  const todayTradingDay = getTradingDay(new Date(), timezone, prefs.tradingDay);
  const globalAccount =
    query.accountId != null
      ? (accounts.find((a) => a.id === query.accountId) ?? null)
      : null;

  // The dataset is fetched ONCE — unscoped — so a widget accountOverride can
  // REPLACE the global account filter (override semantics) instead of
  // intersecting it. Per-widget scoping happens in memory.
  const [closedRows, strategyRows, requirements] = await Promise.all([
    db.trade.findMany({
      where: { userId, status: "CLOSED", isDraft: false },
      include: TRADE_INCLUDE,
    }),
    db.strategy.findMany({
      where: { userId },
      select: { name: true, color: true },
    }),
    getRequirements(userId),
  ]);

  const trades = closedRows.map((t) =>
    toDashboardTrade(t, timezone, prefs.tradingDay)
  );
  const dto = toDashboardDTO(dashboardRow);

  const ctx: WidgetContext = {
    userId,
    currency,
    timezone,
    accounts,
    strategyColors: new Map(strategyRows.map((s) => [s.name, s.color])),
    dayOf,
    todayTradingDay,
  };

  const widgets: Record<string, { data: unknown | null; error: string | null }> =
    {};

  for (const widget of dto.widgets) {
    const definition = getWidgetDefinition(widget.type);
    if (!definition || !definition.hasLoader) {
      // Static widget (sticky-note, quick-actions) or unknown type → the
      // client renders it from config alone.
      widgets[widget.id] = { data: null, error: null };
      continue;
    }

    try {
      const account =
        widget.accountOverride != null
          ? (accounts.find((a) => a.id === widget.accountOverride) ?? null)
          : globalAccount;
      const scoped =
        account != null
          ? trades.filter((t) => t.accountId === account.id)
          : trades;
      const period = resolvePeriod(
        { preset: query.preset, accountId: widget.accountOverride ?? null },
        widget.periodOverride,
        timezone,
        new Date(),
        prefs.tradingDay
      );
      const sample = applyPeriod(scoped, period);
      widgets[widget.id] = {
        data: await computeWidgetData(ctx, widget, account, scoped, sample, period),
        error: null,
      };
    } catch (error) {
      if (error instanceof DashboardValidationError) {
        // Typed widget-level error (e.g. METRIC_NOT_FOUND) — surfaced as-is.
        widgets[widget.id] = { data: null, error: error.code };
      } else {
        console.error(
          `[dashboard-data] widget ${widget.type} (${widget.id}) failed:`,
          error
        );
        widgets[widget.id] = { data: null, error: "WIDGET_DATA_FAILED" };
      }
    }
  }

  return {
    currency,
    timezone,
    generatedAt: new Date().toISOString(),
    widgets,
    requirements,
  };
}
