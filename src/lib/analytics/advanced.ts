/**
 * TradeJournal — advanced analytics engine (v2.5 Module 6, Prompt 6).
 *
 * Pure computation over CLOSED trades: trade lifecycle (MFE/MAE, almost-TP),
 * exit analysis (capture ratio, left on the table, exit simulations), trader
 * quality score (0-100), setup ranking (expectancy + Wilson intervals),
 * confluence hit rate (win rate and P&L per confluence tag, MRT wave 1),
 * sequence analysis (after-streak performance, transition matrix, binomial
 * test), seasonality (month / quarter / day-of-month / ISO week / year x month
 * heatmap) and anomaly detection (robust MAD z-scores).
 *
 * Client-safe (no Prisma). Money stays a string; R multiples and ratios are
 * plain numbers rounded for display. Every result carries its sample size and
 * the minimum-sample thresholds are exported below so the UI can document
 * them — no conclusion is drawn under the threshold.
 */
import { D0, Decimal, toD } from "@/lib/trading/dec";
import { compareTradeGrades } from "@/lib/trading/grades";
import {
  ADVANCED_MODULES,
  type AdvancedModule,
} from "@/lib/validations/analytics";
import {
  computeTradeStats,
  sortChronologically,
  type TradeStats,
} from "./engine";
import {
  computeAdvancedStats,
  type AdvancedStats,
  type AnalyticsTrade,
} from "./insights";
import {
  benjaminiHochberg,
  binomialTwoSidedP,
  mad,
  mean,
  median,
  robustZ,
  stdDev,
  wilsonInterval,
} from "./stats";

/** Minimum sample for a setup / sequence verdict. */
export const MIN_SAMPLE_SETUP = 10;
/** Trades needed to call a setup "proven". */
export const MIN_SAMPLE_PROVEN = 30;
/** Minimum sample for a seasonality cell verdict. */
export const MIN_SAMPLE_SEASON_CELL = 5;
/** Minimum sample for a sequence cell verdict. */
export const MIN_SAMPLE_SEQUENCE = 10;
/** Robust z-score: |z| >= 3 → high severity anomaly. */
export const ANOMALY_Z_HIGH = 3;
/** Robust z-score: |z| >= 2 → moderate severity anomaly. */
export const ANOMALY_Z_MODERATE = 2;
/** "Almost TP": MFE reached this share of the planned R target. */
export const ALMOST_TP_RATIO = 0.9;
/** "Almost TP" fallback when no planned RR exists (MFE in R). */
export const ALMOST_TP_FALLBACK_R = 1.8;

function round(value: number | null, digits = 2): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Closed trade with every advanced-analytics dimension. */
export interface AdvancedTrade extends AnalyticsTrade {
  /** MFE in R (from stored mfePrice + initial SL), null when unavailable. */
  mfeR: string | null;
  /** MAE in R (adverse distance, >= 0 when the trade went against entry). */
  maeR: string | null;
  takeProfit: string | null;
  plannedRR: string | null;
  entryPrice: string | null;
  initialStopLoss: string | null;
  /** Tag names on the trade. */
  tags: string[];
  /** MRT setup grade (A+ | A | B | C), null = ungraded. Optional for
   * callers that only carry tag dimensions. */
  grade?: string | null;
  /** Confluence tags on the trade (kind CONFLUENCE): id, name, color.
   * Optional for callers that only carry tag names. */
  confluenceTags?: Array<{ id: string; name: string; color: string }>;
  /** Rule violations attached to the trade. */
  violationCount: number;
  /** Declared playbook match at review time (MATCHED | PARTIAL |
   * OFF_PLAYBOOK), null when the trade was never reviewed. */
  playbookMatch?: string | null;
  /** Structured post-trade review, distinct from entry-time trade fields. */
  review?: {
    followedPlan: boolean | null;
    planAdherenceScore: number | null;
    executionQuality: number | null;
    entryQuality: number | null;
    exitQuality: number | null;
    riskManagementScore: number | null;
    emotionalControlScore: number | null;
    wouldTakeAgain: string | null;
    mistakeTags: string[];
    customAnswers?: CustomReviewAnswer[];
  } | null;
  riskPercent: string | null;
  setupQualityRating: number | null;
  /** Local calendar parts of the ENTRY (user timezone, server-computed). */
  localYear: number | null;
  localMonth: number | null;
  localDayOfMonth: number | null;
  localIsoWeek: number | null;
  localEntryDate: string | null;
  /** Minutes in profit / in loss from stored candles, null when no candle
   * coverage overlaps the trade window. */
  timeInProfitMin: number | null;
  timeInLossMin: number | null;
}

// ── (a) Trade lifecycle ──────────────────────────────────────────────────────

export interface LifecycleRow {
  tradeId: string;
  symbol: string;
  direction: string;
  entryTime: string;
  exitTime: string;
  exitReason: string | null;
  realizedR: number | null;
  plannedRR: number | null;
  mfeR: number | null;
  maeR: number | null;
  almostTp: boolean;
  timeInProfitMin: number | null;
  timeInLossMin: number | null;
  /** Share of the covered time spent in profit, 0-100. */
  timeInProfitPct: number | null;
}

export interface LifecycleBucket {
  id: string;
  from: number | null;
  to: number | null;
  count: number;
}

export interface LifecycleResult {
  total: number;
  /** Trades with MFE data. */
  withMfe: number;
  /** Trades with MAE data. */
  withMae: number;
  avgMfeR: number | null;
  avgMaeR: number | null;
  medianMfeR: number | null;
  medianMaeR: number | null;
  mfeBuckets: LifecycleBucket[];
  maeBuckets: LifecycleBucket[];
  almostTpCount: number;
  almostTp: LifecycleRow[];
  /** Trades with candle coverage (time in profit/loss known). */
  withTimeData: number;
  avgTimeInProfitPct: number | null;
  rows: LifecycleRow[];
}

const MFE_EDGES: Array<{ id: string; from: number | null; to: number | null }> = [
  { id: "neg", from: null, to: 0 },
  { id: "0-05", from: 0, to: 0.5 },
  { id: "05-1", from: 0.5, to: 1 },
  { id: "1-15", from: 1, to: 1.5 },
  { id: "15-2", from: 1.5, to: 2 },
  { id: "2-3", from: 2, to: 3 },
  { id: "ge3", from: 3, to: null },
];

const MAE_EDGES: Array<{ id: string; from: number | null; to: number | null }> = [
  { id: "le0", from: null, to: 0 },
  { id: "0-05", from: 0, to: 0.5 },
  { id: "05-1", from: 0.5, to: 1 },
  { id: "1-15", from: 1, to: 1.5 },
  { id: "ge15", from: 1.5, to: null },
];

function bucketize(
  values: number[],
  edges: Array<{ id: string; from: number | null; to: number | null }>
): LifecycleBucket[] {
  const buckets: LifecycleBucket[] = edges.map((e) => ({ ...e, count: 0 }));
  for (const v of values) {
    const idx = buckets.findIndex(
      (b) => (b.from == null || v >= b.from) && (b.to == null || v < b.to)
    );
    if (idx >= 0) buckets[idx].count += 1;
  }
  return buckets;
}

/** True when the price came close to the TP target without touching it. */
export function isAlmostTp(t: AdvancedTrade): boolean {
  if (t.exitReason === "TP_HIT" || t.mfeR == null) return false;
  const mfe = Number(t.mfeR);
  if (!Number.isFinite(mfe)) return false;
  if (t.plannedRR != null) {
    const target = Number(t.plannedRR);
    return Number.isFinite(target) && target > 0 && mfe >= ALMOST_TP_RATIO * target;
  }
  return mfe >= ALMOST_TP_FALLBACK_R;
}

export function computeLifecycle(trades: AdvancedTrade[]): LifecycleResult {
  const ordered = sortChronologically(trades);
  const rows: LifecycleRow[] = ordered.map((t) => {
    const mfe = t.mfeR != null ? Number(t.mfeR) : null;
    const mae = t.maeR != null ? Number(t.maeR) : null;
    const realized = t.rMultiple != null ? Number(t.rMultiple) : null;
    const planned = t.plannedRR != null ? Number(t.plannedRR) : null;
    const profit = t.timeInProfitMin;
    const loss = t.timeInLossMin;
    return {
      tradeId: t.id,
      symbol: t.symbol,
      direction: t.direction,
      entryTime: t.entryTime,
      exitTime: t.exitTime,
      exitReason: t.exitReason,
      realizedR: realized != null && Number.isFinite(realized) ? round(realized, 2) : null,
      plannedRR: planned != null && Number.isFinite(planned) ? round(planned, 2) : null,
      mfeR: mfe != null && Number.isFinite(mfe) ? round(mfe, 2) : null,
      maeR: mae != null && Number.isFinite(mae) ? round(mae, 2) : null,
      almostTp: isAlmostTp(t),
      timeInProfitMin: profit,
      timeInLossMin: loss,
      timeInProfitPct:
        profit != null && loss != null && profit + loss > 0
          ? round((profit / (profit + loss)) * 100, 1)
          : null,
    };
  });
  const withMfe = rows.filter((r) => r.mfeR != null);
  const withMae = rows.filter((r) => r.maeR != null);
  const mfeValues = withMfe.map((r) => r.mfeR as number);
  const maeValues = withMae.map((r) => r.maeR as number);
  const almostTp = rows.filter((r) => r.almostTp);
  const withTime = rows.filter((r) => r.timeInProfitPct != null);
  const timePcts = withTime.map((r) => r.timeInProfitPct as number);
  return {
    total: rows.length,
    withMfe: withMfe.length,
    withMae: withMae.length,
    avgMfeR: round(mean(mfeValues), 2),
    avgMaeR: round(mean(maeValues), 2),
    medianMfeR: round(median(mfeValues), 2),
    medianMaeR: round(median(maeValues), 2),
    mfeBuckets: bucketize(mfeValues, MFE_EDGES),
    maeBuckets: bucketize(maeValues, MAE_EDGES),
    almostTpCount: almostTp.length,
    almostTp,
    withTimeData: withTime.length,
    avgTimeInProfitPct: round(mean(timePcts), 1),
    rows: withMfe,
  };
}

// ── (b) Exit analysis ────────────────────────────────────────────────────────

export interface ExitReasonRow {
  key: string;
  count: number;
  avgR: number | null;
  /** Mean realised / max R over trades with MFE data in this bucket. */
  avgCapture: number | null;
  /** Mean R left on the table (max(0, MFE − realised)). */
  avgLeftOnTableR: number | null;
}

export interface ExitSimulation {
  id: "real" | "fixed1" | "fixed2" | "fixed3" | "trailing" | "breakeven";
  totalR: number;
  avgR: number | null;
  winRate: number | null;
  trades: number;
}

export interface ExitsResult {
  total: number;
  /** Trades with MFE data (the only ones simulations can use). */
  withMfe: number;
  /** Mean realised R / max R (MFE), trades with MFE > 0.2R only. */
  avgCaptureRatio: number | null;
  /** Mean max(0, MFE − realised R) over trades with MFE data. */
  avgLeftOnTableR: number | null;
  byExitReason: ExitReasonRow[];
  simulations: ExitSimulation[];
}

function captureOf(t: AdvancedTrade): number | null {
  if (t.mfeR == null || t.rMultiple == null) return null;
  const mfe = Number(t.mfeR);
  const realized = Number(t.rMultiple);
  if (!Number.isFinite(mfe) || !Number.isFinite(realized) || mfe <= 0.2) {
    return null;
  }
  return realized / mfe;
}

function leftOnTableOf(t: AdvancedTrade): number | null {
  if (t.mfeR == null || t.rMultiple == null) return null;
  const mfe = Number(t.mfeR);
  const realized = Number(t.rMultiple);
  if (!Number.isFinite(mfe) || !Number.isFinite(realized)) return null;
  return Math.max(0, mfe - realized);
}

/**
 * Simulated outcome for one trade under an alternate exit rule. All rules
 * only use the recorded MFE (no price path is assumed): when the trade never
 * reached the simulated trigger, the realised outcome stands.
 */
function simulatedR(t: AdvancedTrade, sim: ExitSimulation["id"]): number | null {
  if (t.rMultiple == null) return null;
  const realized = Number(t.rMultiple);
  if (!Number.isFinite(realized)) return null;
  if (sim === "real") return realized;
  if (t.mfeR == null) return null;
  const mfe = Number(t.mfeR);
  if (!Number.isFinite(mfe)) return null;
  switch (sim) {
    case "fixed1":
    case "fixed2":
    case "fixed3": {
      const target = sim === "fixed1" ? 1 : sim === "fixed2" ? 2 : 3;
      return mfe >= target ? target : realized;
    }
    case "trailing":
      // Trail 0.5R below the peak once +1R is reached.
      return mfe >= 1 ? mfe - 0.5 : realized;
    case "breakeven":
      // Move the stop to entry once +1R is reached.
      return mfe >= 1 ? Math.max(realized, 0) : realized;
    default:
      return realized;
  }
}

const SIM_IDS: ExitSimulation["id"][] = [
  "real",
  "fixed1",
  "fixed2",
  "fixed3",
  "trailing",
  "breakeven",
];

export function computeExits(trades: AdvancedTrade[]): ExitsResult {
  const ordered = sortChronologically(trades);
  const captures = ordered
    .map(captureOf)
    .filter((v): v is number => v != null);
  const lefts = ordered
    .map(leftOnTableOf)
    .filter((v): v is number => v != null);
  const withMfe = ordered.filter((t) => t.mfeR != null);

  const byReason = new Map<string, AdvancedTrade[]>();
  for (const t of ordered) {
    const key = t.exitReason ?? "UNKNOWN";
    const list = byReason.get(key) ?? [];
    list.push(t);
    byReason.set(key, list);
  }
  const byExitReason: ExitReasonRow[] = [...byReason.entries()]
    .map(([key, list]) => {
      const rs = list
        .map((t) => (t.rMultiple == null ? null : Number(t.rMultiple)))
        .filter((v): v is number => v != null && Number.isFinite(v));
      const caps = list
        .map(captureOf)
        .filter((v): v is number => v != null);
      const left = list
        .map(leftOnTableOf)
        .filter((v): v is number => v != null);
      return {
        key,
        count: list.length,
        avgR: round(mean(rs), 2),
        avgCapture: round(mean(caps), 2),
        avgLeftOnTableR: round(mean(left), 2),
      };
    })
    .sort((a, b) => b.count - a.count);

  const simulations: ExitSimulation[] = SIM_IDS.map((id) => {
    const outcomes = ordered
      .map((t) => simulatedR(t, id))
      .filter((v): v is number => v != null);
    const wins = outcomes.filter((r) => r > 0).length;
    return {
      id,
      totalR: round(outcomes.reduce((a, b) => a + b, 0), 2) ?? 0,
      avgR: round(mean(outcomes), 2),
      winRate:
        outcomes.length === 0
          ? null
          : round((wins / outcomes.length) * 100, 1),
      trades: outcomes.length,
    };
  });

  return {
    total: ordered.length,
    withMfe: withMfe.length,
    avgCaptureRatio: round(mean(captures), 2),
    avgLeftOnTableR: round(mean(lefts), 2),
    byExitReason,
    simulations,
  };
}

// ── (c) Trader quality score 0-100 ───────────────────────────────────────────

export type ScoreGrade = "excellent" | "good" | "developing" | "fragile";

export interface ScoreComponents {
  /** Plan followed + rule violations, 0-25. */
  discipline: number;
  /** Expectancy + SQN, 0-25. */
  edge: number;
  /** Profitable months + monthly regularity, 0-25. */
  consistency: number;
  /** Risk sizing respected + drawdown contained, 0-25. */
  risk: number;
}

export interface TraderScore {
  total: number;
  grade: ScoreGrade;
  components: ScoreComponents;
  details: {
    planRate: number | null;
    violationCount: number;
    violationRate: number | null;
    expectancyR: number | null;
    sqn: number | null;
    profitableMonths: number;
    months: number;
    /** Standard deviation of monthly mean R, across months with valid R data. */
    monthlyRStd: number | null;
    riskCompliantRate: number | null;
    maxDrawdown: string | null;
    grossWin: string;
  };
  /** Trades the score is based on. */
  trades: number;
  /**
   * Where the served score came from: the frozen daily snapshot (all-time,
   * all accounts) or a fresh recompute from the trades in scope. The server
   * only serves the snapshot when the request asks for exactly that scope
   * (see src/server/advanced-analytics.ts); every other scope is recomputed.
   */
  source: "snapshot" | "computed";
}

export interface ScoreHistoryPoint {
  /** Month YYYY-MM (month-end replay). */
  month: string;
  score: number;
  trades: number;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function scoreGrade(total: number): ScoreGrade {
  if (total >= 80) return "excellent";
  if (total >= 60) return "good";
  if (total >= 40) return "developing";
  return "fragile";
}

export function computeTraderScore(
  trades: AdvancedTrade[],
  stats: TradeStats,
  advanced: AdvancedStats
): TraderScore {
  const ordered = sortChronologically(trades);
  const n = ordered.length;

  // ── Discipline (0-25) ──
  const planTrades = ordered.filter((t) => t.followedPlan != null);
  const planFollowed = planTrades.filter((t) => t.followedPlan === true).length;
  const planRate =
    planTrades.length === 0 ? null : planFollowed / planTrades.length;
  const violationCount = ordered.reduce((a, t) => a + t.violationCount, 0);
  const violationRate = n === 0 ? null : Math.min(1, violationCount / n);
  const discipline =
    15 * (planRate ?? 0.5) + 10 * (1 - (violationRate ?? 0));

  // ── Edge (0-25) ──
  const expectancy =
    stats.expectancyR != null ? Number(stats.expectancyR) : null;
  const sqn = advanced.sqn != null ? Number(advanced.sqn) : null;
  const edge =
    12.5 * (expectancy == null ? 0 : clamp01((expectancy + 1) / 2)) +
    12.5 * (sqn == null ? 0 : clamp01(sqn / 3));

  // ── Consistency (0-25) ──
  const monthly = new Map<string, Decimal>();
  for (const t of ordered) {
    const month = (t.localDate ?? t.exitTime.slice(0, 10)).slice(0, 7);
    monthly.set(month, (monthly.get(month) ?? D0).plus(toD(t.netPnl ?? 0)));
  }
  const months = [...monthly.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const profitableMonths = months.filter(([, pnl]) => pnl.gt(0)).length;
  const monthlyRByMonth = new Map<string, { sum: Decimal; count: number }>();
  for (const trade of ordered) {
    if (trade.rMultiple == null) continue;
    const month = (trade.localDate ?? trade.exitTime.slice(0, 10)).slice(0, 7);
    const current = monthlyRByMonth.get(month) ?? { sum: D0, count: 0 };
    current.sum = current.sum.plus(toD(trade.rMultiple));
    current.count += 1;
    monthlyRByMonth.set(month, current);
  }
  // Compare monthly average R, not monetary P&L, so account size/currency
  // cannot distort the consistency component.
  const monthlyRAverages = [...monthlyRByMonth.values()].map((v) =>
    v.sum.div(v.count).toNumber()
  );
  const monthlyRStd = stdDev(monthlyRAverages);
  const consistency =
    (months.length === 0
      ? 0
      : 12.5 * (profitableMonths / months.length)) +
    (monthlyRAverages.length < 2
      ? 6.25
      : 12.5 * clamp01(1 - (monthlyRStd ?? 0) / 2));

  // ── Risk (0-25) ──
  const riskTrades = ordered.filter((t) => t.riskPercent != null);
  const compliant = riskTrades.filter(
    (t) => Number(t.riskPercent) <= 2
  ).length;
  const riskCompliantRate =
    riskTrades.length === 0 ? null : compliant / riskTrades.length;
  const grossWin = toD(stats.grossWin);
  const maxDd = toD(stats.maxDrawdown);
  const ddRatio =
    grossWin.gt(0) ? Math.min(1, maxDd.div(grossWin).toNumber()) : 1;
  const risk =
    12.5 * (riskCompliantRate ?? 0.5) + 12.5 * (1 - ddRatio);

  const total = Math.round(
    clamp01(
      (discipline + edge + consistency + risk) / 100
    ) * 100
  );
  return {
    total,
    grade: scoreGrade(total),
    components: {
      discipline: round(discipline, 1) ?? 0,
      edge: round(edge, 1) ?? 0,
      consistency: round(consistency, 1) ?? 0,
      risk: round(risk, 1) ?? 0,
    },
    details: {
      planRate: planRate != null ? round(planRate * 100, 1) : null,
      violationCount,
      violationRate:
        violationRate != null ? round(violationRate * 100, 1) : null,
      expectancyR: expectancy != null ? round(expectancy, 2) : null,
      sqn: sqn != null ? round(sqn, 2) : null,
      profitableMonths,
      months: months.length,
      monthlyRStd: monthlyRStd != null ? round(monthlyRStd, 2) : null,
      riskCompliantRate:
        riskCompliantRate != null ? round(riskCompliantRate * 100, 1) : null,
      maxDrawdown: stats.maxDrawdown,
      grossWin: stats.grossWin,
    },
    trades: n,
    source: "computed",
  };
}

/** Monthly replay: score as of each month-end (trades closed up to then). */
export function computeScoreHistory(
  trades: AdvancedTrade[]
): ScoreHistoryPoint[] {
  const ordered = sortChronologically(trades);
  const months = [
    ...new Set(
      ordered.map((t) => (t.localDate ?? t.exitTime.slice(0, 10)).slice(0, 7))
    ),
  ].sort();
  const points: ScoreHistoryPoint[] = [];
  for (const month of months) {
    const cutoff = `${month}-31T23:59:59.999Z`;
    const subset = ordered.filter((t) => t.exitTime <= cutoff);
    if (subset.length < 3) continue;
    const stats = computeTradeStats(subset);
    const advanced = computeAdvancedStats(subset, stats);
    const score = computeTraderScore(subset, stats, advanced);
    points.push({ month, score: score.total, trades: subset.length });
  }
  return points;
}

// ── (d) Setup ranking ───────────────────────────────────────────────────────

export type SetupCategory = "proven" | "promising" | "unproven" | "losing";

export interface SetupRank {
  key: string;
  /** All trades assigned to this setup. */
  count: number;
  /** Trades with a finite R multiple; used for expectancy thresholds. */
  rSampleSize: number;
  /** WIN/LOSS trades; used for the Wilson confidence interval. */
  decidedSampleSize: number;
  expectancy: number | null;
  winRate: number | null;
  wilsonLower: number | null;
  wilsonUpper: number | null;
  category: SetupCategory;
  totalR: number | null;
  avgR: number | null;
  netPnl: string;
  avgDurationMin: number | null;
  avgSetupQuality: number | null;
}

export function setupCategory(rank: {
  rSampleSize: number;
  decidedSampleSize: number;
  expectancy: number | null;
  wilsonLower: number | null;
}): SetupCategory {
  if (
    rank.rSampleSize >= MIN_SAMPLE_SETUP &&
    rank.expectancy != null &&
    rank.expectancy < 0
  ) {
    return "losing";
  }
  if (
    rank.rSampleSize >= MIN_SAMPLE_PROVEN &&
    rank.decidedSampleSize >= MIN_SAMPLE_PROVEN &&
    rank.expectancy != null &&
    rank.expectancy >= 0.2 &&
    (rank.wilsonLower ?? 0) >= 0.35
  ) {
    return "proven";
  }
  if (
    rank.rSampleSize >= MIN_SAMPLE_SETUP &&
    rank.expectancy != null &&
    rank.expectancy > 0
  ) {
    return "promising";
  }
  return "unproven";
}

export function computeSetupRanking(trades: AdvancedTrade[]): SetupRank[] {
  const groups = new Map<string, AdvancedTrade[]>();
  for (const t of trades) {
    const key = t.setupType && t.setupType.trim() !== "" ? t.setupType : "__none__";
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }
  const ranks: SetupRank[] = [...groups.entries()].map(([key, list]) => {
    const rs = list
      .map((t) => (t.rMultiple == null ? null : Number(t.rMultiple)))
      .filter((v): v is number => v != null && Number.isFinite(v));
    const wins = list.filter((t) => t.resultType === "WIN").length;
    const decided = list.filter(
      (t) => t.resultType === "WIN" || t.resultType === "LOSS"
    ).length;
    const wilson =
      decided > 0 ? wilsonInterval(wins, decided) : null;
    const expectancy = rs.length > 0 ? mean(rs) : null;
    const durations = list
      .map((t) => t.durationMin)
      .filter((d): d is number => d != null);
    const qualities = list
      .map((t) => t.setupQualityRating)
      .filter((q): q is number => q != null);
    const netPnl = list
      .reduce((acc, t) => acc.plus(toD(t.netPnl ?? 0)), D0)
      .toString();
    const rank: SetupRank = {
      key,
      count: list.length,
      rSampleSize: rs.length,
      decidedSampleSize: decided,
      expectancy: expectancy != null ? round(expectancy, 2) : null,
      winRate:
        decided > 0 ? round((wins / decided) * 100, 1) : null,
      wilsonLower:
        wilson != null ? round(wilson.lower * 100, 1) : null,
      wilsonUpper:
        wilson != null ? round(wilson.upper * 100, 1) : null,
      category: "unproven",
      totalR:
        rs.length > 0
          ? round(rs.reduce((a, b) => a + b, 0), 2)
          : null,
      avgR: expectancy != null ? round(expectancy, 2) : null,
      netPnl,
      avgDurationMin:
        durations.length > 0
          ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
          : null,
      avgSetupQuality:
        qualities.length > 0
          ? round(
              qualities.reduce((a, b) => a + b, 0) / qualities.length,
              1
            )
          : null,
    };
    rank.category = setupCategory(rank);
    return rank;
  });
  return ranks.sort(
    (a, b) => (b.expectancy ?? -Infinity) - (a.expectancy ?? -Infinity)
  );
}

// ── (d2) Confluence hit rate (MRT wave 1) ──────────────────────────────────
// Win rate and P&L per confluence tag (kind CONFLUENCE), MRT "Confluence hit
// rate". A trade can carry several confluences, so it is counted once in
// every confluence it carries: row counts add up to more than the tagged
// total, which the UI states plainly. R multiples drive expectancy; a trade
// without an R multiple still counts for win rate and net P&L.

/** Minimum sample for a confluence verdict (same bar as setups). */
export const MIN_SAMPLE_CONFLUENCE = 10;

export interface ConfluenceRow {
  tagId: string;
  name: string;
  color: string;
  /** All trades carrying this confluence. */
  count: number;
  /** Trades with a finite R multiple. */
  rSampleSize: number;
  /** WIN/LOSS trades used for the Wilson interval. */
  decidedSampleSize: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number | null;
  wilsonLower: number | null;
  wilsonUpper: number | null;
  /** Mean R per trade, null when no trade in the group carries an R. */
  expectancy: number | null;
  avgR: number | null;
  totalR: number | null;
  netPnl: string;
}

export interface ConfluencesResult {
  /** Closed trades in scope (all, tagged or not). */
  total: number;
  /** Trades carrying at least one confluence. */
  tagged: number;
  /** Trades with no confluence at all. */
  untagged: number;
  rows: ConfluenceRow[];
}

export function computeConfluences(trades: AdvancedTrade[]): ConfluencesResult {
  const groups = new Map<
    string,
    { name: string; color: string; list: AdvancedTrade[] }
  >();
  let tagged = 0;
  for (const t of trades) {
    const confs = t.confluenceTags ?? [];
    if (confs.length === 0) continue;
    tagged += 1;
    const seen = new Set<string>();
    for (const c of confs) {
      // One trade counts once per confluence, even if the tag is attached twice.
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const group = groups.get(c.id) ?? { name: c.name, color: c.color, list: [] };
      group.list.push(t);
      groups.set(c.id, group);
    }
  }
  const rows: ConfluenceRow[] = [...groups.entries()].map(([tagId, group]) => {
    const list = group.list;
    const rs = list
      .map((t) => (t.rMultiple == null ? null : Number(t.rMultiple)))
      .filter((v): v is number => v != null && Number.isFinite(v));
    const wins = list.filter((t) => t.resultType === "WIN").length;
    const losses = list.filter((t) => t.resultType === "LOSS").length;
    const breakevens = list.filter((t) => t.resultType === "BREAKEVEN").length;
    const decided = wins + losses;
    const wilson = decided > 0 ? wilsonInterval(wins, decided) : null;
    const expectancy = rs.length > 0 ? mean(rs) : null;
    const netPnl = list
      .reduce((acc, t) => acc.plus(toD(t.netPnl ?? 0)), D0)
      .toString();
    return {
      tagId,
      name: group.name,
      color: group.color,
      count: list.length,
      rSampleSize: rs.length,
      decidedSampleSize: decided,
      wins,
      losses,
      breakevens,
      winRate: decided > 0 ? round((wins / decided) * 100, 1) : null,
      wilsonLower: wilson != null ? round(wilson.lower * 100, 1) : null,
      wilsonUpper: wilson != null ? round(wilson.upper * 100, 1) : null,
      expectancy: expectancy != null ? round(expectancy, 2) : null,
      avgR: expectancy != null ? round(expectancy, 2) : null,
      totalR:
        rs.length > 0 ? round(rs.reduce((a, b) => a + b, 0), 2) : null,
      netPnl,
    };
  });
  // Most-tagged first; expectancy breaks ties.
  rows.sort(
    (a, b) =>
      b.count - a.count ||
      (b.expectancy ?? -Infinity) - (a.expectancy ?? -Infinity)
  );
  return {
    total: trades.length,
    tagged,
    untagged: trades.length - tagged,
    rows,
  };
}

// ── (d3) By grade (MRT wave 3) ─────────────────────────────────────────────
// Win rate and P&L per MRT setup grade (A+ / A / B / C). Unlike confluences,
// a trade carries at most one grade, so row counts add up to the graded
// total exactly. Ungraded trades are counted, never assigned a grade, and
// never enter a row. R multiples drive expectancy; a trade without an R
// multiple still counts for win rate and net P&L.

/** Minimum sample for a grade verdict (same bar as setups / confluences). */
export const MIN_SAMPLE_GRADE = 10;

export interface GradeRow {
  grade: string;
  /** All trades carrying this grade. */
  count: number;
  /** Trades with a finite R multiple. */
  rSampleSize: number;
  /** WIN/LOSS trades used for the Wilson interval. */
  decidedSampleSize: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number | null;
  wilsonLower: number | null;
  wilsonUpper: number | null;
  /** Mean R per trade, null when no trade in the group carries an R. */
  expectancy: number | null;
  avgR: number | null;
  totalR: number | null;
  netPnl: string;
}

export interface GradesResult {
  /** Closed trades in scope (all, graded or not). */
  total: number;
  /** Trades carrying a grade. */
  graded: number;
  /** Trades with no grade. */
  ungraded: number;
  /** One row per grade present in the data, best grade first. */
  rows: GradeRow[];
}

export function computeGrades(trades: AdvancedTrade[]): GradesResult {
  const groups = new Map<string, AdvancedTrade[]>();
  let graded = 0;
  for (const t of trades) {
    if (t.grade == null) continue;
    graded += 1;
    const list = groups.get(t.grade) ?? [];
    list.push(t);
    groups.set(t.grade, list);
  }
  const rows: GradeRow[] = [...groups.entries()].map(([grade, list]) => {
    const rs = list
      .map((t) => (t.rMultiple == null ? null : Number(t.rMultiple)))
      .filter((v): v is number => v != null && Number.isFinite(v));
    const wins = list.filter((t) => t.resultType === "WIN").length;
    const losses = list.filter((t) => t.resultType === "LOSS").length;
    const breakevens = list.filter((t) => t.resultType === "BREAKEVEN").length;
    const decided = wins + losses;
    const wilson = decided > 0 ? wilsonInterval(wins, decided) : null;
    const expectancy = rs.length > 0 ? mean(rs) : null;
    const netPnl = list
      .reduce((acc, t) => acc.plus(toD(t.netPnl ?? 0)), D0)
      .toString();
    return {
      grade,
      count: list.length,
      rSampleSize: rs.length,
      decidedSampleSize: decided,
      wins,
      losses,
      breakevens,
      winRate: decided > 0 ? round((wins / decided) * 100, 1) : null,
      wilsonLower: wilson != null ? round(wilson.lower * 100, 1) : null,
      wilsonUpper: wilson != null ? round(wilson.upper * 100, 1) : null,
      expectancy: expectancy != null ? round(expectancy, 2) : null,
      avgR: expectancy != null ? round(expectancy, 2) : null,
      totalR:
        rs.length > 0 ? round(rs.reduce((a, b) => a + b, 0), 2) : null,
      netPnl,
    };
  });
  // Best grade first; trade count breaks ties.
  rows.sort(
    (a, b) =>
      compareTradeGrades(a.grade, b.grade) || b.count - a.count
  );
  return {
    total: trades.length,
    graded,
    ungraded: trades.length - graded,
    rows,
  };
}

// ── (e) Sequence analysis ────────────────────────────────────────────────────

export interface AfterStreakRow {
  side: "WIN" | "LOSS";
  streak: number;
  count: number;
  wins: number;
  winRate: number | null;
  avgR: number | null;
  /** Raw two-sided binomial p-value vs the overall win rate. */
  pValue: number | null;
  /** Benjamini-Hochberg adjusted p-value across available after-streak tests. */
  adjustedPValue: number | null;
  /** True only when the adjusted p-value is below 0.05. */
  significant: boolean;
}

export interface TransitionMatrix {
  ww: number;
  wl: number;
  lw: number;
  ll: number;
  /** P(next = WIN | prev = WIN), 0-100. */
  pWinAfterWin: number | null;
  /** P(next = WIN | prev = LOSS), 0-100. */
  pWinAfterLoss: number | null;
}

export interface SequencesResult {
  total: number;
  /** Decided trades (WIN/LOSS) used for the analysis. */
  decided: number;
  baselineWinRate: number | null;
  after: AfterStreakRow[];
  matrix: TransitionMatrix;
}

export function computeSequences(trades: AdvancedTrade[]): SequencesResult {
  // Breakevens are skipped: they neither extend a streak nor count as the
  // "next" trade (documented simplification).
  const decided = sortChronologically(trades).filter(
    (t) => t.resultType === "WIN" || t.resultType === "LOSS"
  );
  const wins = decided.filter((t) => t.resultType === "WIN").length;
  const baselineWinRate =
    decided.length === 0 ? null : wins / decided.length;

  const after: AfterStreakRow[] = [];
  const rawPValues: Array<{ index: number; value: number }> = [];
  for (const side of ["WIN", "LOSS"] as const) {
    for (const streak of [1, 2, 3]) {
      const nexts: AdvancedTrade[] = [];
      let run = 0;
      for (const t of decided) {
        if (t.resultType === side) {
          run += 1;
        } else {
          if (run >= streak) nexts.push(t);
          run = 0;
        }
      }
      const nextWins = nexts.filter((t) => t.resultType === "WIN").length;
      const rs = nexts
        .map((t) => (t.rMultiple == null ? null : Number(t.rMultiple)))
        .filter((v): v is number => v != null && Number.isFinite(v));
      const pValue =
        baselineWinRate != null && nexts.length >= MIN_SAMPLE_SEQUENCE
          ? binomialTwoSidedP(nextWins, nexts.length, baselineWinRate)
          : null;
      const rowIndex = after.length;
      if (pValue != null) rawPValues.push({ index: rowIndex, value: pValue });
      after.push({
        side,
        streak,
        count: nexts.length,
        wins: nextWins,
        winRate:
          nexts.length === 0
            ? null
            : round((nextWins / nexts.length) * 100, 1),
        avgR: round(mean(rs), 2),
        pValue: pValue != null ? round(pValue, 3) : null,
        adjustedPValue: null,
        significant: false,
      });
    }
  }

  // Correct the family of available after-streak comparisons before marking
  // any row significant. Cells below the sample threshold are not tests.
  const adjustedPValues = benjaminiHochberg(rawPValues.map((row) => row.value));
  rawPValues.forEach(({ index }, i) => {
    const adjusted = adjustedPValues[i];
    after[index] = {
      ...after[index],
      adjustedPValue: round(adjusted, 3),
      significant: adjusted < 0.05,
    };
  });

  let ww = 0;
  let wl = 0;
  let lw = 0;
  let ll = 0;
  for (let i = 0; i + 1 < decided.length; i++) {
    const a = decided[i].resultType;
    const b = decided[i + 1].resultType;
    if (a === "WIN" && b === "WIN") ww += 1;
    else if (a === "WIN" && b === "LOSS") wl += 1;
    else if (a === "LOSS" && b === "WIN") lw += 1;
    else if (a === "LOSS" && b === "LOSS") ll += 1;
  }
  return {
    total: trades.length,
    decided: decided.length,
    baselineWinRate:
      baselineWinRate != null ? round(baselineWinRate * 100, 1) : null,
    after,
    matrix: {
      ww,
      wl,
      lw,
      ll,
      pWinAfterWin:
        ww + wl === 0 ? null : round((ww / (ww + wl)) * 100, 1),
      pWinAfterLoss:
        lw + ll === 0 ? null : round((lw / (lw + ll)) * 100, 1),
    },
  };
}

// ── (f) Seasonality ──────────────────────────────────────────────────────────

export type SeasonVerdict = "positive" | "negative" | "neutral" | "insufficient";

export interface SeasonCell {
  key: string;
  label: string;
  /** All trades in the cell. */
  count: number;
  /** Trades with a finite R multiple. */
  rSampleSize: number;
  /** WIN/LOSS trades used for the Wilson interval. */
  decidedSampleSize: number;
  winRate: number | null;
  wilsonLower: number | null;
  wilsonUpper: number | null;
  avgR: number | null;
  netPnl: string;
  verdict: SeasonVerdict;
}

export interface YearMonthCell {
  year: number;
  month: number;
  count: number;
  avgR: number | null;
  netPnl: string;
  winRate: number | null;
}

export interface SeasonalityResult {
  total: number;
  months: SeasonCell[];
  quarters: SeasonCell[];
  daysOfMonth: SeasonCell[];
  weeks: SeasonCell[];
  yearMonth: YearMonthCell[];
  years: number[];
  minSample: number;
}

function seasonVerdict(
  rSampleSize: number,
  decidedSampleSize: number,
  avgR: number | null,
  wilson: { lower: number; upper: number } | null
): SeasonVerdict {
  if (
    rSampleSize < MIN_SAMPLE_SEASON_CELL ||
    decidedSampleSize < MIN_SAMPLE_SEASON_CELL
  ) return "insufficient";
  if (
    wilson != null &&
    wilson.lower > 0.5 &&
    avgR != null &&
    avgR > 0
  ) {
    return "positive";
  }
  if (
    wilson != null &&
    wilson.upper < 0.5 &&
    avgR != null &&
    avgR < 0
  ) {
    return "negative";
  }
  return "neutral";
}

function seasonCells(
  groups: Map<string, { label: string; trades: AdvancedTrade[] }>
): SeasonCell[] {
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, g]) => {
      const list = g.trades;
      const wins = list.filter((t) => t.resultType === "WIN").length;
      const decided = list.filter(
        (t) => t.resultType === "WIN" || t.resultType === "LOSS"
      ).length;
      const wilson = decided > 0 ? wilsonInterval(wins, decided) : null;
      const rs = list
        .map((t) => (t.rMultiple == null ? null : Number(t.rMultiple)))
        .filter((v): v is number => v != null && Number.isFinite(v));
      const avgR = rs.length > 0 ? mean(rs) : null;
      return {
        key,
        label: g.label,
        count: list.length,
        rSampleSize: rs.length,
        decidedSampleSize: decided,
        winRate:
          decided > 0 ? round((wins / decided) * 100, 1) : null,
        wilsonLower:
          wilson != null ? round(wilson.lower * 100, 1) : null,
        wilsonUpper:
          wilson != null ? round(wilson.upper * 100, 1) : null,
        avgR: avgR != null ? round(avgR, 2) : null,
        netPnl: list
          .reduce((acc, t) => acc.plus(toD(t.netPnl ?? 0)), D0)
          .toString(),
        verdict: seasonVerdict(rs.length, decided, avgR, wilson),
      };
    });
}

export function computeSeasonality(trades: AdvancedTrade[]): SeasonalityResult {
  const months = new Map<string, { label: string; trades: AdvancedTrade[] }>();
  const quarters = new Map<string, { label: string; trades: AdvancedTrade[] }>();
  const days = new Map<string, { label: string; trades: AdvancedTrade[] }>();
  const weeks = new Map<string, { label: string; trades: AdvancedTrade[] }>();
  const yearMonth = new Map<string, YearMonthCell>();
  const years = new Set<number>();

  for (const t of trades) {
    const entryDate = t.localEntryDate ?? t.entryTime.slice(0, 10);
    const year = t.localYear ?? Number(entryDate.slice(0, 4));
    const month = t.localMonth ?? Number(entryDate.slice(5, 7));
    const day = t.localDayOfMonth ?? Number(entryDate.slice(8, 10));
    const week = t.localIsoWeek;
    if (!Number.isFinite(year) || !Number.isFinite(month)) continue;
    years.add(year);
    const push = (
      map: Map<string, { label: string; trades: AdvancedTrade[] }>,
      key: string,
      label: string
    ) => {
      const g = map.get(key) ?? { label, trades: [] };
      g.trades.push(t);
      map.set(key, g);
    };
    push(months, String(month).padStart(2, "0"), String(month));
    push(quarters, `Q${Math.floor((month - 1) / 3) + 1}`, `Q${Math.floor((month - 1) / 3) + 1}`);
    push(days, String(day).padStart(2, "0"), String(day));
    if (week != null) {
      push(weeks, String(week).padStart(2, "0"), `S${week}`);
    }
    const ymKey = `${year}-${String(month).padStart(2, "0")}`;
    const cell = yearMonth.get(ymKey) ?? {
      year,
      month,
      count: 0,
      avgR: null,
      netPnl: "0",
      winRate: null,
    };
    cell.count += 1;
    yearMonth.set(ymKey, cell);
  }

  // Fill year x month aggregates.
  for (const cell of yearMonth.values()) {
    const list = trades.filter((t) => {
      const entryDate = t.localEntryDate ?? t.entryTime.slice(0, 10);
      return (
        Number(entryDate.slice(0, 4)) === cell.year &&
        Number(entryDate.slice(5, 7)) === cell.month
      );
    });
    const rs = list
      .map((t) => (t.rMultiple == null ? null : Number(t.rMultiple)))
      .filter((v): v is number => v != null && Number.isFinite(v));
    const wins = list.filter((t) => t.resultType === "WIN").length;
    const decided = list.filter(
      (t) => t.resultType === "WIN" || t.resultType === "LOSS"
    ).length;
    cell.avgR = rs.length > 0 ? round(mean(rs), 2) : null;
    cell.netPnl = list
      .reduce((acc, t) => acc.plus(toD(t.netPnl ?? 0)), D0)
      .toString();
    cell.winRate =
      decided > 0 ? round((wins / decided) * 100, 1) : null;
  }

  return {
    total: trades.length,
    months: seasonCells(months),
    quarters: seasonCells(quarters),
    daysOfMonth: seasonCells(days),
    weeks: seasonCells(weeks),
    yearMonth: [...yearMonth.values()].sort(
      (a, b) => a.year - b.year || a.month - b.month
    ),
    years: [...years].sort((a, b) => a - b),
    minSample: MIN_SAMPLE_SEASON_CELL,
  };
}

// ── (g) Anomaly detection ────────────────────────────────────────────────────

export type AnomalyKind = "R_OUTLIER" | "DURATION_OUTLIER";
export type AnomalySeverity = "high" | "moderate";

export interface DetectedAnomaly {
  tradeId: string;
  symbol: string;
  direction: string;
  entryTime: string;
  exitTime: string;
  kind: AnomalyKind;
  severity: AnomalySeverity;
  zScore: number;
  rMultiple: number | null;
  durationMin: number | null;
}

export interface AnomaliesResult {
  total: number;
  withR: number;
  withDuration: number;
  high: number;
  moderate: number;
  rMedian: number | null;
  rMad: number | null;
  durationMedianLog: number | null;
  anomalies: DetectedAnomaly[];
}

export function computeAnomalies(trades: AdvancedTrade[]): AnomaliesResult {
  const ordered = sortChronologically(trades);
  const rValues = ordered
    .map((t) => (t.rMultiple == null ? null : Number(t.rMultiple)))
    .filter((v): v is number => v != null && Number.isFinite(v));
  const rStats = mad(rValues);
  // Log-duration: durations are heavily right-skewed, so the robust
  // z-score is computed on ln(minutes).
  const durValues = ordered
    .map((t) =>
      t.durationMin != null && t.durationMin > 0
        ? Math.log(t.durationMin)
        : null
    )
    .filter((v): v is number => v != null && Number.isFinite(v));
  const durStats = mad(durValues);

  const byTrade = new Map<string, DetectedAnomaly>();
  const consider = (a: DetectedAnomaly) => {
    const prev = byTrade.get(a.tradeId);
    if (!prev || Math.abs(a.zScore) > Math.abs(prev.zScore)) {
      byTrade.set(a.tradeId, a);
    }
  };

  for (const t of ordered) {
    if (t.rMultiple != null) {
      const r = Number(t.rMultiple);
      const z = robustZ(r, rValues);
      if (z != null && Math.abs(z) >= ANOMALY_Z_MODERATE) {
        consider({
          tradeId: t.id,
          symbol: t.symbol,
          direction: t.direction,
          entryTime: t.entryTime,
          exitTime: t.exitTime,
          kind: "R_OUTLIER",
          severity: Math.abs(z) >= ANOMALY_Z_HIGH ? "high" : "moderate",
          zScore: round(z, 2) ?? 0,
          rMultiple: round(r, 2),
          durationMin: t.durationMin,
        });
      }
    }
    if (t.durationMin != null && t.durationMin > 0) {
      const z = robustZ(Math.log(t.durationMin), durValues);
      if (z != null && Math.abs(z) >= ANOMALY_Z_MODERATE) {
        consider({
          tradeId: t.id,
          symbol: t.symbol,
          direction: t.direction,
          entryTime: t.entryTime,
          exitTime: t.exitTime,
          kind: "DURATION_OUTLIER",
          severity: Math.abs(z) >= ANOMALY_Z_HIGH ? "high" : "moderate",
          zScore: round(z, 2) ?? 0,
          rMultiple:
            t.rMultiple != null ? round(Number(t.rMultiple), 2) : null,
          durationMin: t.durationMin,
        });
      }
    }
  }

  const anomalies = [...byTrade.values()].sort(
    (a, b) => Math.abs(b.zScore) - Math.abs(a.zScore)
  );
  return {
    total: ordered.length,
    withR: rValues.length,
    withDuration: durValues.length,
    high: anomalies.filter((a) => a.severity === "high").length,
    moderate: anomalies.filter((a) => a.severity === "moderate").length,
    rMedian: rStats != null ? round(rStats.median, 2) : null,
    rMad: rStats != null ? round(rStats.mad, 2) : null,
    durationMedianLog:
      durStats != null ? round(durStats.median, 2) : null,
    anomalies,
  };
}

// ── Whole payload ────────────────────────────────────────────────────────────

export interface ReviewScoreMetric {
  average: number | null;
  count: number;
}

export interface CustomReviewAnswer {
  questionId: string;
  question: string;
  type: "SCALE" | "BOOLEAN" | "TEXT";
  answer: string | number | boolean;
}
export interface CustomQuestionReviewMetric {
  questionId: string;
  question: string;
  type: CustomReviewAnswer["type"];
  answered: number;
  average: number | null;
  scaleDistribution: [number, number, number, number, number];
  booleanYes: number;
  booleanNo: number;
}
export interface TradeReviewAnalytics {
  closedTrades: number;
  reviewedTrades: number;
  coveragePct: number | null;
  plan: { followed: number; notFollowed: number; unanswered: number; ratePct: number | null };
  scores: {
    planAdherence: ReviewScoreMetric;
    execution: ReviewScoreMetric;
    entry: ReviewScoreMetric;
    exit: ReviewScoreMetric;
    riskManagement: ReviewScoreMetric;
    emotionalControl: ReviewScoreMetric;
  };
  wouldTakeAgain: { yes: number; no: number; maybe: number; unanswered: number };
  playbookMatch: { matched: number; partial: number; offPlaybook: number; unclassified: number };
  topMistakes: Array<{ label: string; count: number }>;
  customQuestions: CustomQuestionReviewMetric[];
}

function reviewScore(values: Array<number | null>): ReviewScoreMetric {
  const valid = values.filter((value): value is number =>
    value != null && Number.isInteger(value) && value >= 1 && value <= 5
  );
  return {
    average: valid.length === 0 ? null : round(mean(valid), 2),
    count: valid.length,
  };
}

/** Aggregate only explicit review answers; missing answers stay unanswered. */
export function computeTradeReviewAnalytics(trades: AdvancedTrade[]): TradeReviewAnalytics {
  const reviewed = trades.filter((trade) => trade.review != null);
  const followed = reviewed.filter((trade) => trade.review?.followedPlan === true).length;
  const notFollowed = reviewed.filter((trade) => trade.review?.followedPlan === false).length;
  const planAnswered = followed + notFollowed;
  const would = { yes: 0, no: 0, maybe: 0, unanswered: 0 };
  const playbook = { matched: 0, partial: 0, offPlaybook: 0, unclassified: 0 };
  const mistakes = new Map<string, number>();
  const customGroups = new Map<string, {
    questionId: string; question: string; type: CustomReviewAnswer["type"];
    answered: number; scaleTotal: number;
    scaleDistribution: [number, number, number, number, number];
    booleanYes: number; booleanNo: number;
  }>();

  for (const trade of reviewed) {
    const answer = trade.review?.wouldTakeAgain;
    if (answer === "YES") would.yes += 1;
    else if (answer === "NO") would.no += 1;
    else if (answer === "MAYBE") would.maybe += 1;
    else would.unanswered += 1;

    const match = trade.playbookMatch;
    if (match === "MATCHED") playbook.matched += 1;
    else if (match === "PARTIAL") playbook.partial += 1;
    else if (match === "OFF_PLAYBOOK") playbook.offPlaybook += 1;
    else playbook.unclassified += 1;

    for (const label of new Set(trade.review?.mistakeTags ?? [])) {
      mistakes.set(label, (mistakes.get(label) ?? 0) + 1);
    }
    for (const answer of trade.review?.customAnswers ?? []) {
      const key = JSON.stringify([answer.questionId, answer.question, answer.type]);
      const metric = customGroups.get(key) ?? {
        questionId: answer.questionId, question: answer.question, type: answer.type,
        answered: 0, scaleTotal: 0,
        scaleDistribution: [0, 0, 0, 0, 0] as [number, number, number, number, number],
        booleanYes: 0, booleanNo: 0,
      };
      if (answer.type === "SCALE" && typeof answer.answer === "number" &&
          Number.isInteger(answer.answer) && answer.answer >= 1 && answer.answer <= 5) {
        metric.answered++;
        metric.scaleTotal += answer.answer;
        metric.scaleDistribution[answer.answer - 1]++;
      } else if (answer.type === "BOOLEAN" && typeof answer.answer === "boolean") {
        metric.answered++;
        if (answer.answer) metric.booleanYes++;
        else metric.booleanNo++;
      } else if (answer.type === "TEXT" && typeof answer.answer === "string" && answer.answer.trim()) {
        metric.answered++;
      }
      customGroups.set(key, metric);
    }
  }

  return {
    closedTrades: trades.length,
    reviewedTrades: reviewed.length,
    coveragePct: trades.length === 0 ? null : round((reviewed.length / trades.length) * 100, 1),
    plan: {
      followed,
      notFollowed,
      unanswered: reviewed.length - planAnswered,
      ratePct: planAnswered === 0 ? null : round((followed / planAnswered) * 100, 1),
    },
    scores: {
      planAdherence: reviewScore(reviewed.map((trade) => trade.review?.planAdherenceScore ?? null)),
      execution: reviewScore(reviewed.map((trade) => trade.review?.executionQuality ?? null)),
      entry: reviewScore(reviewed.map((trade) => trade.review?.entryQuality ?? null)),
      exit: reviewScore(reviewed.map((trade) => trade.review?.exitQuality ?? null)),
      riskManagement: reviewScore(reviewed.map((trade) => trade.review?.riskManagementScore ?? null)),
      emotionalControl: reviewScore(reviewed.map((trade) => trade.review?.emotionalControlScore ?? null)),
    },
    wouldTakeAgain: would,
    playbookMatch: playbook,
    topMistakes: [...mistakes.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, 8),
    customQuestions: [...customGroups.values()]
      .map(({ scaleTotal, ...metric }) => ({
        ...metric,
        average: metric.type === "SCALE" && metric.answered > 0 ? round(scaleTotal / metric.answered, 2) : null,
      }))
      .sort((a, b) => b.answered - a.answered || a.question.localeCompare(b.question)),
  };
}

export interface AdvancedAnalytics {
  lifecycle: LifecycleResult;
  exits: ExitsResult;
  score: TraderScore;
  scoreHistory: ScoreHistoryPoint[];
  reviews: TradeReviewAnalytics;
  setups: SetupRank[];
  confluences: ConfluencesResult;
  grades: GradesResult;
  sequences: SequencesResult;
  seasonality: SeasonalityResult;
  anomalies: AnomaliesResult;
}

/**
 * Phase 2 perf — compute only the requested modules. The `score` module
 * covers both the trader score and its history. Unrequested modules are
 * absent from the result; the server fills them with the zero-trade
 * shells so the payload shape stays complete.
 */
export function computeAdvancedAnalyticsModules(
  trades: AdvancedTrade[],
  stats: TradeStats,
  advanced: AdvancedStats,
  modules: readonly AdvancedModule[]
): Partial<AdvancedAnalytics> {
  const want = new Set(modules);
  const out: Partial<AdvancedAnalytics> = {};
  if (want.has("lifecycle")) out.lifecycle = computeLifecycle(trades);
  if (want.has("exits")) out.exits = computeExits(trades);
  // Phase 2 perf — the score module is the score only. Its history is
  // served from the TraderScoreSnapshot rows (server side), never from
  // the monthly replay; computeAdvancedAnalytics below still appends
  // the replayed history for pure callers and tests.
  if (want.has("score")) {
    out.score = computeTraderScore(trades, stats, advanced);
    out.reviews = computeTradeReviewAnalytics(trades);
  }
  if (want.has("setups")) out.setups = computeSetupRanking(trades);
  if (want.has("confluences")) out.confluences = computeConfluences(trades);
  if (want.has("grades")) out.grades = computeGrades(trades);
  if (want.has("sequences")) out.sequences = computeSequences(trades);
  if (want.has("seasonality")) out.seasonality = computeSeasonality(trades);
  if (want.has("anomalies")) out.anomalies = computeAnomalies(trades);
  return out;
}

export function computeAdvancedAnalytics(
  trades: AdvancedTrade[],
  stats: TradeStats,
  advanced: AdvancedStats
): AdvancedAnalytics {
  const partial = computeAdvancedAnalyticsModules(
    trades,
    stats,
    advanced,
    ADVANCED_MODULES
  ) as AdvancedAnalytics;
  // Pure callers keep the replayed monthly history; the server path
  // replaces it with the snapshot history (see getAdvancedAnalytics).
  partial.scoreHistory = computeScoreHistory(trades);
  return partial;
}
