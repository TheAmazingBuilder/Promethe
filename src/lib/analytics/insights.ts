/**
 * TradeJournal — analytics insights engine (v2 Phase 4).
 *
 * Pure computation over CLOSED trades: advanced KPIs (SQN, Sharpe/Sortino,
 * recovery factor, payoff), R-multiple distribution, multi-dimension
 * breakdowns and rule-based insights (« ce qui marche / ce qui coûte »).
 * Client-safe (no Prisma), money and R multiples through decimal.js.
 *
 * Timezone-aware fields (localDate, localWeekday, localHour) are computed
 * upstream in the user's timezone by the server module — the engine stays
 * pure and deterministic.
 */
import { D0, Decimal, toD } from "@/lib/trading/dec";
import {
  computeTradeStats,
  groupStats,
  sortChronologically,
  type GroupStat,
  type StatTrade,
  type TradeStats,
} from "./engine";

/** Closed trade summary extended with the analytics-only dimensions. */
export interface AnalyticsTrade extends StatTrade {
  accountId: string;
  accountName: string;
  timeframe: string | null;
  setupType: string | null;
  marketCondition: string | null;
  exitReason: string | null;
  emotionBefore: string | null;
  /** Followed the plan (self-assessed checkbox). */
  followedPlan: boolean | null;
  commission: string | null;
  swap: string | null;
  fees: string | null;
  /** Local calendar date (YYYY-MM-DD) of the EXIT - P&L attribution. */
  localDate: string | null;
  /** Local weekday of the ENTRY 1 (Monday) → 7 (Sunday) - decision dimension. */
  localWeekday: number | null;
  /** Local entry hour 0-23 - decision dimension. */
  localHour: number | null;
  /** Trade duration in minutes (exit − entry), null while open. */
  durationMin: number | null;
  /** Custom-field values, keyed by definition key (v2.5 Module 4 §4.7). */
  customFields?: Record<string, unknown> | null;
}

// ── Advanced KPIs ────────────────────────────────────────────────────────────

export interface AdvancedStats {
  /** System Quality Number: √N · mean(R) / std(R), R trades only. */
  sqn: string | null;
  /** Unavailable until a verified daily equity-return series is available. */
  sharpe: string | null;
  /** Unavailable until a verified daily equity-return series is available. */
  sortino: string | null;
  /** net P&L / max drawdown (> 0 means the curve recovered). */
  recoveryFactor: string | null;
  /** avgWin / avgLoss - null when one side is missing. */
  payoffRatio: string | null;
  /** Mean trade duration in minutes. */
  avgDurationMin: number | null;
  /** commission + swap + fees over the period. */
  totalFees: string;
  /** Share of trades with an R multiple, 0-100 (R analysis coverage). */
  rCoverage: string | null;
}

/** Mean of a Decimal list. */
function mean(values: Decimal[]): Decimal {
  return sumDec(values).div(values.length);
}

function sumDec(values: Decimal[]): Decimal {
  return values.reduce((acc, v) => acc.plus(v), D0);
}

/** Population standard deviation. */
function stdDev(values: Decimal[], mu: Decimal): Decimal {
  const variance = values
    .reduce((acc, v) => acc.plus(v.minus(mu).pow(2)), D0)
    .div(values.length);
  return variance.sqrt();
}

export function computeAdvancedStats(
  trades: AnalyticsTrade[],
  stats: TradeStats
): AdvancedStats {
  const ordered = sortChronologically(trades);

  // SQN — R trades only.
  const rs = ordered
    .map((t) => (t.rMultiple == null ? null : toD(t.rMultiple)))
    .filter((r): r is Decimal => r !== null);
  let sqn: Decimal | null = null;
  if (rs.length >= 2) {
    const mu = mean(rs);
    const sd = stdDev(rs, mu);
    if (sd.gt(0)) sqn = new Decimal(rs.length).sqrt().times(mu).div(sd);
  }

  // Sharpe and Sortino require daily portfolio returns, not monetary P&L.
  // We do not yet have a complete, cash-flow-adjusted daily equity-return
  // series for every account scope, so both ratios intentionally remain null.

  // Recovery factor — net P&L over max drawdown.
  const maxDd = toD(stats.maxDrawdown);
  const net = toD(stats.netPnl);
  const recoveryFactor =
    maxDd.gt(0) && net.gt(0) ? net.div(maxDd) : null;

  // Payoff ratio — avg win / avg loss.
  const avgWin = stats.avgWin != null ? toD(stats.avgWin) : null;
  const avgLoss = stats.avgLoss != null ? toD(stats.avgLoss) : null;
  const payoffRatio =
    avgWin != null && avgLoss != null && avgLoss.gt(0)
      ? avgWin.div(avgLoss)
      : null;

  const durations = ordered
    .map((t) => t.durationMin)
    .filter((d): d is number => d != null);
  const totalFees = ordered.reduce(
    (acc, t) =>
      acc
        .plus(toD(t.commission ?? 0))
        .plus(toD(t.swap ?? 0))
        .plus(toD(t.fees ?? 0)),
    D0
  );

  return {
    sqn: sqn?.toString() ?? null,
    sharpe: null,
    sortino: null,
    recoveryFactor: recoveryFactor?.toString() ?? null,
    payoffRatio: payoffRatio?.toString() ?? null,
    avgDurationMin:
      durations.length === 0
        ? null
        : Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
    totalFees: totalFees.toString(),
    rCoverage:
      ordered.length === 0
        ? null
        : new Decimal(rs.length)
            .div(ordered.length)
            .times(100)
            .toString(),
  };
}

// ── R-multiple distribution ──────────────────────────────────────────────────

export interface RDistBucket {
  /** Stable bucket id - labels are i18n keys (analytics.rdist.{id}). */
  id: string;
  /** Inclusive lower bound, null = -∞. */
  from: number | null;
  /** Exclusive upper bound, null = +∞. */
  to: number | null;
  count: number;
  /** Sum of R in the bucket. */
  totalR: string;
}

const R_EDGES: Array<{ id: string; from: number | null; to: number | null }> = [
  { id: "le-3", from: null, to: -3 },
  { id: "m3m2", from: -3, to: -2 },
  { id: "m2m1", from: -2, to: -1 },
  { id: "m10", from: -1, to: 0 },
  { id: "01", from: 0, to: 1 },
  { id: "12", from: 1, to: 2 },
  { id: "23", from: 2, to: 3 },
  { id: "ge3", from: 3, to: null },
];

export function computeRDistribution(
  trades: AnalyticsTrade[]
): { buckets: RDistBucket[]; withoutR: number } {
  const rs = trades
    .map((t) => (t.rMultiple == null ? null : toD(t.rMultiple)))
    .filter((r): r is Decimal => r !== null);

  const buckets: RDistBucket[] = R_EDGES.map((e) => ({
    ...e,
    count: 0,
    totalR: D0.toString(),
  }));
  for (const r of rs) {
    const idx = buckets.findIndex((b) => {
      const ge = b.from == null || r.gte(b.from);
      const lt = b.to == null || r.lt(b.to);
      return ge && lt;
    });
    if (idx >= 0) {
      buckets[idx].count += 1;
      buckets[idx].totalR = toD(buckets[idx].totalR).plus(r).toString();
    }
  }
  return { buckets, withoutR: trades.length - rs.length };
}

// ── Breakdowns ───────────────────────────────────────────────────────────────

export interface Breakdowns {
  strategy: GroupStat[];
  symbol: GroupStat[];
  session: GroupStat[];
  direction: GroupStat[];
  weekday: GroupStat[];
  /** 2-hour entry buckets, key = bucket start hour ("8" → 08:00-09:59). */
  hour: GroupStat[];
  setup: GroupStat[];
  exit: GroupStat[];
  emotion: GroupStat[];
  /** Followed the plan - keys "yes" / "no". */
  plan: GroupStat[];
  /**
   * Custom-field breakdowns (v2.5 Module 4 §4.7) - only for definitions
   * flagged usableInAnalytics. Keyed by definition key; each entry is a
   * GroupStat[] over the field's values. Absent when no such definition.
   */
  custom?: Record<string, GroupStat[]>;
}

/** Weekday index (1 = Monday … 7 = Sunday) from an ISO date. */
export function weekdayOfIsoDate(isoDate: string): number {
  const d = new Date(`${isoDate}T00:00:00Z`);
  // getUTCDay: 0=Sun…6=Sat → ISO 1=Mon…7=Sun
  return d.getUTCDay() === 0 ? 7 : d.getUTCDay();
}

export function computeBreakdowns(
  trades: AnalyticsTrade[],
  customDefs?: Array<{ key: string; label: string }>
): Breakdowns {
  const out: Breakdowns = {
    strategy: groupStats(trades, (t) => t.strategyName),
    symbol: groupStats(trades, (t) => t.symbol),
    session: groupStats(trades, (t) => t.session),
    direction: groupStats(trades, (t) => t.direction),
    weekday: groupStats(trades, (t) =>
      t.localWeekday != null ? String(t.localWeekday) : null
    ),
    hour: groupStats(trades, (t) =>
      t.localHour != null ? String(Math.floor(t.localHour / 2) * 2) : null
    ),
    setup: groupStats(trades, (t) => t.setupType),
    exit: groupStats(trades, (t) => t.exitReason),
    emotion: groupStats(trades, (t) => t.emotionBefore),
    plan: groupStats(trades, (t) =>
      t.followedPlan == null ? null : t.followedPlan ? "yes" : "no"
    ),
  };
  if (customDefs && customDefs.length > 0) {
    const custom: Record<string, GroupStat[]> = {};
    for (const def of customDefs) {
      custom[def.key] = groupStats(trades, (t) => {
        const v = t.customFields?.[def.key];
        if (v === null || v === undefined || v === "") return null;
        return Array.isArray(v) ? v.map(String).join(", ") : String(v);
      });
    }
    out.custom = custom;
  }
  return out;
}

// ── Insights — « ce qui marche / ce qui coûte » ─────────────────────────────

export type InsightTone = "good" | "bad" | "info";

export interface Insight {
  /** i18n key suffix - analytics.insights.{rule}. */
  rule: string;
  tone: InsightTone;
  /** Interpolation params (raw values - formatted by the view). */
  params: Record<string, string | number>;
  /** Sort weight, higher first within a tone. */
  weight: number;
}

/** Group stat → compact insight params. */
function dimParams(g: GroupStat): Record<string, string | number> {
  return {
    count: g.stats.tradeCount,
    netPnl: g.stats.netPnl,
    winRate: g.stats.winRate ?? "-",
    avgR: g.stats.avgR ?? "-",
  };
}

/** Best/worst entry of a breakdown (already sorted by net P&L desc). */
function pickEnds(
  groups: GroupStat[],
  minTrades: number
): { best: GroupStat | null; worst: GroupStat | null } {
  const eligible = groups.filter((g) => g.stats.tradeCount >= minTrades);
  if (eligible.length < 2) return { best: null, worst: null };
  // Sorted desc by netPnl — best first, worst last.
  const best = eligible[0];
  const worst = eligible[eligible.length - 1];
  // Only meaningful when the two ends actually differ.
  if (best.key === worst.key) return { best: null, worst: null };
  return { best, worst };
}

function avgROf(list: AnalyticsTrade[]): Decimal | null {
  const rs = list
    .map((t) => (t.rMultiple == null ? null : toD(t.rMultiple)))
    .filter((r): r is Decimal => r !== null);
  return rs.length === 0 ? null : mean(rs);
}

export function computeInsights(
  trades: AnalyticsTrade[],
  breakdowns: Breakdowns,
  stats: TradeStats,
  advanced: AdvancedStats
): Insight[] {
  const out: Insight[] = [];
  const ordered = sortChronologically(trades);
  if (ordered.length === 0) return out;

  const push = (i: Insight) => out.push(i);

  // ── Dimension extremes (min sample 3) ──
  const dimensionRules: Array<{
    groups: GroupStat[];
    param: string;
    rulePrefix: string;
    label: (g: GroupStat) => string | number;
  }> = [
    {
      groups: breakdowns.strategy,
      param: "name",
      rulePrefix: "Strategy",
      label: (g) => g.key,
    },
    {
      groups: breakdowns.symbol,
      param: "symbol",
      rulePrefix: "Symbol",
      label: (g) => g.key,
    },
    {
      groups: breakdowns.session,
      param: "session",
      rulePrefix: "Session",
      label: (g) => g.key,
    },
    {
      groups: breakdowns.weekday,
      param: "weekday",
      rulePrefix: "Weekday",
      label: (g) => Number(g.key),
    },
    {
      groups: breakdowns.hour,
      param: "hour",
      rulePrefix: "Hour",
      label: (g) => Number(g.key),
    },
    {
      groups: breakdowns.setup,
      param: "setup",
      rulePrefix: "Setup",
      label: (g) => g.key,
    },
  ];

  for (const dim of dimensionRules) {
    const { best, worst } = pickEnds(dim.groups, 3);
    if (best && toD(best.stats.netPnl).gt(0)) {
      push({
        rule: `best${dim.rulePrefix}`,
        tone: "good",
        params: { [dim.param]: dim.label(best), ...dimParams(best) },
        weight: toD(best.stats.netPnl).abs().toNumber(),
      });
    }
    if (worst && toD(worst.stats.netPnl).lt(0)) {
      push({
        rule: `worst${dim.rulePrefix}`,
        tone: "bad",
        params: { [dim.param]: dim.label(worst), ...dimParams(worst) },
        weight: toD(worst.stats.netPnl).abs().toNumber(),
      });
    }
  }

  // ── Emotions ──
  const { best: bestEmotion, worst: worstEmotion } = pickEnds(
    breakdowns.emotion,
    3
  );
  if (bestEmotion && bestEmotion.stats.avgR != null && toD(bestEmotion.stats.avgR).gte(0.5)) {
    push({
      rule: "emotionBest",
      tone: "good",
      params: {
        emotion: bestEmotion.key,
        ...dimParams(bestEmotion),
      },
      weight: toD(bestEmotion.stats.avgR).times(10).toNumber(),
    });
  }
  if (
    worstEmotion &&
    worstEmotion.stats.avgR != null &&
    toD(worstEmotion.stats.avgR).lte(-0.3)
  ) {
    push({
      rule: "emotionWorst",
      tone: "bad",
      params: {
        emotion: worstEmotion.key,
        ...dimParams(worstEmotion),
      },
      weight: toD(worstEmotion.stats.avgR).abs().times(10).toNumber(),
    });
  }

  // ── Discipline: plan followed vs not ──
  const planYes = ordered.filter((t) => t.followedPlan === true);
  const planNo = ordered.filter((t) => t.followedPlan === false);
  const avgRYes = avgROf(planYes);
  const avgRNo = avgROf(planNo);
  if (avgRYes != null && avgRNo != null && planYes.length >= 3 && planNo.length >= 3) {
    const gap = avgRYes.minus(avgRNo);
    if (gap.gte(0.3)) {
      push({
        rule: "disciplinePays",
        tone: "good",
        params: {
          avgRPlan: avgRYes.toString(),
          avgRNoPlan: avgRNo.toString(),
          nPlan: planYes.length,
          nNoPlan: planNo.length,
        },
        weight: gap.toNumber(),
      });
    } else if (gap.lte(-0.3)) {
      push({
        rule: "planHurts",
        tone: "bad",
        params: {
          avgRPlan: avgRYes.toString(),
          avgRNoPlan: avgRNo.toString(),
          nPlan: planYes.length,
          nNoPlan: planNo.length,
        },
        weight: gap.abs().toNumber(),
      });
    }
  }

  // ── Revenge trading: entries within 24h after a ≤ -2R loss closed ──
  const DAY_MS = 24 * 60 * 60 * 1000;
  const bigLossExits = ordered
    .filter((t) => t.rMultiple != null && toD(t.rMultiple).lte(-2))
    .map((t) => new Date(t.exitTime).getTime());
  const revengeTrades = ordered.filter((t) => {
    const entry = new Date(t.entryTime).getTime();
    return bigLossExits.some((ts) => entry >= ts && entry < ts + DAY_MS);
  });
  if (revengeTrades.length >= 3) {
    const avgR = avgROf(revengeTrades);
    if (avgR != null && avgR.lte(-0.1)) {
      push({
        rule: "revenge",
        tone: "bad",
        params: { count: revengeTrades.length, avgR: avgR.toString() },
        weight: avgR.abs().times(5).toNumber(),
      });
    } else if (avgR != null && avgR.gte(0.3)) {
      push({
        rule: "revengeManaged",
        tone: "good",
        params: { count: revengeTrades.length, avgR: avgR.toString() },
        weight: avgR.toNumber(),
      });
    }
  }

  // ── Overtrading: busy days (≥ 5 trades) vs light days (≤ 2) ──
  const daily = [...dailyPnlMap(ordered).values()];
  const busy = daily.filter((d) => d.count >= 5);
  const light = daily.filter((d) => d.count <= 2);
  if (busy.length >= 2 && light.length >= 2) {
    const rOf = (list: AnalyticsTrade[]) => {
      const rs = list
        .map((t) => (t.rMultiple == null ? null : toD(t.rMultiple)))
        .filter((r): r is Decimal => r !== null);
      return rs.length === 0 ? null : mean(rs);
    };
    const busyTrades = ordered.filter((t) => {
      const day = t.localDate ?? t.exitTime.slice(0, 10);
      return busy.some((d) => d.date === day);
    });
    const lightTrades = ordered.filter((t) => {
      const day = t.localDate ?? t.exitTime.slice(0, 10);
      return light.some((d) => d.date === day);
    });
    const busyR = rOf(busyTrades);
    const lightR = rOf(lightTrades);
    if (busyR != null && lightR != null && busyR.lt(lightR.minus(0.2))) {
      push({
        rule: "overtrading",
        tone: "bad",
        params: {
          busyDays: busy.length,
          busyTrades: busyTrades.length,
          busyAvgR: busyR.toString(),
          lightAvgR: lightR.toString(),
        },
        weight: lightR.minus(busyR).toNumber(),
      });
    }
  }

  // ── Payoff: frequent small wins, bigger losses ──
  if (
    advanced.payoffRatio != null &&
    stats.winRate != null &&
    toD(advanced.payoffRatio).lt(0.8) &&
    toD(stats.winRate).gt(50)
  ) {
    push({
      rule: "smallWinsBigLosses",
      tone: "bad",
      params: {
        payoff: advanced.payoffRatio,
        winRate: stats.winRate,
      },
      weight: 2,
    });
  }

  // ── Fees drag ──
  const grossWin = toD(stats.grossWin);
  const totalFees = toD(advanced.totalFees);
  if (grossWin.gt(0) && totalFees.div(grossWin).gte(0.1)) {
    push({
      rule: "feesDrag",
      tone: "info",
      params: {
        fees: totalFees.toString(),
        pct: totalFees.div(grossWin).times(100).toString(),
      },
      weight: 1,
    });
  }

  // ── Recovery / drawdown context ──
  if (advanced.recoveryFactor != null) {
    push({
      rule: "recovery",
      tone: "info",
      params: {
        pnl: stats.netPnl,
        dd: stats.maxDrawdown ?? "0",
        rf: advanced.recoveryFactor,
      },
      weight: 1,
    });
  }

  // ── Loss streak guidance ──
  if (stats.maxLossStreak >= 5) {
    push({
      rule: "lossStreak",
      tone: "info",
      params: { count: stats.maxLossStreak },
      weight: 1,
    });
  }

  // ── R coverage ──
  if (advanced.rCoverage != null && toD(advanced.rCoverage).lt(70)) {
    push({
      rule: "rCoverage",
      tone: "info",
      params: { pct: advanced.rCoverage },
      weight: 0.5,
    });
  }

  return out.sort((a, b) => b.weight - a.weight);
}
