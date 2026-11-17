/**
 * Playbook pure logic (Phase 2) — no DB, no I/O, unit-tested.
 *
 * Health flags are factual completeness indicators (Euforia §20), never
 * profitability judgments. Compliance counts MATCHED only: a half-followed
 * plan is not a followed plan. Unreviewed trades are reported, never
 * silently judged.
 */
import type { StrategyHealthFlag } from "@/lib/trading/dto";

export interface HealthInput {
  status: string;
  /** Any risk frame: default risk %, risk rules, or a risk block. */
  hasRisk: boolean;
  /** Entry rules text or structured entry conditions. */
  hasEntryConditions: boolean;
  /** Strategy invalidations, or at least one setup (setups always carry
   *  a mandatory invalidation). */
  hasInvalidation: boolean;
  /** At least one checklist item. */
  hasChecklist: boolean;
  /** Most recent closed-trade exit (null = never traded). */
  lastTradeAt: Date | null;
  now?: Date;
}

const RECENT_DAYS = 30;

export function strategyHealthFlags(input: HealthInput): StrategyHealthFlag[] {
  const flags: StrategyHealthFlag[] = [];
  if (input.status === "DRAFT") flags.push("DRAFT");
  if (input.status === "ARCHIVED") flags.push("ARCHIVED");
  const now = input.now ?? new Date();
  const live = input.status !== "DRAFT" && input.status !== "ARCHIVED";
  if (live) {
    const recent =
      input.lastTradeAt != null &&
      now.getTime() - input.lastTradeAt.getTime() <=
        RECENT_DAYS * 24 * 60 * 60 * 1000;
    if (!recent) flags.push("NO_RECENT_TRADES");
  }
  if (!input.hasRisk) flags.push("MISSING_RISK");
  if (!input.hasEntryConditions) flags.push("MISSING_ENTRY_CONDITIONS");
  if (!input.hasInvalidation) flags.push("MISSING_INVALIDATION");
  if (!input.hasChecklist) flags.push("MISSING_CHECKLIST");
  return flags;
}

export interface ComplianceInput {
  /** Declared at review time; null = trade not reviewed for the playbook. */
  playbookMatch: string | null;
}

export interface ComplianceResult {
  reviewed: number;
  matched: number;
  partial: number;
  offPlaybook: number;
  unreviewed: number;
  /** matched / reviewed x 100, null when nothing was reviewed. */
  scorePct: number | null;
}

export function complianceSummary(
  window: ComplianceInput[],
): ComplianceResult {
  let matched = 0;
  let partial = 0;
  let offPlaybook = 0;
  for (const t of window) {
    if (t.playbookMatch === "MATCHED") matched += 1;
    else if (t.playbookMatch === "PARTIAL") partial += 1;
    else if (t.playbookMatch === "OFF_PLAYBOOK") offPlaybook += 1;
  }
  const reviewed = matched + partial + offPlaybook;
  return {
    reviewed,
    matched,
    partial,
    offPlaybook,
    unreviewed: window.length - reviewed,
    scorePct:
      reviewed === 0 ? null : Math.round((matched / reviewed) * 1000) / 10,
  };
}

export interface InsightTrade {
  resultType: string | null;
  rMultiple: number | null;
  instrumentId: string;
  symbol: string;
  session: string | null;
}

export interface SetupInsightResult {
  trades: number;
  wins: number;
  winRatePct: number | null;
  totalR: number | null;
  expectancyR: number | null;
  topInstrument: string | null;
  topInstrumentId: string | null;
  topSession: string | null;
  smallSample: boolean;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function setupInsight(trades: InsightTrade[]): SetupInsightResult {
  const rs = trades
    .map((t) => t.rMultiple)
    .filter((r): r is number => r !== null && Number.isFinite(r));
  const wins = trades.filter((t) => t.resultType === "WIN").length;
  const totalR = rs.length === 0 ? null : round2(rs.reduce((a, b) => a + b, 0));

  // Best instrument by summed R (heuristic, not a claim).
  const byInstrument = new Map<string, { symbol: string; r: number }>();
  for (const t of trades) {
    const cur = byInstrument.get(t.instrumentId) ?? { symbol: t.symbol, r: 0 };
    cur.r += t.rMultiple ?? 0;
    byInstrument.set(t.instrumentId, cur);
  }
  let topInstrument: string | null = null;
  let topInstrumentId: string | null = null;
  let bestR = -Infinity;
  for (const [id, v] of byInstrument) {
    if (v.r > bestR) {
      bestR = v.r;
      topInstrument = v.symbol;
      topInstrumentId = id;
    }
  }

  // Dominant entry session (most trades; ties keep the first seen).
  const bySession = new Map<string, number>();
  for (const t of trades) {
    if (!t.session) continue;
    bySession.set(t.session, (bySession.get(t.session) ?? 0) + 1);
  }
  let topSession: string | null = null;
  let bestCount = 0;
  for (const [s, n] of bySession) {
    if (n > bestCount) {
      bestCount = n;
      topSession = s;
    }
  }

  return {
    trades: trades.length,
    wins,
    winRatePct:
      trades.length === 0 ? null : round2((wins / trades.length) * 100),
    totalR,
    expectancyR: rs.length === 0 ? null : round2(rs.reduce((a, b) => a + b, 0) / rs.length),
    topInstrument,
    topInstrumentId,
    topSession,
    smallSample: trades.length < 5,
  };
}

/** Cumulative R curve (oldest first) for a strategy sparkline. */
export function cumulativeR(
  rs: Array<{ r: number; at: Date }>,
  maxPoints = 60,
): number[] {
  const ordered = [...rs].sort((a, b) => a.at.getTime() - b.at.getTime());
  const curve: number[] = [];
  let cum = 0;
  for (const p of ordered) {
    cum = round2(cum + p.r);
    curve.push(cum);
  }
  if (curve.length <= maxPoints) return curve;
  const step = curve.length / maxPoints;
  const sampled: number[] = [];
  for (let i = 0; i < maxPoints; i += 1) {
    sampled.push(curve[Math.floor(i * step)] as number);
  }
  return sampled;
}
