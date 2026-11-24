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
  /** Sum of the tier allocations (must be 100 to be valid). */
  allocationSum: Decimal;
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
  const allocationSum = input.tiers.reduce(
    (acc, t) => acc.plus(toD(t.allocationPct)),
    D0
  );

  const tiers: MultiTpTierResult[] = input.tiers.map((tier, index) => {
    const allocationPct = toD(tier.allocationPct);
    const tierLots = sizing.lots.times(allocationPct).div(D100);
    const rMultiple = sizing.valid
      ? calcPlannedRR(
          input.direction ?? "LONG",
          input.entry,
          input.stopLoss,
          tier.price
        )
      : null;
    const pnl = calcPnL({
      instrument: input.instrument,
      direction: input.direction ?? "LONG",
      lots: tierLots,
      entry: input.entry,
      exit: tier.price,
      quoteToAccountRate: input.quoteToAccountRate ?? null,
      accountCurrency: input.accountCurrency ?? null,
    });
    return {
      index,
      price: toD(tier.price),
      allocationPct,
      lots: tierLots,
      rMultiple,
      grossPnl: pnl.grossPnl,
    };
  });

  const totalGrossPnl = tiers.reduce((acc, t) => acc.plus(t.grossPnl), D0);
  let blendedR: Decimal | null = null;
  if (sizing.valid && allocationSum.eq(D100)) {
    blendedR = tiers.reduce((acc, t) => {
      if (!t.rMultiple) return acc;
      return acc.plus(t.rMultiple.times(t.allocationPct).div(D100));
    }, D0);
  }
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

  return { sizing, tiers, allocationSum, blendedR, totalGrossPnl, worstCasePnl };
}

export type { InstrumentSpec };
