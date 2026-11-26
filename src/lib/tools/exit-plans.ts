/**
 * v2.5 Module 5 - partial exit plans (ExitPlan).
 *
 * A plan is a list of tiers: close pct% of the position at a price target
 * or an R multiple, optionally moving the stop to breakeven and starting
 * a trailing stop after a given tier. Plan-vs-real compares the planned
 * tiers with the actual partial exits (TradeExecution rows) and the SL/TP
 * moves (TradeModification rows) on the trade detail page.
 */
import { D0, D100, toD, type DecimalInput } from "@/lib/trading/dec";
import type { Decimal } from "decimal.js";
import type { ExitPlanEntry, ExitPlanTier } from "./types";

export interface ExecutionLike {
  id: string;
  /** ENTRY | ADD | PARTIAL_EXIT | FINAL_EXIT */
  type: string;
  price: DecimalInput;
  lots: DecimalInput;
  time: string;
}

export interface ModificationLike {
  id: string;
  time: string;
  /** STOP_LOSS | TAKE_PROFIT | VOLUME | OTHER */
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

export interface TierComparison {
  tier: ExitPlanTier;
  index: number;
  /** % of the position actually closed near this tier (0 when not hit). */
  realizedPct: Decimal;
  /** Price of the closest matching execution, if any. */
  realizedPrice: Decimal | null;
  status: "done" | "partial" | "pending";
}

export interface PlanVsReal {
  plan: ExitPlanEntry;
  tiers: TierComparison[];
  /** Total % closed across all tiers. */
  totalRealizedPct: Decimal;
  /** Planned total (should be 100). */
  plannedTotalPct: Decimal;
  breakevenMoved: boolean;
  trailingStarted: boolean;
}

/** R multiple of a price vs entry/SL, for PRICE-target tiers. */
export function tierRMultiple(
  targetPrice: DecimalInput,
  direction: "LONG" | "SHORT",
  entry: DecimalInput,
  stopLoss: DecimalInput | null
): Decimal | null {
  if (stopLoss === null || stopLoss === undefined) return null;
  const e = toD(entry);
  const s = toD(stopLoss);
  const risk = direction === "LONG" ? e.minus(s) : s.minus(e);
  if (risk.lte(0)) return null;
  const reward =
    direction === "LONG"
      ? toD(targetPrice).minus(e)
      : e.minus(toD(targetPrice));
  return reward.div(risk);
}

/**
 * Compare a plan with what actually happened. A partial execution is
 * matched to the closest planned tier by price (within 2% of the tier
 * price, or by R when the tier is R-based). Manual fallback: when the
 * trade has no executions, every tier stays "pending" and the detail
 * page lets the user type the realized % per tier.
 */
export function comparePlanVsReal(
  plan: ExitPlanEntry,
  direction: "LONG" | "SHORT",
  entry: DecimalInput,
  stopLoss: DecimalInput | null,
  totalLots: DecimalInput,
  executions: ExecutionLike[],
  modifications: ModificationLike[],
  manualRealizedPct?: Record<number, string>
): PlanVsReal {
  const lots = toD(totalLots);
  const closes = executions.filter(
    (execution) =>
      (execution.type === "PARTIAL_EXIT" || execution.type === "FINAL_EXIT") &&
      toD(execution.price).isFinite() &&
      toD(execution.price).gt(0) &&
      toD(execution.lots).isFinite() &&
      toD(execution.lots).gt(0)
  );

  // Assign each close to at most one tier: the closest matching target.
  // This prevents a single execution near two adjacent targets from being
  // counted twice in the plan's total realized percentage.
  const assigned = new Map<number, Array<{ execution: ExecutionLike; distance: Decimal }>>();
  for (const execution of closes) {
    const executionPrice = toD(execution.price);
    let bestIndex = -1;
    let bestDistance: Decimal | null = null;

    for (let index = 0; index < plan.tiers.length; index++) {
      const tier = plan.tiers[index];
      let distance: Decimal | null = null;

      if (tier.targetType === "PRICE") {
        const target = toD(tier.target);
        if (!target.isFinite() || target.lte(0)) continue;
        const delta = executionPrice.minus(target).abs();
        const tolerance = target.abs().times("0.02");
        if (delta.lte(tolerance)) distance = delta;
      } else {
        const targetR = toD(tier.target);
        if (!targetR.isFinite() || targetR.lte(0)) continue;
        const actualR = tierRMultiple(executionPrice, direction, entry, stopLoss);
        if (actualR !== null) {
          const delta = actualR.minus(targetR).abs();
          if (delta.lte("0.1")) distance = delta;
        }
      }

      if (
        distance !== null &&
        (bestDistance === null || distance.lt(bestDistance))
      ) {
        bestIndex = index;
        bestDistance = distance;
      }
    }

    if (bestIndex >= 0 && bestDistance !== null) {
      const bucket = assigned.get(bestIndex) ?? [];
      bucket.push({ execution, distance: bestDistance });
      assigned.set(bestIndex, bucket);
    }
  }

  const tiers: TierComparison[] = plan.tiers.map((tier, index) => {
    const manual = manualRealizedPct?.[index]?.trim();
    const manualValid =
      manual !== undefined &&
      /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(manual) &&
      toD(manual).isFinite() &&
      toD(manual).gte(0) &&
      toD(manual).lte(100);

    if (manualValid) {
      const pct = toD(manual);
      return {
        tier,
        index,
        realizedPct: pct,
        realizedPrice: null,
        status: pct.gte(toD(tier.pct)) ? "done" : pct.gt(0) ? "partial" : "pending",
      };
    }

    const matches = assigned.get(index) ?? [];
    const closedLots = matches.reduce(
      (sum, match) => sum.plus(toD(match.execution.lots)),
      D0
    );
    const realizedPct = lots.gt(0) ? closedLots.div(lots).times(D100) : D0;
    const closest = matches.reduce<
      { execution: ExecutionLike; distance: Decimal } | null
    >(
      (best, match) =>
        best === null || match.distance.lt(best.distance) ? match : best,
      null
    );
    const realizedPrice = closest ? toD(closest.execution.price) : null;

    return {
      tier,
      index,
      realizedPct,
      realizedPrice,
      status:
        realizedPct.gte(toD(tier.pct))
          ? "done"
          : realizedPct.gt(0)
            ? "partial"
            : "pending",
    };
  });

  const totalRealizedPct = tiers.reduce((acc, tier) => acc.plus(tier.realizedPct), D0);
  const plannedTotalPct = plan.tiers.reduce((acc, tier) => acc.plus(toD(tier.pct)), D0);

  // A configured trigger is reached only after enough volume has closed at
  // its assigned tier. Manual percentages have no timestamp, so they cannot
  // be used to infer when a stop modification happened.
  const tierCompletionTime = (tierIndex: number): number | null => {
    if (tierIndex < 0 || tierIndex >= plan.tiers.length || !lots.gt(0)) return null;
    const matches = (assigned.get(tierIndex) ?? [])
      .filter((match) => Number.isFinite(Date.parse(match.execution.time)))
      .slice()
      .sort((a, b) => Date.parse(a.execution.time) - Date.parse(b.execution.time));
    let closedLots = D0;
    for (const match of matches) {
      closedLots = closedLots.plus(toD(match.execution.lots));
      if (
        closedLots.div(lots).times(D100).gte(toD(plan.tiers[tierIndex].pct))
      ) {
        const timestamp = Date.parse(match.execution.time);
        return Number.isFinite(timestamp) ? timestamp : null;
      }
    }
    return null;
  };

  const entryPrice = toD(entry);
  const breakevenTriggerTime =
    plan.breakevenAfterTier == null
      ? null
      : tierCompletionTime(plan.breakevenAfterTier);
  const breakevenMoved =
    breakevenTriggerTime !== null &&
    modifications.some((modification) => {
      if (
        modification.field !== "STOP_LOSS" ||
        modification.oldValue === null ||
        modification.newValue === null
      ) {
        return false;
      }
      const timestamp = Date.parse(modification.time);
      if (!Number.isFinite(timestamp) || timestamp <= breakevenTriggerTime) return false;
      const oldStop = toD(modification.oldValue);
      const newStop = toD(modification.newValue);
      if (
        !oldStop.isFinite() ||
        !newStop.isFinite() ||
        oldStop.lte(0) ||
        newStop.lte(0) ||
        !newStop.eq(entryPrice) ||
        oldStop.eq(entryPrice)
      ) {
        return false;
      }
      return direction === "LONG" ? oldStop.lt(entryPrice) : oldStop.gt(entryPrice);
    });

  // Trailing is considered started only after its configured tier has
  // completed and a later SL modification advanced further into profit.
  let trailingStarted = false;
  const trailingIndex = plan.trailingAfterTier;
  const trailingTriggerTime =
    trailingIndex == null ? null : tierCompletionTime(trailingIndex);
  if (trailingTriggerTime !== null) {
    trailingStarted = modifications.some((modification) => {
      if (
        modification.field !== "STOP_LOSS" ||
        modification.oldValue === null ||
        modification.newValue === null
      ) {
        return false;
      }
      const timestamp = Date.parse(modification.time);
      if (!Number.isFinite(timestamp) || timestamp <= trailingTriggerTime) return false;
      const oldStop = toD(modification.oldValue);
      const newStop = toD(modification.newValue);
      if (
        !oldStop.isFinite() ||
        !newStop.isFinite() ||
        oldStop.lte(0) ||
        newStop.lte(0)
      ) {
        return false;
      }
      return direction === "LONG"
        ? newStop.gt(entryPrice) && newStop.gt(oldStop)
        : newStop.lt(entryPrice) && newStop.lt(oldStop);
    });
  }

  return { plan, tiers, totalRealizedPct, plannedTotalPct, breakevenMoved, trailingStarted };
}
/** Validate a plan draft: tiers sum to 100, targets are positive numbers. */
export function validateExitPlan(
  tiers: ExitPlanTier[],
  breakevenAfterTier: number | null = null,
  trailingAfterTier: number | null = null
): string | null {
  if (tiers.length === 0) return "empty";
  if (tiers.length > 4) return "count";
  if (tiers.some((tier) => !Number.isFinite(tier.pct) || tier.pct <= 0 || tier.pct > 100)) {
    return "pct";
  }
  const sum = tiers.reduce((acc, tier) => acc.plus(toD(tier.pct)), D0);
  if (!sum.eq(D100)) return "sum";
  for (const tier of tiers) {
    const rawTarget = tier.target.trim();
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(rawTarget)) return "target";
    const target = toD(rawTarget);
    if (!target.isFinite() || target.lte(0)) return "target";
  }
  for (const trigger of [breakevenAfterTier, trailingAfterTier]) {
    if (
      trigger !== null &&
      (!Number.isInteger(trigger) || trigger < 0 || trigger >= tiers.length)
    ) {
      return "trigger";
    }
  }
  return null;
}
