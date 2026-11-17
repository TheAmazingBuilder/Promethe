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
    (e) => e.type === "PARTIAL_EXIT" || e.type === "FINAL_EXIT"
  );

  const tiers: TierComparison[] = plan.tiers.map((tier, index) => {
    const manual = manualRealizedPct?.[index];
    if (manual !== undefined && manual !== "") {
      const pct = toD(manual);
      return {
        tier,
        index,
        realizedPct: pct,
        realizedPrice: null,
        status: pct.gte(toD(tier.pct)) ? "done" : pct.gt(0) ? "partial" : "pending",
      };
    }
    let realizedPct = D0;
    let realizedPrice: Decimal | null = null;
    for (const ex of closes) {
      const exPrice = toD(ex.price);
      const exLots = toD(ex.lots);
      let matches = false;
      if (tier.targetType === "PRICE") {
        const target = toD(tier.target);
        const tolerance = target.abs().times("0.02");
        matches = exPrice.minus(target).abs().lte(tolerance);
      } else {
        const r = tierRMultiple(exPrice, direction, entry, stopLoss);
        if (r !== null) {
          matches = r.minus(toD(tier.target)).abs().lte("0.1");
        }
      }
      if (matches) {
        realizedPct = realizedPct.plus(
          lots.gt(0) ? exLots.div(lots).times(D100) : D0
        );
        realizedPrice = exPrice;
      }
    }
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

  const totalRealizedPct = tiers.reduce((acc, t) => acc.plus(t.realizedPct), D0);
  const plannedTotalPct = plan.tiers.reduce((acc, t) => acc.plus(toD(t.pct)), D0);
  const breakevenMoved = modifications.some(
    (m) =>
      m.field === "STOP_LOSS" &&
      m.newValue !== null &&
      toD(m.newValue).eq(toD(entry))
  );
  const trailingStarted = modifications.some((m) => m.field === "STOP_LOSS");

  return { plan, tiers, totalRealizedPct, plannedTotalPct, breakevenMoved, trailingStarted };
}

/** Validate a plan draft: tiers sum to 100, targets are positive numbers. */
export function validateExitPlan(
  tiers: ExitPlanTier[]
): string | null {
  if (tiers.length === 0) return "empty";
  const sum = tiers.reduce((acc, t) => acc.plus(toD(t.pct)), D0);
  if (!sum.eq(D100)) return "sum";
  for (const t of tiers) {
    if (toD(t.pct).lte(0)) return "pct";
    if (toD(t.target).lte(0)) return "target";
  }
  return null;
}
