/**
 * TradeJournal — pure calculation engine.
 *
 * All functions are pure, client-safe (no Prisma import) and use decimal.js
 * exclusively. Inputs accept string | number | Decimal.
 *
 * Conventions (documented in README):
 *  - commission / swap / fees are SIGNED COSTS in the ACCOUNT currency:
 *    positive = cost, negative = credit. netPnl = grossPnl − (costs).
 *  - P&L gross is computed in the QUOTE currency, then converted to the
 *    account currency with `quoteToAccountRate` when provided.
 *  - If quote currency ≠ account currency the result is an ESTIMATE
 *    (`isEstimate`); the user's broker P&L (pnlSource = MANUAL) overrides it.
 */
import { D0, D1, D100, Decimal, floorToStep, toD, type DecimalInput } from "./dec";
import type { Direction, InstrumentSpec, ResultType } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Price differences, pips & points
// ─────────────────────────────────────────────────────────────────────────────

/** Signed price difference in the trade's direction (>0 = favorable). */
export function priceDiff(
  direction: Direction,
  entry: DecimalInput,
  exit: DecimalInput
): Decimal {
  const e = toD(entry);
  const x = toD(exit);
  return direction === "LONG" ? x.minus(e) : e.minus(x);
}

/** Convert a signed price difference into pips (uses instrument pipSize). */
export function toPips(instrument: InstrumentSpec, diff: DecimalInput): Decimal {
  const pip = toD(instrument.pipSize);
  if (pip.lte(0)) return D0;
  return toD(diff).div(pip);
}

/** Convert a signed price difference into points (uses instrument pointSize). */
export function toPoints(instrument: InstrumentSpec, diff: DecimalInput): Decimal {
  const point = toD(instrument.pointSize);
  if (point.lte(0)) return D0;
  return toD(diff).div(point);
}

/** Reverse conversions: pips/points → price distance. */
export function pipsToPrice(instrument: InstrumentSpec, pips: DecimalInput): Decimal {
  return toD(pips).times(toD(instrument.pipSize));
}

export function pointsToPrice(instrument: InstrumentSpec, points: DecimalInput): Decimal {
  return toD(points).times(toD(instrument.pointSize));
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk per unit (stop distance), R multiples & reward:risk
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Positive stop distance in PRICE units for the given direction.
 * LONG requires SL < entry, SHORT requires SL > entry.
 * Returns null when SL is missing, equals entry, or is on the wrong side.
 */
export function stopDistance(
  direction: Direction,
  entry: DecimalInput,
  stopLoss: DecimalInput | null | undefined
): Decimal | null {
  if (stopLoss === null || stopLoss === undefined) return null;
  const e = toD(entry);
  const s = toD(stopLoss);
  const d = direction === "LONG" ? e.minus(s) : s.minus(e);
  return d.gt(0) ? d : null;
}

/** R multiple from prices: signed diff / initial stop distance. null if no valid SL. */
export function calcRMultiple(
  direction: Direction,
  entry: DecimalInput,
  exit: DecimalInput,
  stopLoss: DecimalInput | null | undefined
): Decimal | null {
  const risk = stopDistance(direction, entry, stopLoss);
  if (!risk || risk.lte(0)) return null;
  return priceDiff(direction, entry, exit).div(risk);
}

/** Planned reward:risk = |TP − entry| / |entry − SL|. null when not computable. */
export function calcPlannedRR(
  direction: Direction,
  entry: DecimalInput,
  stopLoss: DecimalInput | null | undefined,
  takeProfit: DecimalInput | null | undefined
): Decimal | null {
  const risk = stopDistance(direction, entry, stopLoss);
  if (!risk || risk.lte(0)) return null;
  if (takeProfit === null || takeProfit === undefined) return null;
  const reward = toD(takeProfit).minus(toD(entry)).abs();
  if (reward.lte(0)) return null;
  return reward.div(risk);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pip / point value
// ─────────────────────────────────────────────────────────────────────────────

export interface PipValueResult {
  /** Pip value in QUOTE currency for the given lots. */
  quote: Decimal;
  /** Pip value in ACCOUNT currency (converted when a rate is given). */
  account: Decimal;
}

/** Value of 1 pip for a position of `lots` (quote currency → account currency). */
export function calcPipValue(
  instrument: InstrumentSpec,
  lots: DecimalInput,
  quoteToAccountRate?: DecimalInput | null
): PipValueResult {
  const quote = toD(instrument.pipSize)
    .times(toD(lots))
    .times(toD(instrument.contractSize));
  const rate = quoteToAccountRate == null ? null : toD(quoteToAccountRate);
  const account = rate ? quote.times(rate) : quote;
  return { quote, account };
}

// ─────────────────────────────────────────────────────────────────────────────
// P&L
// ─────────────────────────────────────────────────────────────────────────────

export interface PnlInput {
  instrument: InstrumentSpec;
  direction: Direction;
  lots: DecimalInput;
  entry: DecimalInput;
  exit: DecimalInput;
  /** Signed costs in ACCOUNT currency (positive = cost). */
  commission?: DecimalInput;
  swap?: DecimalInput;
  fees?: DecimalInput;
  /** quote → account conversion rate. null/1 = no conversion. */
  quoteToAccountRate?: DecimalInput | null;
  /** Account currency code, used for the isEstimate flag. */
  accountCurrency?: string | null;
}

export interface PnlResult {
  pips: Decimal;
  points: Decimal;
  /** Gross P&L in the QUOTE currency (before costs). */
  grossPnlQuote: Decimal;
  /** Gross P&L in the ACCOUNT currency. */
  grossPnl: Decimal;
  commission: Decimal;
  swap: Decimal;
  fees: Decimal;
  totalCosts: Decimal;
  netPnl: Decimal;
  /** True when a conversion rate ≠ 1 was applied. */
  converted: boolean;
  /** True when quote currency ≠ account currency → ESTIMATE. */
  isEstimate: boolean;
}

export function calcPnL(input: PnlInput): PnlResult {
  const { instrument, direction } = input;
  const diff = priceDiff(direction, input.entry, input.exit);
  const units = toD(input.lots).times(toD(instrument.contractSize));
  const grossQuote = diff.times(units);

  const rate = input.quoteToAccountRate == null ? null : toD(input.quoteToAccountRate);
  const converted = rate !== null && !rate.eq(D1);
  const gross = rate ? grossQuote.times(rate) : grossQuote;

  const commission = toD(input.commission);
  const swap = toD(input.swap);
  const fees = toD(input.fees);
  const totalCosts = commission.plus(swap).plus(fees);
  const netPnl = gross.minus(totalCosts);

  const quote = instrument.quoteCurrency ?? "";
  const account = input.accountCurrency ?? "";
  const isEstimate = account !== "" && quote !== account;

  return {
    pips: toPips(instrument, diff),
    points: toPoints(instrument, diff),
    grossPnlQuote: grossQuote,
    grossPnl: gross,
    commission,
    swap,
    fees,
    totalCosts,
    netPnl,
    converted,
    isEstimate,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Result classification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WIN / LOSS / BREAKEVEN.
 * Breakeven when |R| ≤ threshold (default 0.1R) or netPnl is exactly 0.
 */
export function classifyResult(
  netPnl: DecimalInput,
  rMultiple?: DecimalInput | null,
  breakevenThresholdR: DecimalInput = "0.1"
): ResultType {
  const net = toD(netPnl);
  const thr = toD(breakevenThresholdR).abs();
  if (rMultiple !== null && rMultiple !== undefined) {
    const r = toD(rMultiple);
    if (r.abs().lte(thr)) return "BREAKEVEN";
  }
  if (net.gt(0)) return "WIN";
  if (net.lt(0)) return "LOSS";
  return "BREAKEVEN";
}

// ─────────────────────────────────────────────────────────────────────────────
// Position sizing
// ─────────────────────────────────────────────────────────────────────────────

export interface PositionSizeInput {
  accountBalance: DecimalInput;
  /** Risk as % of balance — used when riskAmount is not provided. */
  riskPercent?: DecimalInput | null;
  /** Fixed risk amount in ACCOUNT currency (overrides riskPercent). */
  riskAmount?: DecimalInput | null;
  entry: DecimalInput;
  stopLoss: DecimalInput;
  instrument: InstrumentSpec;
  /** When provided, the SL side is validated strictly (LONG: SL < entry). */
  direction?: Direction | null;
  /** Broker lot step (default 0.01). */
  lotStep?: DecimalInput;
  minLots?: DecimalInput;
  maxLots?: DecimalInput | null;
  /** quote → account rate, required when quote ≠ account currency. */
  quoteToAccountRate?: DecimalInput | null;
}

/**
 * Machine-readable invalid reasons — translated client-side via
 * src/lib/i18n-errors.ts (sizingErrorMessage). Never user-facing prose here.
 */
export type SizingInvalidReason =
  | "STOP_SIDE_LONG"
  | "STOP_SIDE_SHORT"
  | "STOP_EQUALS_ENTRY"
  | "INVALID_AMOUNT"
  | "INSUFFICIENT_RISK";

export interface PositionSizeResult {
  valid: boolean;
  reason?: SizingInvalidReason;
  /** Requested risk in ACCOUNT currency. */
  riskAmount: Decimal;
  /** |entry − SL| in price units. */
  stopDist: Decimal | null;
  /** Stop distance in pips. */
  stopPips: Decimal | null;
  /** Exact units before rounding. */
  exactUnits: Decimal;
  /** Rounded-down lots actually tradable. */
  lots: Decimal;
  units: Decimal;
  /** Risk really taken with the rounded lots. */
  actualRiskAmount: Decimal;
  pipValue: PipValueResult;
  /** Position notional in quote currency. */
  notionalQuote: Decimal;
  /** Minimum lot size considered (for INSUFFICIENT_RISK messaging). */
  minLots: Decimal;
  /** True when quote ≠ account without/with conversion → estimate. */
  isEstimate: boolean;
}

export function calcPositionSize(input: PositionSizeInput): PositionSizeResult {
  const { instrument } = input;
  const balance = toD(input.accountBalance);
  const lotStep = input.lotStep == null ? toD("0.01") : toD(input.lotStep);
  const minLots = input.minLots == null ? lotStep : toD(input.minLots);

  const riskAmount =
    input.riskAmount != null && toD(input.riskAmount).gt(0)
      ? toD(input.riskAmount)
      : balance.times(toD(input.riskPercent ?? 0)).div(D100);

  const rate = input.quoteToAccountRate == null ? null : toD(input.quoteToAccountRate);
  const converted = rate !== null && !rate.eq(D1);

  const invalid = (reason: SizingInvalidReason): PositionSizeResult => ({
    valid: false,
    reason,
    riskAmount,
    stopDist: null,
    stopPips: null,
    exactUnits: D0,
    lots: D0,
    units: D0,
    actualRiskAmount: D0,
    pipValue: calcPipValue(instrument, 0),
    notionalQuote: D0,
    minLots,
    isEstimate: false,
  });

  // Stop distance: strict side validation when direction is known,
  // absolute distance otherwise (calculator without direction).
  let dist: Decimal | null;
  if (input.direction) {
    dist = stopDistance(input.direction, input.entry, input.stopLoss);
    if (dist === null) {
      return invalid(
        input.direction === "LONG" ? "STOP_SIDE_LONG" : "STOP_SIDE_SHORT"
      );
    }
  } else {
    dist = toD(input.entry).minus(toD(input.stopLoss)).abs();
    if (dist.isZero()) {
      return invalid("STOP_EQUALS_ENTRY");
    }
  }

  if (balance.lte(0) || riskAmount.lte(0)) {
    return invalid("INVALID_AMOUNT");
  }

  // Risk per unit in ACCOUNT currency.
  const distAccount = rate ? dist.times(rate) : dist;

  const exactUnits = riskAmount.div(distAccount);
  let lots = floorToStep(exactUnits.div(toD(instrument.contractSize)), lotStep);
  if (input.maxLots != null) {
    const maxL = toD(input.maxLots);
    if (lots.gt(maxL)) lots = maxL;
  }
  const units = lots.times(toD(instrument.contractSize));
  const actualRiskAmount = units.times(distAccount);
  const notionalQuote = units.times(toD(input.entry));

  return {
    valid: lots.gt(0),
    reason: lots.gt(0) ? undefined : "INSUFFICIENT_RISK",
    riskAmount,
    stopDist: dist,
    stopPips: toPips(instrument, dist),
    exactUnits,
    lots,
    units,
    actualRiskAmount,
    pipValue: calcPipValue(instrument, lots, input.quoteToAccountRate),
    notionalQuote,
    minLots,
    isEstimate: converted,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// High-level preview (powers the trade form live panel & the P&L simulator)
// ─────────────────────────────────────────────────────────────────────────────

export interface TradePreviewInput extends PnlInput {
  stopLoss?: DecimalInput | null;
  takeProfit?: DecimalInput | null;
  /** Account balance at entry → risk % + realized RR on net. */
  accountBalance?: DecimalInput | null;
  breakevenThresholdR?: DecimalInput;
}

export interface TradePreview extends PnlResult {
  rMultiple: Decimal | null;
  plannedRR: Decimal | null;
  /** Net-based R: netPnl / initial risk amount. */
  realizedRR: Decimal | null;
  resultType: ResultType;
  /** Initial risk (entry vs SL) in ACCOUNT currency. */
  riskAmount: Decimal | null;
  riskPercent: Decimal | null;
}

export function previewTrade(input: TradePreviewInput): TradePreview {
  const pnl = calcPnL(input);
  const r = calcRMultiple(
    input.direction,
    input.entry,
    input.exit,
    input.stopLoss ?? null
  );
  const planned = calcPlannedRR(
    input.direction,
    input.entry,
    input.stopLoss ?? null,
    input.takeProfit ?? null
  );

  let riskAmount: Decimal | null = null;
  let realizedRR: Decimal | null = null;
  const dist = stopDistance(input.direction, input.entry, input.stopLoss ?? null);
  if (dist) {
    const rate =
      input.quoteToAccountRate == null ? D1 : toD(input.quoteToAccountRate);
    riskAmount = dist
      .times(toD(input.lots))
      .times(toD(input.instrument.contractSize))
      .times(rate);
    if (riskAmount.gt(0)) realizedRR = pnl.netPnl.div(riskAmount);
  }

  let riskPercent: Decimal | null = null;
  if (input.accountBalance != null && riskAmount) {
    const bal = toD(input.accountBalance);
    if (bal.gt(0)) riskPercent = riskAmount.div(bal).times(D100);
  }

  return {
    ...pnl,
    rMultiple: r,
    plannedRR: planned,
    realizedRR,
    resultType: classifyResult(pnl.netPnl, r, input.breakevenThresholdR ?? "0.1"),
    riskAmount,
    riskPercent,
  };
}
