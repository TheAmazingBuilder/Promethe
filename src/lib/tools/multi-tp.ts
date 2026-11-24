/**
 * v2.5 Module 5 - multi-TP position sizing.
 *
 * The existing calculator (calcPositionSize) is mono-TP: size is derived
 * from the total risk (entry vs SL), then the position is split across up
 * to 4 take-profits with an allocation % per tier (sum = 100%). Each tier
 * reports its own R multiple and P&L; totals show the blended outcome
 * when every TP is hit, and the worst case (full SL).
 */
import { D0, D100, toD, type DecimalInput } from "@/lib/trading/dec";
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
  /** Lots closed at this tier. */
  lots: Decimal;
  /** R multiple of this tier (reward / initial risk). */
  rMultiple: Decimal | null;
  /** Gross P&L if this tier is hit (quote currency, before costs). */
  grossPnl: Decimal;
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
  /** Worst case: full position stopped out (gross, before costs). */
  worstCasePnl: Decimal;
}

export interface MultiTpInput extends Omit<PositionSizeInput, "riskAmount"> {
  riskAmount?: DecimalInput | null;
  tiers: MultiTpTierInput[];
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
  const tiers: MultiTpTierResult[] = input.tiers.map((tier, index) => {
    const allocationPct = allocations[index];
    const tierLots = canCalculateTiers
      ? sizing.lots.times(allocationPct).div(D100)
      : D0;
    const rMultiple = targetsValid ? targetRValues[index] : null;
    const pnl = canCalculateTiers
      ? calcPnL({
          instrument: input.instrument,
          direction: input.direction ?? "LONG",
          lots: tierLots,
          entry: input.entry,
          exit: tier.price,
          quoteToAccountRate: input.quoteToAccountRate ?? null,
          accountCurrency: input.accountCurrency ?? null,
        })
      : null;
    return {
      index,
      price: targets[index],
      allocationPct,
      lots: tierLots,
      rMultiple,
      grossPnl: pnl?.grossPnl ?? D0,
    };
  });

  const totalGrossPnl = canCalculateTiers
    ? tiers.reduce((acc, tier) => acc.plus(tier.grossPnl), D0)
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
    worstCasePnl,
  };
}
}

export type { InstrumentSpec };
