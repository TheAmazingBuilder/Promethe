/**
 * v2.5 Module 5 - multi-TP position sizing.
 *
 * The existing calculator (calcPositionSize) is mono-TP: size is derived
 * from the total risk (entry vs SL), then the position is split across up
 * to 4 take-profits with an allocation % per tier (sum = 100%). Each tier
 * reports its own R multiple and P&L; totals show the blended outcome
 * when every TP is hit, and the worst case (full SL).
 */
import { D0, D100, floorToStep, toD, type DecimalInput } from "@/lib/trading/dec";
import type { Decimal } from "decimal.js";
import {
  calcPlannedRR,
  calcPnL,
  calcPositionSize,
  type PositionSizeInput,
} from "@/lib/trading/calculate";
import type { InstrumentSpec } from "@/lib/trading/types";

export interface MultiTpTierInput {
  /** Target price for this tier. */
  price: DecimalInput;
  /** % of the position closed at this tier. Tiers must sum to 100. */
  allocationPct: DecimalInput;
}

export interface MultiTpTierResult {
  index: number;
  price: Decimal;
  allocationPct: Decimal;
  /** Lots closed at this tier — rounded DOWN to the broker volume step. */
  lots: Decimal;
  /** R multiple of this tier (reward / initial risk). */
  rMultiple: Decimal | null;
  /** Gross P&L if this tier is hit (quote currency, before costs). */
  grossPnl: Decimal;
  /**
   * Net P&L if this tier is hit: gross − this tier's share of the
   * total costs (shared pro-rata by allocation). Equals grossPnl when
   * no costs were given — the "(gross)" label then applies instead.
   */
  netPnl: Decimal;
}

export interface MultiTpResult {
  sizing: ReturnType<typeof calcPositionSize>;
  tiers: MultiTpTierResult[];
  /** Sum of the tier allocations. */
  allocationSum: Decimal;
  /** True only when every allocation is in (0, 100] and the sum is 100. */
  allocationValid: boolean;
  /** True only when every TP price is positive and directionally valid. */
  targetsValid: boolean;
  /** Blended R when every TP is hit (allocation-weighted). */
  blendedR: Decimal | null;
  /** Total gross P&L when every TP is hit. */
  totalGrossPnl: Decimal;
  /** Total costs given for the whole position (account currency). */
  totalCosts: Decimal;
  /** Total net P&L when every TP is hit (gross − costs). */
  totalNetPnl: Decimal;
  /** Worst case: full position stopped out (gross, before costs). */
  worstCasePnl: Decimal;
  /** Worst case net of costs. */
  worstCaseNetPnl: Decimal;
  /**
   * Lots that could not be assigned to any tier without breaking the
   * broker volume grid (0 in the normal case: min == step). Only
   * reachable with exotic broker rules (min not a multiple of step);
   * the UI must warn when it is > 0 instead of silently dropping size.
   */
  unallocatedLots: Decimal;
}

export interface MultiTpInput extends Omit<PositionSizeInput, "riskAmount"> {
  riskAmount?: DecimalInput | null;
  tiers: MultiTpTierInput[];
  /**
   * Total costs for the whole position, ACCOUNT currency (commission +
   * swap + fees). Shared across tiers pro-rata by allocation and taken
   * off the cumulative P&L; per-tier and total NET P&L are reported
   * alongside the gross values (MD §3.3 net/gross convention: a P&L
   * shown without costs must be labelled "gross").
   */
  commission?: DecimalInput | null;
  swap?: DecimalInput | null;
  fees?: DecimalInput | null;
}

export function calcMultiTp(input: MultiTpInput): MultiTpResult {
  const sizing = calcPositionSize(input);
  const allocations = input.tiers.map((tier) => toD(tier.allocationPct));
  const allocationSum = allocations.reduce((acc, value) => acc.plus(value), D0);
  const allocationValid =
    input.tiers.length >= 1 &&
    input.tiers.length <= 4 &&
    allocations.every((value) => value.isFinite() && value.gt(0) && value.lte(D100)) &&
    allocationSum.eq(D100);

  const targets = input.tiers.map((tier) => toD(tier.price));
  const targetRValues = input.tiers.map((tier) =>
    calcPlannedRR(
      input.direction ?? "LONG",
      input.entry,
      input.stopLoss,
      tier.price
    )
  );
  const targetsValid =
    input.tiers.length >= 1 &&
    input.tiers.length <= 4 &&
    targets.every((price) => price.isFinite() && price.gt(0)) &&
    targetRValues.every((value) => value !== null);

  const canCalculateTiers = sizing.valid && allocationValid && targetsValid;
  const lotStep = toD(input.lotStep ?? "0.01");
  const minLots = toD(input.minLots ?? lotStep);
  // Tier lots are rounded DOWN to the broker volume grid (MD §3.5):
  // fractions like 0.0666 lots are not tradable. Volumes are
  // min-anchored (min, min+step, min+2·step, …) exactly like the sizing
  // itself, so a tier below the minimum closes 0 lots. The rounding
  // remainder is handed to the last tier in whole steps; whatever is
  // left over (< 1 step, only with exotic min/step combos) is reported
  // as unallocatedLots instead of being silently dropped.
  const floorTier = (raw: Decimal): Decimal => {
    if (!canCalculateTiers || raw.lt(minLots) || !lotStep.gt(0)) return D0;
    return minLots.plus(floorToStep(raw.minus(minLots), lotStep));
  };
  const roundedTierLots = input.tiers.map((tier, i) =>
    floorTier(
      sizing.lots.times(allocations[i]).div(D100)
    )
  );
  let unallocatedLots = D0;
  if (canCalculateTiers && roundedTierLots.length > 0) {
    let remainder = sizing.lots.minus(
      roundedTierLots.reduce((acc, v) => acc.plus(v), D0)
    );
    if (remainder.gt(0) && lotStep.gt(0)) {
      const wholeSteps = floorToStep(remainder, lotStep);
      roundedTierLots[roundedTierLots.length - 1] =
        roundedTierLots[roundedTierLots.length - 1].plus(wholeSteps);
      remainder = remainder.minus(wholeSteps);
    }
    unallocatedLots = remainder.gt(0) ? remainder : D0;
  }
  const totalCosts = toD(input.commission)
    .plus(toD(input.swap))
    .plus(toD(input.fees));

  const tiers: MultiTpTierResult[] = input.tiers.map((tier, index) => {
    const allocationPct = allocations[index];
    const tierLots = roundedTierLots[index];
    const rMultiple = targetsValid ? targetRValues[index] : null;
    const pnl = canCalculateTiers
      ? calcPnL({
          instrument: input.instrument,
          direction: input.direction ?? "LONG",
          lots: tierLots,
          entry: input.entry,
          exit: tier.price,
          quoteToAccountRate: input.quoteToAccountRate ?? null,
          fxRates: input.fxRates ?? null,
          accountCurrency: input.accountCurrency ?? null,
        })
      : null;
    const grossPnl = pnl?.grossPnl ?? D0;
    return {
      index,
      price: targets[index],
      allocationPct,
      lots: tierLots,
      rMultiple,
      grossPnl,
      netPnl: grossPnl.minus(totalCosts.times(allocationPct).div(D100)),
    };
  });

  const totalGrossPnl = canCalculateTiers
    ? tiers.reduce((acc, tier) => acc.plus(tier.grossPnl), D0)
    : D0;
  const totalNetPnl = canCalculateTiers
    ? totalGrossPnl.minus(totalCosts)
    : D0;
  const blendedR =
    canCalculateTiers
      ? tiers.reduce((acc, tier) => {
          const r = tier.rMultiple;
          return r === null ? acc : acc.plus(r.times(tier.allocationPct).div(D100));
        }, D0)
      : null;
  const worstCasePnl = sizing.valid
    ? calcPnL({
        instrument: input.instrument,
        direction: input.direction ?? "LONG",
        lots: sizing.lots,
        entry: input.entry,
        exit: input.stopLoss,
        quoteToAccountRate: input.quoteToAccountRate ?? null,
        fxRates: input.fxRates ?? null,
        accountCurrency: input.accountCurrency ?? null,
      }).grossPnl
    : D0;

  return {
    sizing,
    tiers,
    allocationSum,
    allocationValid,
    targetsValid,
    blendedR,
    totalGrossPnl,
    totalCosts,
    totalNetPnl,
    worstCasePnl,
    worstCaseNetPnl: sizing.valid ? worstCasePnl.minus(totalCosts) : D0,
    unallocatedLots,
  };
}

export type { InstrumentSpec };
