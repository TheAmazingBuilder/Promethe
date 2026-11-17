/**
 * v2.5 Module 5 - leverage & margin simulator.
 *
 * Required margin = notional / leverage. Margin level = equity / used
 * margin * 100. Distances are expressed both as a margin-level gap and
 * as an equity amount: how much equity can be lost before the margin
 * call level (default 100%) or the stop-out level (default 50%) is hit.
 * All money math uses decimal.js; no floats.
 */
import { D0, D100, toD, type DecimalInput } from "@/lib/trading/dec";
import type { Decimal } from "decimal.js";
import type { InstrumentSpec } from "@/lib/trading/types";

export interface MarginPositionInput {
  symbol: string;
  instrument: InstrumentSpec;
  lots: DecimalInput;
  entry: DecimalInput;
  /** Set to true for the hypothetical what-if position. */
  hypothetical?: boolean;
}

export interface MarginInput {
  /** Account equity (balance + floating P&L). */
  equity: DecimalInput;
  /** Account balance (equity baseline when no floating P&L is given). */
  balance: DecimalInput;
  leverage: DecimalInput;
  /** Margin call level in % (default 100). */
  marginCallLevel?: DecimalInput | null;
  /** Stop-out level in % (default 50). */
  stopOutLevel?: DecimalInput | null;
  positions: MarginPositionInput[];
}

export interface MarginPositionResult {
  symbol: string;
  lots: Decimal;
  notional: Decimal;
  requiredMargin: Decimal;
  hypothetical: boolean;
}

export interface MarginResult {
  positions: MarginPositionResult[];
  /** Sum of required margins (quote currency, before conversion). */
  usedMargin: Decimal;
  freeMargin: Decimal;
  /** equity / usedMargin * 100, null when no margin is used. */
  marginLevel: Decimal | null;
  /** Equity that can be lost before the margin call level. */
  distanceToMarginCall: Decimal | null;
  /** Equity that can be lost before the stop-out level. */
  distanceToStopOut: Decimal | null;
  marginCall: boolean;
  stopOut: boolean;
}

export function calcMargin(input: MarginInput): MarginResult {
  const equity = toD(input.equity);
  const leverage = toD(input.leverage);
  const mcLevel = input.marginCallLevel == null ? toD(100) : toD(input.marginCallLevel);
  const soLevel = input.stopOutLevel == null ? toD(50) : toD(input.stopOutLevel);

  const positions: MarginPositionResult[] = input.positions.map((p) => {
    const lots = toD(p.lots);
    const units = lots.times(toD(p.instrument.contractSize));
    const notional = units.times(toD(p.entry));
    const requiredMargin = leverage.gt(0) ? notional.div(leverage) : D0;
    return { symbol: p.symbol, lots, notional, requiredMargin, hypothetical: p.hypothetical ?? false };
  });

  const usedMargin = positions.reduce((acc, p) => acc.plus(p.requiredMargin), D0);
  const freeMargin = equity.minus(usedMargin);
  const marginLevel = usedMargin.gt(0) ? equity.div(usedMargin).times(D100) : null;

  // Equity at which marginLevel == level% is usedMargin * level / 100.
  // Distance = current equity - that threshold (null when no margin used).
  const distanceTo = (level: Decimal): Decimal | null => {
    if (!usedMargin.gt(0)) return null;
    return equity.minus(usedMargin.times(level).div(D100));
  };

  return {
    positions,
    usedMargin,
    freeMargin,
    marginLevel,
    distanceToMarginCall: distanceTo(mcLevel),
    distanceToStopOut: distanceTo(soLevel),
    marginCall: marginLevel !== null && marginLevel.lte(mcLevel),
    stopOut: marginLevel !== null && marginLevel.lte(soLevel),
  };
}
