/**
 * v3 — Reconciliation matcher (PURE, unit-tested).
 *
 * For each broker-sourced trade, finds MANUAL trades in the same account
 * that are probably the same trade: same instrument (after mapping) and
 * direction REQUIRED; scored by entry-time proximity, entry-price tolerance
 * in pips, lots equality and exit proximity. Exact externalId = certain.
 *
 * Output: score 0-1 with human-readable reasons (v3 §4.3).
 */
import { toD, type DecimalInput } from "@/lib/trading/dec";

export interface MatcherTradeLike {
  id: string;
  instrumentId: string;
  direction: string;
  entryTime: Date | string;
  entryPrice: DecimalInput;
  exitTime?: Date | string | null;
  exitPrice?: DecimalInput | null;
  lots: DecimalInput;
  externalId?: string | null;
  /** Manual trades may only have a date (no time). */
  dateOnly?: boolean;
}

export interface MatcherConfig {
  /** Candidate creation threshold. */
  minScore: number;
  /** High-confidence threshold (bulk/auto merge). */
  autoMergeScore: number;
  /** Entry price tolerance in PIPS (stricter forex, wider gold - the caller
   *  passes per-instrument pipSize and a suitable tolerance). */
  entryTolerancePips: number;
  /** Absolute lots epsilon. */
  lotsEpsilon: number;
}

export const DEFAULT_MATCHER_CONFIG: MatcherConfig = {
  minScore: 0.6,
  autoMergeScore: 0.9,
  entryTolerancePips: 3,
  lotsEpsilon: 0.01,
};

export interface MatchReason {
  code: string;
  weight: number;
  detail?: string;
}

export interface MatchScore {
  score: number;
  reasons: MatchReason[];
}

/** Pip size lookup the caller provides (instrumentId → pip size). */
export type PipSizeResolver = (instrumentId: string) => DecimalInput;

function minutesBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 60000;
}

/**
 * Scores one manual↔broker pair. Returns score 0 (never negative) with the
 * weighted reasons that built it.
 */
export function scorePair(
  manual: MatcherTradeLike,
  broker: MatcherTradeLike,
  config: MatcherConfig = DEFAULT_MATCHER_CONFIG,
  pipSizeOf?: PipSizeResolver
): MatchScore {
  const reasons: MatchReason[] = [];

  // ── Hard requirements ──
  if (manual.instrumentId !== broker.instrumentId) {
    return { score: 0, reasons: [{ code: "INSTRUMENT_MISMATCH", weight: 0 }] };
  }
  if (manual.direction !== broker.direction) {
    return { score: 0, reasons: [{ code: "DIRECTION_MISMATCH", weight: 0 }] };
  }

  // ── Certain match ──
  if (manual.externalId && broker.externalId && manual.externalId === broker.externalId) {
    return { score: 1, reasons: [{ code: "EXTERNAL_ID_MATCH", weight: 1 }] };
  }

  let score = 0;

  // ── Entry time proximity (max 0.35) ──
  const manualEntry = new Date(manual.entryTime);
  const brokerEntry = new Date(broker.entryTime);
  const minutes = minutesBetween(manualEntry, brokerEntry);
  let entryPlausible = true;
  if (minutes <= 2) {
    score += 0.35;
    reasons.push({ code: "ENTRY_TIME_STRONG", weight: 0.35, detail: `≤ 2 min (${minutes.toFixed(1)})` });
  } else if (minutes <= 15) {
    score += 0.2;
    reasons.push({ code: "ENTRY_TIME_MEDIUM", weight: 0.2, detail: `≤ 15 min (${minutes.toFixed(0)})` });
  } else if (manual.dateOnly || sameDay(manualEntry, brokerEntry)) {
    score += 0.1;
    reasons.push({
      code: manual.dateOnly ? "ENTRY_TIME_SAME_DAY_DATE_ONLY" : "ENTRY_TIME_SAME_DAY",
      weight: 0.1,
      detail: manual.dateOnly ? "trade manuel sans horodatage" : "même jour",
    });
  } else {
    entryPlausible = false;
    reasons.push({ code: "ENTRY_TIME_DIFFERENT_DAYS", weight: 0 });
  }

  // ── Entry price tolerance in pips (max 0.25) ──
  const pipSize = pipSizeOf ? toD(pipSizeOf(manual.instrumentId)) : toD("0.0001");
  const priceDistance = toD(manual.entryPrice).minus(toD(broker.entryPrice)).abs();
  const pips = pipSize.gt(0) ? priceDistance.div(pipSize) : priceDistance;
  if (pips.lte(config.entryTolerancePips)) {
    score += 0.25;
    reasons.push({
      code: "ENTRY_PRICE_MATCH",
      weight: 0.25,
      detail: `${pips.toDecimalPlaces(1).toString()} pips`,
    });
  } else if (pips.lte(config.entryTolerancePips * 3)) {
    score += 0.1;
    reasons.push({ code: "ENTRY_PRICE_NEAR", weight: 0.1, detail: `${pips.toDecimalPlaces(1).toString()} pips` });
  }

  // ── Lots equality (max 0.2) ──
  const lotsDistance = toD(manual.lots).minus(toD(broker.lots)).abs();
  if (lotsDistance.lte(config.lotsEpsilon)) {
    score += 0.2;
    reasons.push({ code: "LOTS_MATCH", weight: 0.2 });
  } else if (lotsDistance.lte(config.lotsEpsilon * 3)) {
    score += 0.05;
    reasons.push({ code: "LOTS_NEAR", weight: 0.05 });
  }

  // ── Exit proximity when both closed (max 0.2) — only when the ENTRY is
  // plausible: an exit match with entries days apart is a coincidence. ──
  if (
    entryPlausible &&
    manual.exitTime && broker.exitTime && manual.exitPrice != null && broker.exitPrice != null
  ) {
    const exitMinutes = minutesBetween(new Date(manual.exitTime), new Date(broker.exitTime));
    const exitPips = pipSize.gt(0)
      ? toD(manual.exitPrice).minus(toD(broker.exitPrice)).abs().div(pipSize)
      : toD(manual.exitPrice).minus(toD(broker.exitPrice)).abs();
    if (exitMinutes <= 5 && exitPips.lte(config.entryTolerancePips)) {
      score += 0.2;
      reasons.push({ code: "EXIT_MATCH", weight: 0.2, detail: `${exitMinutes.toFixed(0)} min / ${exitPips.toDecimalPlaces(1).toString()} pips` });
    } else if (sameDay(new Date(manual.exitTime), new Date(broker.exitTime))) {
      score += 0.05;
      reasons.push({ code: "EXIT_SAME_DAY", weight: 0.05 });
    }
  }

  return { score: Math.min(1, score), reasons };
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

export interface CandidatePair<M extends MatcherTradeLike, B extends MatcherTradeLike> {
  manual: M;
  broker: B;
  score: number;
  reasons: MatchReason[];
}

/**
 * Builds candidate pairs for one account: every broker trade vs every manual
 * trade on the same instrument+direction. Only pairs ≥ minScore are kept.
 */
export function findCandidates<M extends MatcherTradeLike, B extends MatcherTradeLike>(
  manualTrades: M[],
  brokerTrades: B[],
  config: MatcherConfig = DEFAULT_MATCHER_CONFIG,
  pipSizeOf?: PipSizeResolver
): CandidatePair<M, B>[] {
  const pairs: CandidatePair<M, B>[] = [];
  for (const broker of brokerTrades) {
    for (const manual of manualTrades) {
      const { score, reasons } = scorePair(manual, broker, config, pipSizeOf);
      if (score >= config.minScore) {
        pairs.push({ manual, broker, score, reasons });
      }
    }
  }
  return pairs.sort((a, b) => b.score - a.score);
}

/**
 * Bulk/auto-merge safety: only when score ≥ autoMergeScore AND the broker
 * trade has EXACTLY ONE candidate (v3 §4.3).
 */
export function highConfidencePairs<M extends MatcherTradeLike, B extends MatcherTradeLike>(
  pairs: CandidatePair<M, B>[],
  config: MatcherConfig = DEFAULT_MATCHER_CONFIG
): CandidatePair<M, B>[] {
  const byBroker = new Map<string, CandidatePair<M, B>[]>();
  for (const pair of pairs) {
    const list = byBroker.get(pair.broker.id) ?? [];
    list.push(pair);
    byBroker.set(pair.broker.id, list);
  }
  const result: CandidatePair<M, B>[] = [];
  for (const list of byBroker.values()) {
    if (list.length === 1 && list[0]!.score >= config.autoMergeScore) {
      result.push(list[0]);
    }
  }
  return result;
}
