/**
 * Performance report (MRT wave 3, work item 3) — pure builder.
 *
 * A period-scoped report (30d / 90d / YTD / all, one account or all) with
 * a verdict, P&L by week, where the edge comes from, what costs money,
 * the week at a glance, three recommendations and the week ahead.
 *
 * No duplicated engine: the verdict, the recommendations and the costs
 * come from generateWeeklyPlan (MRT wave 1), called here on the selected
 * period's trades — same rules, same source as the weekly plan tab. The
 * only new computation is presentation over the period: weekly P&L
 * grouping, best session / setup / confluence, and the at-a-glance
 * figures. No invented data: every figure carries its sample size, and
 * under five trades the report is marked insufficient and the view shows
 * an honest empty state instead of a verdict.
 */
import { D0, toD, type Decimal } from "@/lib/trading/dec";
import type {
  AdvancedTrade,
  ConfluencesResult,
  SequencesResult,
  SetupRank,
  TraderScore,
} from "./advanced";
import type { AdvancedStats } from "./insights";
import type { TradeStats } from "./engine";
import { mean } from "./stats";
import {
  generateWeeklyPlan,
  sessionLabel,
  type EdgeCheck,
  type PlanAction,
  type WeeklyPlan,
  type WeeklyPlanInput,
} from "./weekly-plan";

/** Minimum closed trades in the period to produce a report. */
export const MIN_TRADES_FOR_REPORT = 5;

export interface ReportWeekRow {
  /** Monday of the week, YYYY-MM-DD (exit trading day). */
  weekStart: string;
  /** Sunday of the week, YYYY-MM-DD. */
  weekEnd: string;
  trades: number;
  wins: number;
  winRate: number | null;
  netPnl: string;
}

export type EdgeSourceKind = "session" | "setup" | "confluence";

export interface EdgeSource {
  kind: EdgeSourceKind;
  name: string;
  trades: number;
  winRate: number | null;
  /** Mean R per trade, null when no trade in the group carries an R. */
  expectancyR: number | null;
  netPnl: string;
}

export interface AtAGlance {
  netPnl: string;
  trades: number;
  winRate: string | null;
  profitFactor: string | null;
  expectancyR: string | null;
  /** Share of trades that followed the plan, 0-100, null when unknown. */
  planFollowedPct: number | null;
  /** Trader score 0-100 over the period (discipline is the headline). */
  disciplineScore: number;
}

export interface ReportCoverage {
  /** Closed trades in the period. */
  trades: number;
  /** Distinct accounts behind those trades. */
  accounts: number;
  /** First exit trading day, YYYY-MM-DD, null when no trade. */
  from: string | null;
  /** Last exit trading day, YYYY-MM-DD, null when no trade. */
  to: string | null;
}

export interface PerformanceReport {
  /** Monday of the current week (the plan part covers this week). */
  weekStart: string;
  /** Sunday of the current week. */
  weekEnd: string;
  /** Closed trades in the period. */
  sampleSize: number;
  /** False under five trades: no verdict and no recommendations, ever. */
  sufficient: boolean;
  coverage: ReportCoverage;
  edge: EdgeCheck;
  weeklyPnl: ReportWeekRow[];
  /** Best session, setup and confluence, when each clears its bar. */
  edgeSources: EdgeSource[];
  atAGlance: AtAGlance;
  /** Top three actions of the period's plan (same engine as the weekly plan). */
  recommendations: PlanAction[];
  /** "What to fix" lines from the period's plan. */
  costs: string[];
  /** "What you do well" lines from the period's plan. */
  strengths: string[];
}

export interface PerformanceReportInput {
  trades: AdvancedTrade[];
  stats: TradeStats;
  advanced: AdvancedStats;
  score: TraderScore;
  setups: SetupRank[];
  sequences: SequencesResult;
  confluences: ConfluencesResult;
  weekStart: string;
  weekEnd: string;
  currency: string;
  /**
   * Phase 2 perf — prebuilt weekly plan (same inputs, same trades).
   * When provided, the report reuses it for verdict/recommendations
   * instead of generating the plan a second time.
   */
  plan?: WeeklyPlan;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toDayKey(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function round(value: number | null, digits = 2): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

interface Slice {
  trades: AdvancedTrade[];
  net: Decimal;
  avgR: number | null;
  winRate: number | null;
}

function sliceStats(trades: AdvancedTrade[]): Slice {
  const net = trades.reduce((acc, t) => acc.plus(toD(t.netPnl ?? 0)), D0);
  const rs = trades
    .map((t) => (t.rMultiple == null ? null : Number(t.rMultiple)))
    .filter((v): v is number => v != null && Number.isFinite(v));
  const decided = trades.filter(
    (t) => t.resultType === "WIN" || t.resultType === "LOSS"
  );
  const wins = decided.filter((t) => t.resultType === "WIN").length;
  return {
    trades,
    net,
    avgR: round(mean(rs), 2),
    winRate:
      decided.length === 0
        ? null
        : round((wins / decided.length) * 100, 1),
  };
}

/** Monday (YYYY-MM-DD) of the week containing `dayKey` (YYYY-MM-DD). */
export function weekMondayOf(dayKey: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC rolls over out-of-range parts (month 13 becomes next
  // January), so the round-trip check is what rejects them.
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  // getUTCDay: 0 = Sunday .. 6 = Saturday; Monday is offset (dow + 6) % 7.
  const offset = (date.getUTCDay() + 6) % 7;
  const monday = new Date(date.getTime() - offset * 24 * 60 * 60 * 1000);
  return toDayKey(
    monday.getUTCFullYear(),
    monday.getUTCMonth() + 1,
    monday.getUTCDate()
  );
}

function addDays(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return toDayKey(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate()
  );
}

/**
 * Net P&L per Monday-Sunday week, chronological. Grouped by the exit
 * trading day (localDate), falling back to the exit timestamp's date when
 * the trading day is missing. Pure and unit-tested.
 */
export function groupWeeklyPnl(trades: AdvancedTrade[]): ReportWeekRow[] {
  const byWeek = new Map<string, AdvancedTrade[]>();
  for (const t of trades) {
    const day = t.localDate ?? t.exitTime.slice(0, 10);
    const monday = weekMondayOf(day);
    if (monday == null) continue;
    const list = byWeek.get(monday) ?? [];
    list.push(t);
    byWeek.set(monday, list);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monday, list]) => {
      const slice = sliceStats(list);
      const wins = list.filter((t) => t.resultType === "WIN").length;
      return {
        weekStart: monday,
        weekEnd: addDays(monday, 6),
        trades: list.length,
        wins,
        winRate: slice.winRate,
        netPnl: slice.net.toString(),
      };
    });
}

/**
 * Where the edge comes from: the best session (at least 3 trades, positive
 * mean R), the best setup (proven first, then promising, from the setup
 * ranking) and the best confluence (at least 3 trades, positive
 * expectancy). A source that clears no bar is left out, never invented.
 */
export function edgeSources(
  trades: AdvancedTrade[],
  setups: SetupRank[],
  confluences: ConfluencesResult
): EdgeSource[] {
  const out: EdgeSource[] = [];

  // Best session by mean R.
  const bySession = new Map<string, AdvancedTrade[]>();
  for (const t of trades) {
    const key = t.session ?? "OTHER";
    const list = bySession.get(key) ?? [];
    list.push(t);
    bySession.set(key, list);
  }
  let bestSession: { key: string; slice: Slice } | null = null;
  for (const [key, list] of bySession) {
    if (list.length < 3) continue;
    const slice = sliceStats(list);
    if (slice.avgR == null || slice.avgR <= 0) continue;
    if (bestSession == null || (slice.avgR ?? 0) > (bestSession.slice.avgR ?? 0)) {
      bestSession = { key, slice };
    }
  }
  if (bestSession != null) {
    out.push({
      kind: "session",
      name: sessionLabel(bestSession.key),
      trades: bestSession.slice.trades.length,
      winRate: bestSession.slice.winRate,
      expectancyR: bestSession.slice.avgR,
      netPnl: bestSession.slice.net.toString(),
    });
  }

  // Best setup: proven first, then promising, best expectancy wins.
  const ranked = setups
    .filter((s) => s.category === "proven" || s.category === "promising")
    .sort((a, b) => (b.expectancy ?? -Infinity) - (a.expectancy ?? -Infinity));
  const best = ranked[0];
  if (best != null) {
    const list = trades.filter(
      (t) =>
        (t.setupType && t.setupType.trim() !== "" ? t.setupType : "__none__") ===
        best.key
    );
    const slice = sliceStats(list);
    out.push({
      kind: "setup",
      name: best.key === "__none__" ? "Untagged setup" : best.key,
      trades: best.count,
      winRate: best.winRate,
      expectancyR: best.expectancy,
      netPnl: slice.net.toString(),
    });
  }

  // Best confluence by expectancy (at least 3 trades, positive).
  const bestConf = confluences.rows
    .filter(
      (r) => r.count >= 3 && r.expectancy != null && r.expectancy > 0
    )
    .sort(
      (a, b) => (b.expectancy ?? -Infinity) - (a.expectancy ?? -Infinity)
    )[0];
  if (bestConf != null) {
    out.push({
      kind: "confluence",
      name: bestConf.name,
      trades: bestConf.count,
      winRate: bestConf.winRate,
      expectancyR: bestConf.expectancy,
      netPnl: bestConf.netPnl,
    });
  }

  return out;
}

function buildCoverage(trades: AdvancedTrade[]): ReportCoverage {
  const accounts = new Set(
    trades.map((t) => t.accountId).filter((a): a is string => a != null)
  );
  const days = trades
    .map((t) => t.localDate ?? t.exitTime.slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  return {
    trades: trades.length,
    accounts: accounts.size,
    from: days[0] ?? null,
    to: days[days.length - 1] ?? null,
  };
}

export function buildPerformanceReport(
  input: PerformanceReportInput
): PerformanceReport {
  const { trades, stats, advanced, score, setups, sequences, confluences } =
    input;
  const planInput: WeeklyPlanInput = {
    trades,
    stats,
    advanced,
    score,
    setups,
    sequences,
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
    currency: input.currency,
  };
  // The verdict, actions, strengths and fixes below come straight from
  // the weekly plan engine — same rules, same source as the weekly plan
  // tab, run here on the selected period's trades. A prebuilt plan
  // (same inputs) is reused when the caller already generated it.
  const plan = input.plan ?? generateWeeklyPlan(planInput);
  return {
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
    sampleSize: trades.length,
    sufficient: trades.length >= MIN_TRADES_FOR_REPORT,
    coverage: buildCoverage(trades),
    edge: plan.edge,
    weeklyPnl: groupWeeklyPnl(trades),
    edgeSources: edgeSources(trades, setups, confluences),
    atAGlance: {
      netPnl: stats.netPnl,
      trades: stats.tradeCount,
      winRate: stats.winRate,
      profitFactor: stats.profitFactor,
      expectancyR: stats.expectancyR,
      planFollowedPct: score.details.planRate,
      disciplineScore: score.total,
    },
    recommendations: plan.actions.slice(0, 3),
    costs: plan.fixes,
    strengths: plan.strengths,
  };
}
