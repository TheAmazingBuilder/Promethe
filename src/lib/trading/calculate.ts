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
import {
  resolveConversionRate,
  type FxRateInput,
} from "@/lib/tools/fx";

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

  // Reward must be on the profitable side of entry. Using abs() here
  // incorrectly turned a TP placed beyond the stop / against the trade
  // direction into a positive planned R:R.
  const reward =
    direction === "LONG"
      ? toD(takeProfit).minus(toD(entry))
      : toD(entry).minus(toD(takeProfit));
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
  /**
   * Stored FxRate table (v2.5 Module 5). Used as the default conversion
   * when no explicit `quoteToAccountRate` is given: the manual rate
   * always wins when it is set.
   */
  fxRates?: FxRateInput[] | null;
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

  const rate =
    input.quoteToAccountRate == null
      ? resolveConversionRate(
          instrument.quoteCurrency ?? "",
          input.accountCurrency ?? "",
          input.fxRates ?? [],
          null
        )
      : toD(input.quoteToAccountRate);
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
  /** Risk as % of balance - used when riskAmount is not provided. */
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
  /** Account currency is required to determine whether FX conversion is needed. */
  accountCurrency?: string | null;
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
  | "MISSING_ACCOUNT_CURRENCY"
  | "MISSING_QUOTE_CURRENCY"
  | "MISSING_CONVERSION_RATE"
  | "INVALID_CONVERSION_RATE"
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
  const requestedMinLots = input.minLots == null ? lotStep : toD(input.minLots);
  const contractSize = toD(instrument.contractSize);
  const maxLots = input.maxLots == null ? null : toD(input.maxLots);

  // An explicitly supplied fixed risk is authoritative, including zero or
  // negative values (which are rejected below rather than falling back to %).
  const riskAmount =
    input.riskAmount != null
      ? toD(input.riskAmount)
      : balance.times(toD(input.riskPercent ?? 0)).div(D100);

  const accountCurrency = input.accountCurrency?.trim().toUpperCase() ?? "";
  const quoteCurrency = instrument.quoteCurrency?.trim().toUpperCase() ?? "";

  const effectiveMinLots =
    lotStep.isFinite() && lotStep.gt(0) && requestedMinLots.isFinite() && requestedMinLots.gt(0)
      ? requestedMinLots.div(lotStep).ceil().times(lotStep)
      : requestedMinLots;

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
    minLots: effectiveMinLots,
    isEstimate: false,
  });

  if (
    !balance.isFinite() ||
    !riskAmount.isFinite() ||
    balance.lte(0) ||
    riskAmount.lte(0)
  ) {
    return invalid("INVALID_AMOUNT");
  }

  const entry = toD(input.entry);
  const stopLoss = toD(input.stopLoss);
  if (
    !entry.isFinite() ||
    !stopLoss.isFinite() ||
    entry.lte(0) ||
    stopLoss.lte(0) ||
    !contractSize.isFinite() ||
    contractSize.lte(0)
  ) {
    return invalid("INVALID_AMOUNT");
  }

  if (
    !lotStep.isFinite() ||
    lotStep.lte(0) ||
    !requestedMinLots.isFinite() ||
    requestedMinLots.lte(0) ||
    !effectiveMinLots.isFinite() ||
    effectiveMinLots.lte(0) ||
    (maxLots != null &&
      (!maxLots.isFinite() ||
        maxLots.lte(0) ||
        maxLots.lt(effectiveMinLots) ||
        floorToStep(maxLots, lotStep).lt(effectiveMinLots)))
  ) {
    return invalid("INVALID_LOT_CONSTRAINTS");
  }

  // Stop distance: strict side validation when direction is known,
  // absolute distance otherwise (calculator without direction).
  let dist: Decimal | null;
  if (input.direction) {
    dist = stopDistance(input.direction, entry, stopLoss);
    if (dist === null) {
      return invalid(
        input.direction === "LONG" ? "STOP_SIDE_LONG" : "STOP_SIDE_SHORT"
      );
    }
  } else {
    dist = entry.minus(stopLoss).abs();
    if (dist.isZero()) {
      return invalid("STOP_EQUALS_ENTRY");
    }
  }

  if (!accountCurrency) return invalid("MISSING_ACCOUNT_CURRENCY");
  if (!quoteCurrency) return invalid("MISSING_QUOTE_CURRENCY");

  const needsConversion = quoteCurrency !== accountCurrency;
  let rate = D1;
  if (needsConversion) {
    if (
      input.quoteToAccountRate == null ||
      String(input.quoteToAccountRate).trim() === ""
    ) {
      return invalid("MISSING_CONVERSION_RATE");
    }
    rate = toD(input.quoteToAccountRate);
    if (!rate.isFinite() || rate.lte(0)) {
      return invalid("INVALID_CONVERSION_RATE");
    }
  }

  // Stop distance is quoted in the instrument's quote currency. Convert
  // it to the account currency before sizing the position.
  const distAccount = dist.times(rate);
  const exactUnits = riskAmount.div(distAccount);
  let lots = floorToStep(exactUnits.div(contractSize), lotStep);

  // Respect the broker's maximum without rounding UP to an untradable lot.
  if (maxLots != null) {
    lots = Decimal.min(lots, floorToStep(maxLots, lotStep));
  }

  // Never force the broker minimum: if it exceeds the risk budget, reject
  // the trade rather than silently increasing the requested risk.
  if (lots.lt(effectiveMinLots)) {
    return invalid("INSUFFICIENT_RISK");
  }

  const units = lots.times(contractSize);
  const actualRiskAmount = units.times(distAccount);
  const notionalQuote = units.times(entry);

  return {
    valid: true,
    reason: undefined,
    riskAmount,
    stopDist: dist,
    stopPips: toPips(instrument, dist),
    exactUnits,
    lots,
    units,
    actualRiskAmount,
    pipValue: calcPipValue(instrument, lots, rate),
    notionalQuote,
    minLots: effectiveMinLots,
    isEstimate: needsConversion,
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

  // Use the exact same quote→account conversion policy as calcPnL.
  // A missing cross-currency rate means account-currency risk is unknown;
  // never silently treat the quote currency as the account currency.
  const conversionRate =
    input.quoteToAccountRate == null
      ? resolveConversionRate(
          input.instrument.quoteCurrency ?? "",
          input.accountCurrency ?? "",
          input.fxRates ?? [],
          null
        )
      : toD(input.quoteToAccountRate);

  if (dist && conversionRate?.isFinite() && conversionRate.gt(0)) {
    riskAmount = dist
      .times(toD(input.lots))
      .times(toD(input.instrument.contractSize))
      .times(conversionRate);
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

// ─────────────────────────────────────────────────────────────────────────────
// Risk:reward & win rate (Phase 2 — Risk/Reward module)
//
// Standard formulas (same as the Euforia risk engine: decimal.js only,
// never JS floats):
//  - Risk-Reward Ratio = Take Profit distance / Stop-loss distance
//    (plannedRR / realizedRR above).
//  - Win rate = % of closed trades with a profit.
//  - Required win rate for a given R:R: p* = 1 / (1 + RR)
//    (1:1 → 50%, 1:2 → 33.3%, 1:3 → 25%, 1:4 → 20%, 1:5 → 16.7%).
//  - Expectancy per trade: E = p·gain − (1−p)·loss, in R or in money.
//  - The higher the win rate, the less risk a trader needs to take:
//    a high R:R stays profitable at a low win rate, a low R:R needs
//    a high win rate to break even.
// ─────────────────────────────────────────────────────────────────────────────

/** Win-rate thresholds shown as columns of the R:R × win-rate table. */
export const RR_TABLE_WIN_RATES = [0.2, 0.3, 0.4, 0.5, 0.6] as const;
/** R:R rows shown in the table (1:1 … 5:1). */
export const RR_TABLE_RATIOS = [1, 2, 3, 4, 5] as const;

/**
 * Required win rate (fraction 0–1) to break even at a given reward:risk.
 * E = p·RR − (1−p) = 0  ⟹  p* = 1 / (1 + RR). null when RR ≤ 0.
 */
export function requiredWinRate(rr: DecimalInput): Decimal | null {
  const r = toD(rr);
  if (r.lte(0)) return null;
  return D1.div(D1.plus(r));
}

/** Expectancy per trade in R: E = p·RR − (1−p). null on invalid inputs. */
export function expectancyR(
  winRate: DecimalInput,
  rr: DecimalInput
): Decimal | null {
  const p = toD(winRate);
  const r = toD(rr);
  if (p.lt(0) || p.gt(1) || r.lt(0)) return null;
  return p.times(r).minus(D1.minus(p));
}

export interface ExpectancyMoneyInput {
  /** Win rate as a fraction 0–1. */
  winRate: DecimalInput;
  /** Average winning trade, account currency, positive. */
  avgWin: DecimalInput;
  /** Average losing trade, account currency, positive (magnitude). */
  avgLoss: DecimalInput;
}

/** Expectancy per trade in money: E = p·avgWin − (1−p)·avgLoss. */
export function expectancyMoney(input: ExpectancyMoneyInput): Decimal | null {
  const p = toD(input.winRate);
  const win = toD(input.avgWin);
  const loss = toD(input.avgLoss);
  if (p.lt(0) || p.gt(1) || win.lt(0) || loss.lt(0)) return null;
  return p.times(win).minus(D1.minus(p).times(loss));
}

export type RrCellStatus = "profitable" | "breakeven" | "losing";

/**
 * Status of one R:R × win-rate cell, from the sign of the expectancy.
 * Exact break-even (E = 0) is the only "breakeven" cell — e.g. 1:1 at 50%
 * and 4:1 at 20% — everything else is profitable or losing.
 */
export function classifyRrCell(
  rr: DecimalInput,
  winRate: DecimalInput
): RrCellStatus {
  const e = expectancyR(winRate, rr);
  if (e === null) return "losing";
  if (e.gt(0)) return "profitable";
  if (e.eq(0)) return "breakeven";
  return "losing";
}

export interface CompoundProjectionInput {
  startingBalance: DecimalInput;
  /** Expectancy per trade in R (e.g. 0.2 R). */
  expectancyR: DecimalInput;
  /** Risk per trade as a fraction of balance (e.g. 0.01 = 1%). */
  riskPerTrade: DecimalInput;
  tradesPerMonth: DecimalInput;
  months: DecimalInput;
}

/**
 * Compounding projection: month-end balances, starting balance included
 * as the first point. Each month adds
 * expectancyR × riskPerTrade × tradesPerMonth (fraction of the balance).
 *
 * This is a PROJECTION, not a promise: it assumes a constant expectancy
 * and constant risk, which never happens in real trading. The UI must
 * say so next to every number this produces.
 * Returns [] when any input is invalid (balance ≤ 0, expectancy < −1,
 * risk < 0, trades/month ≤ 0, months outside 1–120).
 */
export function compoundProjection(
  input: CompoundProjectionInput
): Decimal[] {
  const start = toD(input.startingBalance);
  const expR = toD(input.expectancyR);
  const risk = toD(input.riskPerTrade);
  const perMonth = toD(input.tradesPerMonth);
  const months = toD(input.months);
  if (
    start.lte(0) ||
    expR.lt(-1) ||
    risk.lt(0) ||
    perMonth.lte(0) ||
    months.lt(1) ||
    months.gt(120) ||
    !months.isInteger()
  ) {
    return [];
  }
  const monthlyReturn = expR.times(risk).times(perMonth);
  const points: Decimal[] = [start];
  let balance = start;
  for (let m = 0; m < months.toNumber(); m++) {
    balance = balance.times(D1.plus(monthlyReturn));
    points.push(balance);
  }
  return points;
}
