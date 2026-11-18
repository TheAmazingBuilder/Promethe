/**
 * Weekly improvement plan (MRT wave 1, chantier 1) — rule-based engine.
 *
 * Pure computation over CLOSED trades from the last 30 days: up to five
 * actions for next week, each with the numbers that justify it and a
 * measurable target, plus an honest edge check, strengths / fixes and
 * patterns found. No AI, no chat, no invented data: every figure carries
 * its sample size, and under five trades no plan is generated at all.
 *
 * The engine reuses the existing analytics: computeTraderScore (discipline
 * /100 is reused as-is, never recomputed another way), setup ranking with
 * Wilson intervals, sequences (after-loss behaviour) and seasonality
 * inputs (weekday / hour come from the local entry parts). Grades A+/A/B/C
 * do not exist in Promethe yet, so no rule depends on them.
 */
import { D0, toD, type Decimal } from "@/lib/trading/dec";
import type {
  AdvancedTrade,
  ScoreComponents,
  ScoreGrade,
  SequencesResult,
  SetupRank,
  TraderScore,
} from "./advanced";
import type { AdvancedStats } from "./insights";
import type { TradeStats } from "./engine";
import { mean, stdDev } from "./stats";

/** Minimum closed trades in the 30-day window to generate a plan. */
export const MIN_TRADES_FOR_PLAN = 5;
/** Trades needed before the edge verdict can be "yes". */
export const MIN_TRADES_FOR_EDGE = 20;
/** Window the plan is built from, in days. */
export const PLAN_WINDOW_DAYS = 30;

export type WeeklyRuleKey =
  | "worst-session"
  | "worst-hour"
  | "after-loss"
  | "off-playbook"
  | "deep-losses"
  | "losing-setup"
  | "worst-weekday"
  | "discipline";

export const WEEKLY_RULE_KEYS: readonly WeeklyRuleKey[] = [
  "worst-session",
  "worst-hour",
  "after-loss",
  "off-playbook",
  "deep-losses",
  "losing-setup",
  "worst-weekday",
  "discipline",
];

export interface PlanEvidence {
  /** Trades behind the figure. */
  trades: number;
  /** Raw signed net P&L of those trades (unformatted — the view renders it
   * through <Money/>, the single choke point, so privacy modes apply). */
  netPnl: string;
  /** Currency of netPnl. */
  currency: string;
  /** Mean R of those trades, null when no R multiple is recorded. */
  avgR: number | null;
  /** Win rate 0-100 of those trades, null when no trade is decided. */
  winRate: number | null;
  /** Sentence fragment without the money part, e.g. "9 London session trades".
   * The view appends the formatted money after it. */
  label: string;
  /** Optional text rendered after the money, e.g. ", expectancy -1.00R". */
  suffix?: string;
}

export interface PlanActionDrilldown {
  /** Trades list URL with the exact filter for this leak. */
  href: string;
}

export interface PlanAction {
  rule: WeeklyRuleKey;
  /** 1-based rank, 1 = the biggest leak ("fix this first"). */
  rank: number;
  title: string;
  evidence: PlanEvidence;
  /** Measurable target for the week, e.g. "No entries after 10:30 for 5 days". */
  target: string;
  /** Checked off for this week (merged in by the server, default false). */
  done: boolean;
  /**
   * Deep link to the filtered trades behind this leak, when the trades
   * list can filter on it exactly (session, weekday). Null otherwise:
   * the weekly plan page itself is the detail view for those rules
   * (the 2-hour bucket has no exact single-hour filter, after-loss
   * needs sequence context, and there is no setup / playbook filter).
   */
  drilldown: PlanActionDrilldown | null;
}

/**
 * Toggle response (Phase 2 perf): the stored checkbox state. The full
 * action (rank, evidence, drilldown) comes from the plan GET — the
 * client refetches the plan after a toggle, so the POST only needs to
 * confirm which stored row changed.
 */
export interface WeeklyPlanToggleResult {
  rule: WeeklyRuleKey;
  title: string;
  target: string;
  done: boolean;
}

/**
 * Exact trades-list link for a leak, or null when no exact filter exists.
 * Pure and unit-tested (tests/unit/top-leaks.test.ts).
 */
export function planActionDrilldown(
  rule: WeeklyRuleKey,
  detail: { session?: string | null; weekday?: number | null }
): PlanActionDrilldown | null {
  if (rule === "worst-session" && detail.session != null) {
    return { href: `/trades?session=${encodeURIComponent(detail.session)}` };
  }
  if (rule === "worst-weekday" && detail.weekday != null) {
    return { href: `/trades?entryWeekday=${detail.weekday}` };
  }
  return null;
}

export type EdgeVerdict = "yes" | "not-yet" | "no";

export interface EdgeCheck {
  verdict: EdgeVerdict;
  expectancyR: number | null;
  /** Closed trades in the window. */
  sampleSize: number;
  /** Lower bound of the 95% range for mean R, null when not computable. */
  meanRLower95: number | null;
  sqn: number | null;
  /** Plain explanation with the numbers. */
  reason: string;
}

export interface PatternFound {
  id: string;
  label: string;
  detail: string;
  tone: "good" | "bad" | "neutral";
  /** Trades behind the pattern. */
  sampleSize: number;
}

export interface WeeklyPlan {
  /** Monday of the week the plan covers, YYYY-MM-DD. */
  weekStart: string;
  /** Sunday of that week, YYYY-MM-DD. */
  weekEnd: string;
  windowDays: number;
  /** Closed trades in the window. */
  sampleSize: number;
  /** False under five trades: no action is generated, ever. */
  sufficient: boolean;
  /** At most five actions, ranked by money lost, biggest leak first. */
  actions: PlanAction[];
  /** The number one leak, same object as actions[0], null when no plan. */
  fixFirst: PlanAction | null;
  /** Discipline score 0-100, reused from computeTraderScore. */
  disciplineScore: number;
  scoreGrade: ScoreGrade;
  scoreComponents: ScoreComponents;
  edge: EdgeCheck;
  /** "What you do well", plain sentences with numbers. */
  strengths: string[];
  /** "What to fix", plain sentences with numbers. */
  fixes: string[];
  patterns: PatternFound[];
}

export interface WeeklyPlanInput {
  trades: AdvancedTrade[];
  stats: TradeStats;
  advanced: AdvancedStats;
  score: TraderScore;
  setups: SetupRank[];
  sequences: SequencesResult;
  weekStart: string;
  weekEnd: string;
  currency: string;
}

// ── Week helpers (Monday-Sunday, user timezone) ─────────────────────────────

const WEEKDAY_MON0: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toDayKey(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Monday (YYYY-MM-DD) of the week containing `now`, in `timeZone`.
 * Pure and deterministic; the server passes the user's profile timezone.
 */
export function weekStartMonday(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const offset = WEEKDAY_MON0[get("weekday")] ?? 0;
  const monday = new Date(Date.UTC(year, month - 1, day - offset));
  return toDayKey(
    monday.getUTCFullYear(),
    monday.getUTCMonth() + 1,
    monday.getUTCDate()
  );
}

/** Sunday (YYYY-MM-DD) of the week starting on `weekStart` (a Monday). */
export function weekEndSunday(weekStart: string): string {
  const [y, m, d] = weekStart.split("-").map(Number);
  const sunday = new Date(Date.UTC(y, m - 1, d + 6));
  return toDayKey(
    sunday.getUTCFullYear(),
    sunday.getUTCMonth() + 1,
    sunday.getUTCDate()
  );
}

// ── Small helpers ────────────────────────────────────────────────────────────

function round(value: number | null, digits = 2): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function fmtR(value: number | null): string {
  if (value == null) return "n/a";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}R`;
}

const SESSION_LABELS: Record<string, string> = {
  ASIAN: "Asian",
  LONDON: "London",
  NEW_YORK: "New York",
  OVERLAP: "Overlap",
  OTHER: "Other",
};

export function sessionLabel(session: string | null): string {
  if (session == null) return "Unknown";
  return SESSION_LABELS[session] ?? session;
}

const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export function weekdayName(weekday: number): string {
  return WEEKDAY_NAMES[weekday - 1] ?? `Day ${weekday}`;
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

function groupBy<K extends string | number>(
  trades: AdvancedTrade[],
  key: (t: AdvancedTrade) => K | null
): Map<K, AdvancedTrade[]> {
  const out = new Map<K, AdvancedTrade[]>();
  for (const t of trades) {
    const k = key(t);
    if (k == null) continue;
    const list = out.get(k) ?? [];
    list.push(t);
    out.set(k, list);
  }
  return out;
}

// ── Edge check ───────────────────────────────────────────────────────────────

export function checkEdge(
  trades: AdvancedTrade[],
  stats: TradeStats,
  advanced: AdvancedStats
): EdgeCheck {
  const rs = trades
    .map((t) => (t.rMultiple == null ? null : Number(t.rMultiple)))
    .filter((v): v is number => v != null && Number.isFinite(v));
  const n = trades.length;
  const expectancy =
    stats.expectancyR != null ? Number(stats.expectancyR) : null;
  const sqn = advanced.sqn != null ? Number(advanced.sqn) : null;
  let lower95: number | null = null;
  if (rs.length >= 2) {
    const mu = mean(rs);
    const sd = stdDev(rs);
    if (mu != null && sd != null) {
      lower95 = round(mu - 1.96 * (sd / Math.sqrt(rs.length)), 2);
    }
  }
  const expText = expectancy != null ? `${fmtR(expectancy)}` : "n/a";
  if (n < MIN_TRADES_FOR_EDGE) {
    return {
      verdict: "not-yet",
      expectancyR: expectancy,
      sampleSize: n,
      meanRLower95: lower95,
      sqn: sqn != null ? round(sqn, 2) : null,
      reason: `Only ${n} trades in the last 30 days. At least ${MIN_TRADES_FOR_EDGE} trades are needed before the edge can be judged.`,
    };
  }
  if (expectancy == null || expectancy <= 0) {
    return {
      verdict: "no",
      expectancyR: expectancy,
      sampleSize: n,
      meanRLower95: lower95,
      sqn: sqn != null ? round(sqn, 2) : null,
      reason: `Expectancy is ${expText} over ${n} trades. The edge is not positive in this window.`,
    };
  }
  if (lower95 != null && lower95 > 0) {
    return {
      verdict: "yes",
      expectancyR: expectancy,
      sampleSize: n,
      meanRLower95: lower95,
      sqn: sqn != null ? round(sqn, 2) : null,
      reason: `Expectancy is ${expText} over ${n} trades, and the lower bound of the 95% range is still above zero (${fmtR(lower95)}).`,
    };
  }
  return {
    verdict: "not-yet",
    expectancyR: expectancy,
    sampleSize: n,
    meanRLower95: lower95,
    sqn: sqn != null ? round(sqn, 2) : null,
    reason: `Expectancy is ${expText} over ${n} trades, but the 95% range still reaches below zero (${fmtR(lower95)}). More trades are needed.`,
  };
}

// ── Rule engine ──────────────────────────────────────────────────────────────

interface Candidate {
  rule: WeeklyRuleKey;
  title: string;
  target: string;
  evidence: PlanEvidence;
  /** Absolute money lost, for ranking (biggest leak first). */
  loss: Decimal;
  /** Exact trades-list link when one exists, null otherwise. */
  drilldown: PlanActionDrilldown | null;
}

function evidenceFor(
  slice: Slice,
  label: string,
  currency: string,
  suffix?: string
): PlanEvidence {
  return {
    trades: slice.trades.length,
    netPnl: slice.net.toString(),
    currency,
    avgR: slice.avgR,
    winRate: slice.winRate,
    label,
    ...(suffix != null ? { suffix } : {}),
  };
}

function buildCandidates(
  input: WeeklyPlanInput
): { candidates: Candidate[]; offPlaybookSource: "playbook" | "plan" | null } {
  const { trades, score, setups, currency } = input;
  const candidates: Candidate[] = [];
  let offPlaybookSource: "playbook" | "plan" | null = null;

  // Worst session by net P&L (at least 3 trades, losing).
  const bySession = groupBy(trades, (t) => t.session);
  let worstSession: { key: string; slice: Slice } | null = null;
  for (const [key, list] of bySession) {
    if (list.length < 3) continue;
    const slice = sliceStats(list);
    if (!slice.net.lt(0)) continue;
    if (worstSession == null || slice.net.lt(worstSession.slice.net)) {
      worstSession = { key, slice };
    }
  }
  if (worstSession != null) {
    const label = sessionLabel(worstSession.key);
    candidates.push({
      rule: "worst-session",
      title: `Cut back on ${label} session trades`,
      target: `No ${label} session entries for 5 trading days`,
      evidence: evidenceFor(
        worstSession.slice,
        `${worstSession.slice.trades.length} ${label} session trades`,
        currency
      ),
      loss: worstSession.slice.net.abs(),
      drilldown: planActionDrilldown("worst-session", {
        session: worstSession.key,
      }),
    });
  }

  // Worst 2-hour entry bucket (local hour, at least 3 trades, losing).
  const byHour = groupBy(trades, (t) =>
    t.localHour == null ? null : Math.floor(t.localHour / 2) * 2
  );
  let worstHour: { hour: number; slice: Slice } | null = null;
  for (const [hour, list] of byHour) {
    if (list.length < 3) continue;
    const slice = sliceStats(list);
    if (!slice.net.lt(0)) continue;
    if (worstHour == null || slice.net.lt(worstHour.slice.net)) {
      worstHour = { hour, slice };
    }
  }
  if (worstHour != null) {
    const h = worstHour.hour;
    const next = (h + 2) % 24;
    candidates.push({
      rule: "worst-hour",
      title: `Stop trading between ${pad(h)}:00 and ${pad(next)}:00`,
      target: `No entries between ${pad(h)}:00 and ${pad(next)}:00 for 5 trading days`,
      evidence: evidenceFor(
        worstHour.slice,
        `${worstHour.slice.trades.length} trades entered between ${pad(h)}:00 and ${pad(next)}:00`,
        currency
      ),
      loss: worstHour.slice.net.abs(),
      // No exact filter: the trades list filters one entry hour, not a 2-hour bucket.
      drilldown: null,
    });
  }

  // Trades taken right after a loss (revenge trading): chronological,
  // decided trades only, breakevens neither extend a streak nor count.
  const decided = [...trades]
    .filter((t) => t.resultType === "WIN" || t.resultType === "LOSS")
    .sort((a, b) => a.entryTime.localeCompare(b.entryTime));
  const afterLoss: AdvancedTrade[] = [];
  for (let i = 0; i + 1 < decided.length; i++) {
    if (decided[i].resultType === "LOSS") afterLoss.push(decided[i + 1]);
  }
  if (afterLoss.length >= 5) {
    const slice = sliceStats(afterLoss);
    if (slice.avgR != null && slice.avgR < 0) {
      candidates.push({
        rule: "after-loss",
        title: "Pause after a loss before re-entering",
        target:
          "After a losing trade, wait at least 30 minutes before the next entry, for 5 trading days",
        evidence: evidenceFor(
          slice,
          `${slice.trades.length} trades taken right after a loss`,
          currency,
          `, ${fmtR(slice.avgR)} on average`
        ),
        loss: slice.net.abs(),
        drilldown: null,
      });
    }
  }

  // Trades off the playbook (declared playbookMatch first, followedPlan fallback).
  const offPlaybook = trades.filter(
    (t) => t.playbookMatch === "OFF_PLAYBOOK"
  );
  const deviated = trades.filter((t) => t.followedPlan === false);
  const offSlice =
    offPlaybook.length >= 2
      ? { slice: sliceStats(offPlaybook), source: "playbook" as const }
      : deviated.length >= 3
        ? { slice: sliceStats(deviated), source: "plan" as const }
        : null;
  if (offSlice != null && offSlice.slice.net.lt(0)) {
    offPlaybookSource = offSlice.source;
    const label =
      offSlice.source === "playbook"
        ? "did not match your playbook"
        : "deviated from your plan";
    candidates.push({
      rule: "off-playbook",
      title: "Only take trades that match your playbook",
      target: "Every entry this week matches a playbook setup",
      evidence: evidenceFor(
        offSlice.slice,
        `${offSlice.slice.trades.length} trades ${label}`,
        currency
      ),
      loss: offSlice.slice.net.abs(),
      drilldown: null,
    });
  }

  // Losses deeper than -1R.
  const deep = trades.filter(
    (t) => t.rMultiple != null && Number(t.rMultiple) < -1
  );
  if (deep.length >= 2) {
    const slice = sliceStats(deep);
    const excessR = round(
      deep.reduce(
        (acc, t) => acc + (Math.abs(Number(t.rMultiple)) - 1),
        0
      ),
      2
    );
    candidates.push({
      rule: "deep-losses",
      title: "Cap every loss at 1R",
      target: "No single loss worse than -1R this week",
      evidence: evidenceFor(
        slice,
        `${slice.trades.length} trades lost more than 1R (${fmtR(excessR != null ? -excessR : null)} beyond 1R in total)`,
        currency
      ),
      loss: slice.net.abs(),
      drilldown: null,
    });
  }

  // Losing setup (Wilson-ranked, at least 10 trades, negative expectancy).
  const losing = setups
    .filter((s) => s.category === "losing")
    .sort((a, b) => (a.totalR ?? 0) - (b.totalR ?? 0))[0];
  if (losing != null) {
    const list = trades.filter(
      (t) =>
        (t.setupType && t.setupType.trim() !== "" ? t.setupType : "__none__") ===
        losing.key
    );
    const slice = sliceStats(list);
    const name = losing.key === "__none__" ? "Untagged setup" : losing.key;
    candidates.push({
      rule: "losing-setup",
      title: `Pause the ${name} setup`,
      target: `No ${name} trades for 5 trading days`,
      evidence: evidenceFor(
        slice,
        `${slice.trades.length} ${name} trades`,
        currency,
        `, expectancy ${fmtR(losing.expectancy)}`
      ),
      loss: slice.net.abs(),
      drilldown: null,
    });
  }

  // Worst weekday by net P&L (local entry weekday, at least 3 trades, losing).
  const byWeekday = groupBy(trades, (t) => t.localWeekday);
  let worstDay: { day: number; slice: Slice } | null = null;
  for (const [day, list] of byWeekday) {
    if (list.length < 3) continue;
    const slice = sliceStats(list);
    if (!slice.net.lt(0)) continue;
    if (worstDay == null || slice.net.lt(worstDay.slice.net)) {
      worstDay = { day, slice };
    }
  }
  if (worstDay != null) {
    const name = weekdayName(worstDay.day);
    candidates.push({
      rule: "worst-weekday",
      title: `Stay out on ${name}s`,
      target: `No trades on ${name} this week`,
      evidence: evidenceFor(
        worstDay.slice,
        `${worstDay.slice.trades.length} trades entered on ${name}s`,
        currency
      ),
      loss: worstDay.slice.net.abs(),
      drilldown: planActionDrilldown("worst-weekday", {
        weekday: worstDay.day,
      }),
    });
  }

  // Discipline: weakest component and losing deviated trades. Skipped when
  // the off-playbook rule already used the same deviated population.
  if (offPlaybookSource !== "plan" && score.components.discipline < 15) {
    if (deviated.length >= 3) {
      const slice = sliceStats(deviated);
      if (slice.net.lt(0)) {
        const planRate = score.details.planRate;
        candidates.push({
          rule: "discipline",
          title: "Check your plan before every entry",
          target: "Follow the plan on every trade this week",
          evidence: evidenceFor(
            slice,
            `${slice.trades.length} trades deviated from the plan`,
            currency,
            planRate != null
              ? ` (plan followed ${planRate}% of the time)`
              : undefined
          ),
          loss: slice.net.abs(),
          drilldown: null,
        });
      }
    }
  }

  return { candidates, offPlaybookSource };
}

// ── Whole plan ───────────────────────────────────────────────────────────────

export function generateWeeklyPlan(input: WeeklyPlanInput): WeeklyPlan {
  const { trades, stats, advanced, score, setups, sequences } = input;
  const edge = checkEdge(trades, stats, advanced);
  const base: WeeklyPlan = {
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
    windowDays: PLAN_WINDOW_DAYS,
    sampleSize: trades.length,
    sufficient: trades.length >= MIN_TRADES_FOR_PLAN,
    actions: [],
    fixFirst: null,
    disciplineScore: score.total,
    scoreGrade: score.grade,
    scoreComponents: score.components,
    edge,
    strengths: [],
    fixes: [],
    patterns: [],
  };
  if (!base.sufficient) return base;

  const { candidates } = buildCandidates(input);
  // Biggest leak first; stable order by rule key on ties.
  candidates.sort(
    (a, b) =>
      b.loss.cmp(a.loss) || a.rule.localeCompare(b.rule)
  );
  const actions: PlanAction[] = candidates.slice(0, 5).map((c, i) => ({
    rule: c.rule,
    rank: i + 1,
    title: c.title,
    evidence: c.evidence,
    target: c.target,
    done: false,
    drilldown: c.drilldown,
  }));
  base.actions = actions;
  base.fixFirst = actions[0] ?? null;

  const { currency } = input;

  // ── Strengths ("What you do well") ──
  const strengths: string[] = [];
  const proven = setups.filter((s) => s.category === "proven").slice(0, 2);
  for (const s of proven) {
    const name = s.key === "__none__" ? "Untagged setup" : s.key;
    strengths.push(
      `${name}: ${s.winRate ?? "n/a"}% win rate over ${s.count} trades, expectancy ${fmtR(s.expectancy)}`
    );
  }
  if (proven.length === 0) {
    const promising = setups
      .filter((s) => s.category === "promising")
      .slice(0, 2);
    for (const s of promising) {
      const name = s.key === "__none__" ? "Untagged setup" : s.key;
      strengths.push(
        `${name}: ${s.winRate ?? "n/a"}% win rate over ${s.count} trades, expectancy ${fmtR(s.expectancy)}`
      );
    }
  }
  const bySession = groupBy(trades, (t) => t.session);
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
    strengths.push(
      `${sessionLabel(bestSession.key)} session: ${fmtR(bestSession.slice.avgR)} on average over ${bestSession.slice.trades.length} trades`
    );
  }
  const planYes = trades.filter((t) => t.followedPlan === true);
  const planNo = trades.filter((t) => t.followedPlan === false);
  if (planYes.length >= 3 && planNo.length >= 3) {
    const yesRate = sliceStats(planYes).winRate;
    const noRate = sliceStats(planNo).winRate;
    if (yesRate != null && noRate != null && yesRate > noRate) {
      strengths.push(
        `You win ${yesRate}% when you follow your plan, vs ${noRate}% when you do not (${planYes.length} vs ${planNo.length} trades)`
      );
    }
  }
  if (score.components.discipline >= 20) {
    strengths.push(
      `Discipline is your strongest score component (${score.components.discipline}/25)`
    );
  }
  base.strengths = strengths;

  // ── Fixes ("What to fix") ──
  const fixes: string[] = [];
  for (const a of actions) fixes.push(`${a.title}: ${a.evidence.label}`);
  const losingSetups = setups.filter((s) => s.category === "losing");
  for (const s of losingSetups) {
    const name = s.key === "__none__" ? "Untagged setup" : s.key;
    const line = `${name}: expectancy ${fmtR(s.expectancy)} over ${s.count} trades`;
    if (!fixes.some((f) => f.includes(name))) fixes.push(line);
  }
  const deep = trades.filter(
    (t) => t.rMultiple != null && Number(t.rMultiple) < -1
  );
  if (deep.length >= 2 && !actions.some((a) => a.rule === "deep-losses")) {
    fixes.push(
      `${deep.length} trades lost more than 1R in the last 30 days`
    );
  }
  const offCount = trades.filter(
    (t) => t.playbookMatch === "OFF_PLAYBOOK"
  ).length;
  if (offCount >= 2 && !actions.some((a) => a.rule === "off-playbook")) {
    fixes.push(`${offCount} of ${trades.length} trades did not match the playbook`);
  }
  if (score.components.discipline < 15) {
    fixes.push(
      `Discipline is your weakest score component (${score.components.discipline}/25)`
    );
  }
  base.fixes = fixes;

  // ── Patterns found ──
  const patterns: PatternFound[] = [];
  const byWeekday = groupBy(trades, (t) => t.localWeekday);
  let bestDay: { day: number; slice: Slice } | null = null;
  let worstHour: { hour: number; slice: Slice } | null = null;
  for (const [day, list] of byWeekday) {
    if (list.length < 3) continue;
    const slice = sliceStats(list);
    if (slice.avgR == null || slice.avgR <= 0) continue;
    if (bestDay == null || (slice.avgR ?? 0) > (bestDay.slice.avgR ?? 0)) {
      bestDay = { day, slice };
    }
  }
  if (bestDay != null) {
    patterns.push({
      id: "best-weekday",
      label: `Your best day is ${weekdayName(bestDay.day)}`,
      detail: `${fmtR(bestDay.slice.avgR)} on average over ${bestDay.slice.trades.length} trades`,
      tone: "good",
      sampleSize: bestDay.slice.trades.length,
    });
  }
  const byHour = groupBy(trades, (t) =>
    t.localHour == null ? null : Math.floor(t.localHour / 2) * 2
  );
  for (const [hour, list] of byHour) {
    if (list.length < 3) continue;
    const slice = sliceStats(list);
    if (slice.avgR == null || slice.avgR >= 0) continue;
    if (worstHour == null || (slice.avgR ?? 0) < (worstHour.slice.avgR ?? 0)) {
      worstHour = { hour, slice };
    }
  }
  if (worstHour != null) {
    const h = worstHour.hour;
    patterns.push({
      id: "worst-hour",
      label: `Your worst hours are ${pad(h)}:00 to ${pad((h + 2) % 24)}:00`,
      detail: `${fmtR(worstHour.slice.avgR)} on average over ${worstHour.slice.trades.length} trades`,
      tone: "bad",
      sampleSize: worstHour.slice.trades.length,
    });
  }
  if (bestSession != null) {
    patterns.push({
      id: "best-session",
      label: `${sessionLabel(bestSession.key)} is your best session`,
      detail: `${fmtR(bestSession.slice.avgR)} on average over ${bestSession.slice.trades.length} trades`,
      tone: "good",
      sampleSize: bestSession.slice.trades.length,
    });
  }
  if (stats.maxLossStreak >= 2) {
    patterns.push({
      id: "loss-streak",
      label: `Longest losing streak: ${stats.maxLossStreak} trades`,
      detail: `Your longest winning streak in the same window is ${stats.maxWinStreak} trades`,
      tone: stats.maxLossStreak >= 3 ? "bad" : "neutral",
      sampleSize: trades.length,
    });
  }
  const m = sequences.matrix;
  if (
    m.pWinAfterLoss != null &&
    m.pWinAfterWin != null &&
    sequences.decided >= 10
  ) {
    patterns.push({
      id: "after-loss",
      label: `After a loss you win ${m.pWinAfterLoss}% of the time, vs ${m.pWinAfterWin}% after a win`,
      detail: `Based on ${sequences.decided} decided trades in the last 30 days`,
      tone: m.pWinAfterLoss < m.pWinAfterWin ? "bad" : "good",
      sampleSize: sequences.decided,
    });
  }
  base.patterns = patterns;

  return base;
}
