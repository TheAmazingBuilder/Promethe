/**
 * TradeJournal — pure calculation engine.
 *
 * All functions are pure, client-safe (no Prisma import) and use decimal.js
 * exclusively. Inputs accept string | number | Decimal.
 *
 * Conventions (documented in docs/financial-conventions.md):
 *  - commission / swap / fees are SIGNED COSTS in the ACCOUNT currency:
 *    positive = cost, negative = credit. netPnl = grossPnl − (costs).
 *  - P&L gross is computed in the QUOTE currency, then converted to the
 *    account currency with `quoteToAccountRate` when provided.
 *  - calcPnL `isEstimate` is true ONLY when quote ≠ account AND no
 *    conversion rate could be resolved (manual or stored): the amounts
 *    are then shown unconverted, i.e. estimated. A valid applied rate —
 *    manual or stored — makes the conversion exact given that rate, so
 *    isEstimate is false (MD §3.6, Lot 1 Phase C). NOTE: this differs
 *    deliberately from calcPositionSize `isEstimate`, which stays true
 *    whenever an FX conversion was applied (a sized position depends on
 *    the rate holding until execution).
 *  - The user's broker P&L (pnlSource = MANUAL) overrides the calculated one.
 *  - R-MULTIPLE IS NET-BASED (MD §3.3): everywhere the term "R multiple"
 *    (stored Trade.rMultiple, previewTrade().rMultiple, realizedRR) means
 *    netPnl / initial risk, with the SAME netPnl that is displayed and
 *    stored. The price-only value (gross P&L / initial risk, before
 *    costs) is kept separately as grossRMultiple and must always be
 *    labelled "(gross)" — never bare "R multiple".
 *
 * ── Manual P&L and R-multiple conventions live in
 * docs/financial-conventions.md (§1–§2) — the draft that used to sit
 * here was moved there verbatim in Lot 1 Phase D. ──
 */
import { D0, D1, D100, Decimal, floorToStep, toD, type DecimalInput } from "./dec";
import type { Direction, InstrumentSpec, ResultType } from "./types";
import {
  isFxRateStale,
  resolveConversionRate,
  resolveConversionRateDetailed,
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

/**
 * R multiple from prices: signed diff / initial stop distance. null if no valid SL.
 * Price-based (gross, before costs) — used for previewTrade().grossRMultiple
 * only. The bare "R multiple" everywhere else is net-based (MD §3.3).
 */
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

/**
 * Directional TP/SL placement issues — the single source of truth for
 * "is this level on the right side of the entry" (MD §3.2). The trade
 * zod schema and the server PATCH path both reject on this; the trade
 * form mirrors it with the SL/TP banners. Entry == TP/SL is an issue too
 * (zero risk / zero reward is not a valid plan).
 */
export type TradeLevelIssue =
  | "TP_WRONG_SIDE"
  | "TP_EQUALS_ENTRY"
  | "SL_WRONG_SIDE"
  | "SL_EQUALS_ENTRY";

export function tradeLevelIssues(
  direction: Direction,
  entry: DecimalInput,
  stopLoss: DecimalInput | null | undefined,
  takeProfit: DecimalInput | null | undefined
): TradeLevelIssue[] {
  const issues: TradeLevelIssue[] = [];
  const e = toD(entry);
  if (!e.isFinite()) return issues;
  if (stopLoss !== null && stopLoss !== undefined) {
    const s = toD(stopLoss);
    if (s.isFinite()) {
      if (s.eq(e)) issues.push("SL_EQUALS_ENTRY");
      else if (stopDistance(direction, entry, stopLoss) === null)
        issues.push("SL_WRONG_SIDE");
    }
  }
  if (takeProfit !== null && takeProfit !== undefined) {
    const tp = toD(takeProfit);
    if (tp.isFinite()) {
      if (tp.eq(e)) issues.push("TP_EQUALS_ENTRY");
      // Same reward-side logic as calcPlannedRR (not via RR itself, so a
      // missing/invalid SL cannot mask a wrong-side TP).
      else if (
        (direction === "LONG" ? tp.minus(e) : e.minus(tp)).lt(0)
      )
        issues.push("TP_WRONG_SIDE");
    }
  }
  return issues;
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

export interface TickValueResult {
  /** Value of 1 tick for the position, in QUOTE currency. */
  quote: Decimal;
  /** Value of 1 tick for the position, in ACCOUNT currency. */
  account: Decimal;
}

/**
 * Value of one tick move for a position of `lots` (MD §3.5).
 *
 * Preset semantics (see src/lib/trading/instruments.ts): `tickSize` is
 * the minimum price increment; the tick value is then
 * tickSize × contractSize × lots (quote currency). When a preset carries
 * an explicit `tickValue` it is taken as the per-lot tick value in quote
 * currency (broker tick value), so tickValue × lots. Returns null when
 * the instrument carries neither — most presets have no tick data at
 * all (only XAUUSD, XAGUSD and USOIL define a tickSize), and the caller
 * must label that honestly instead of showing a zero tick value.
 */
export function calcTickValue(
  instrument: InstrumentSpec,
  lots: DecimalInput,
  quoteToAccountRate?: DecimalInput | null
): TickValueResult | null {
  const lotsD = toD(lots);
  const explicit =
    instrument.tickValue == null ? null : toD(instrument.tickValue);
  const tickSize =
    instrument.tickSize == null ? null : toD(instrument.tickSize);
  let quote: Decimal | null = null;
  if (explicit !== null && explicit.isFinite() && explicit.gt(0)) {
    quote = explicit.times(lotsD);
  } else if (tickSize !== null && tickSize.isFinite() && tickSize.gt(0)) {
    quote = tickSize.times(toD(instrument.contractSize)).times(lotsD);
  }
  if (quote === null) return null;
  const rate = quoteToAccountRate == null ? null : toD(quoteToAccountRate);
  return { quote, account: rate ? quote.times(rate) : quote };
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
  /** True when quote currency ≠ account currency AND no conversion
   *  rate could be resolved — the amounts are then shown unconverted,
   *  i.e. estimated. False when a valid rate (manual or stored) was
   *  applied: the conversion is exact given that rate (MD §3.6). */
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
  // Estimate only when a conversion was needed but no rate exists:
  // the amounts below are then unconverted (rate 1 applied implicitly).
  // A valid applied rate — manual or stored — is not an estimate.
  const isEstimate =
    account !== "" && quote !== "" && quote !== account && rate === null;

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
  /**
   * What the risk % is taken on (MD §3.5). BALANCE (default) uses
   * `accountBalance`. EQUITY uses `accountEquity` — live equity is NOT
   * available to this calculator (AccountEquitySnapshot is EA-heartbeat
   * only and sparse), so the caller must supply the current equity
   * value; when it is missing the sizing is rejected
   * (EQUITY_UNAVAILABLE) instead of silently falling back to balance.
   * The quick-trade form keeps the static initial balance and stays on
   * BALANCE explicitly.
   */
  riskBasis?: "BALANCE" | "EQUITY" | null;
  /** Current live equity, required when riskBasis is EQUITY. */
  accountEquity?: DecimalInput | null;
  /** Risk as % of balance - used when riskAmount is not provided. */
  riskPercent?: DecimalInput | null;
  /** Fixed risk amount in ACCOUNT currency (overrides riskPercent). */
  riskAmount?: DecimalInput | null;
  /**
   * Expected total trading costs for the trade, ACCOUNT currency
   * (commission + swap + fees). When provided (> 0) the position is
   * sized on riskAmount − costs, so the risk taken plus the costs stays
   * within the requested budget; `costsDeducted` on the result reports
   * what was taken off. When absent/zero the sizing is explicitly
   * BEFORE costs (see the UI note) — costs are never silently added.
   */
  estimatedCosts?: DecimalInput | null;
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
  /**
   * Orientation of `quoteToAccountRate` when the rate was typed as a
   * currency pair (e.g. the user typed "149" for USDJPY). When the pair
   * is quote→account the rate is used as-is; when it is the inverse
   * (account→quote) the rate is corrected to 1/rate; when it names
   * neither direction the sizing is rejected (INVALID_CONVERSION_RATE_PAIR).
   * A bare rate with no pair keeps its documented contract: it IS the
   * quote→account rate.
   */
  quoteToAccountRatePair?: { base: string; quote: string } | null;
  /**
   * Stored FxRate table (v2.5 Module 5), used as the conversion fallback
   * when no manual rate is given — resolved via resolveFxRate, so a
   * stored inverted pair is corrected, not used backwards. Entries carry
   * their FxRate.rateDate/source for the provenance on the result.
   */
  fxRates?: FxRateInput[] | null;
}

/** Upper bound on risk per trade (MD §3.5): risking more than 100% of
 * the basis (balance or equity) is rejected, in percent mode and in
 * fixed-amount mode alike. */
export const MAX_RISK_PERCENT = 100;

/**
 * Machine-readable invalid reasons — translated client-side via
 * src/lib/i18n-errors.ts (sizingErrorMessage). Never user-facing prose here.
 */
export type SizingInvalidReason =
  | "STOP_SIDE_LONG"
  | "STOP_SIDE_SHORT"
  | "STOP_EQUALS_ENTRY"
  | "INVALID_AMOUNT"
  | "INVALID_PRICE"
  | "INVALID_INSTRUMENT_SPECS"
  | "INVALID_LOT_CONSTRAINTS"
  | "MISSING_ACCOUNT_CURRENCY"
  | "MISSING_QUOTE_CURRENCY"
  | "MISSING_CONVERSION_RATE"
  | "INVALID_CONVERSION_RATE"
  | "INVALID_CONVERSION_RATE_PAIR"
  | "INSUFFICIENT_RISK"
  | "EQUITY_UNAVAILABLE"
  | "RISK_PERCENT_TOO_HIGH"
  | "COSTS_EXCEED_RISK";

export interface PositionSizeResult {
  valid: boolean;
  reason?: SizingInvalidReason;
  /** Requested risk in ACCOUNT currency. */
  riskAmount: Decimal;
  /** The basis the risk % was taken on (BALANCE = accountBalance). */
  riskBasis: "BALANCE" | "EQUITY";
  /** The basis amount the risk % was applied to. */
  basisAmount: Decimal;
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
  /** Value of 1 tick for the sized position; null when the instrument
   * carries no tick data (see calcTickValue). */
  tickValue: TickValueResult | null;
  /** True when the instrument carries neither tickSize nor tickValue. */
  tickDataMissing: boolean;
  /** Position notional in quote currency. */
  notionalQuote: Decimal;
  /** Minimum lot size considered (for INSUFFICIENT_RISK messaging). */
  minLots: Decimal;
  /**
   * True when the computed size was truncated by maxLots: the result
   * is still valid (a tradable size is returned) but it is NOT the
   * size the risk budget asked for — the UI must show the cap.
   */
  capped: boolean;
  /** Costs taken off the risk budget before sizing (0 = before-costs sizing). */
  costsDeducted: Decimal;
  /** True when quote ≠ account without/with conversion → estimate. */
  isEstimate: boolean;
  /** Where the conversion rate came from: NONE = no conversion needed. */
  rateSource: "NONE" | "MANUAL" | "STORED";
  /** ISO date (YYYY-MM-DD) of the stored rate used; null for a manual rate. */
  rateDate: string | null;
  /**
   * True when a stored rate is stale (older than FX_RATE_STALE_AFTER_DAYS).
   * A manual rate is never "stale" — it was just typed — but it is
   * undated, which the UI labels via rateSource MANUAL + rateDate null.
   * Stale is a flag, not a block: the rate is still applied.
   */
  rateStale: boolean;
  /** The quote→account rate actually applied (null when no conversion). */
  conversionRate: Decimal | null;
}

export function calcPositionSize(input: PositionSizeInput): PositionSizeResult {
  const { instrument } = input;
  const balance = toD(input.accountBalance);
  const lotStep = input.lotStep == null ? toD("0.01") : toD(input.lotStep);
  const requestedMinLots = input.minLots == null ? lotStep : toD(input.minLots);
  const contractSize = toD(instrument.contractSize);
  const maxLots = input.maxLots == null ? null : toD(input.maxLots);
  const riskBasis: "BALANCE" | "EQUITY" =
    input.riskBasis === "EQUITY" ? "EQUITY" : "BALANCE";

  // Risk basis (MD §3.5, 6a): EQUITY never falls back to balance — a
  // missing/invalid equity value rejects the sizing outright, so the UI
  // can never show a balance-sized position labelled as equity-sized.
  const basisAmount =
    riskBasis === "EQUITY" ? toD(input.accountEquity) : balance;
  const basisValid =
    riskBasis === "EQUITY"
      ? basisAmount.isFinite() && basisAmount.gt(0)
      : balance.isFinite() && balance.gt(0);

  // An explicitly supplied fixed risk is authoritative, including zero or
  // negative values (which are rejected below rather than falling back to %).
  const riskAmount =
    input.riskAmount != null
      ? toD(input.riskAmount)
      : basisAmount.times(toD(input.riskPercent ?? 0)).div(D100);
  const riskPercentSupplied =
    input.riskAmount == null ? toD(input.riskPercent ?? 0) : null;

  const accountCurrency = input.accountCurrency?.trim().toUpperCase() ?? "";
  const quoteCurrency = instrument.quoteCurrency?.trim().toUpperCase() ?? "";

  // Broker volume increments are applied from the broker's minimum volume.
  // This also supports valid minima that are not integer multiples of step.

  const invalid = (reason: SizingInvalidReason): PositionSizeResult => ({
    valid: false,
    reason,
    riskAmount,
    riskBasis,
    basisAmount,
    stopDist: null,
    stopPips: null,
    exactUnits: D0,
    lots: D0,
    units: D0,
    actualRiskAmount: D0,
    pipValue: { quote: D0, account: D0 },
    tickValue: null,
    tickDataMissing:
      instrument.tickSize == null && instrument.tickValue == null,
    notionalQuote: D0,
    minLots: requestedMinLots,
    capped: false,
    costsDeducted: D0,
    isEstimate: false,
    rateSource: "NONE",
    rateDate: null,
    rateStale: false,
    conversionRate: null,
  });

  if (riskBasis === "EQUITY" && !basisValid) {
    return invalid("EQUITY_UNAVAILABLE");
  }

  if (
    !basisAmount.isFinite() ||
    !riskAmount.isFinite() ||
    basisAmount.lte(0) ||
    riskAmount.lte(0)
  ) {
    return invalid("INVALID_AMOUNT");
  }

  // Absurd-risk bound (MD §3.5, 6f): never risk more than 100% of the
  // basis in one trade — percent mode or fixed-amount mode alike.
  if (
    (riskPercentSupplied !== null &&
      riskPercentSupplied.isFinite() &&
      riskPercentSupplied.gt(MAX_RISK_PERCENT)) ||
    riskAmount.gt(basisAmount)
  ) {
    return invalid("RISK_PERCENT_TOO_HIGH");
  }

  // Costs (MD §3.5, 6b): when estimated costs are given they come off
  // the risk budget BEFORE sizing, so risk taken + costs stays within
  // the requested budget. Costs >= the whole budget cannot be sized.
  const costsDeducted =
    input.estimatedCosts == null
      ? D0
      : Decimal.max(D0, toD(input.estimatedCosts));
  const sizingBudget = riskAmount.minus(costsDeducted);
  if (sizingBudget.lte(0)) {
    return invalid("COSTS_EXCEED_RISK");
  }

  const entry = toD(input.entry);
  const stopLoss = toD(input.stopLoss);
  if (
    !entry.isFinite() ||
    !stopLoss.isFinite() ||
    entry.lte(0) ||
    stopLoss.lte(0)
  ) {
    return invalid("INVALID_PRICE");
  }
  if (!contractSize.isFinite() || contractSize.lte(0)) {
    return invalid("INVALID_INSTRUMENT_SPECS");
  }

  if (
    !lotStep.isFinite() ||
    lotStep.lte(0) ||
    !requestedMinLots.isFinite() ||
    requestedMinLots.lte(0) ||
    (maxLots != null &&
      (!maxLots.isFinite() ||
        maxLots.lte(0) ||
        maxLots.lt(requestedMinLots)))
  ) {
    return invalid("INVALID_LOT_CONSTRAINTS");
  }

  // Equal prices are invalid regardless of direction; otherwise enforce
  // the strict stop side when direction is known.
  if (entry.eq(stopLoss)) return invalid("STOP_EQUALS_ENTRY");

  // Without a direction, use the absolute stop distance.
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
  let rateSource: PositionSizeResult["rateSource"] = "NONE";
  let rateDate: string | null = null;
  let rateStale = false;
  if (needsConversion) {
    const manualRaw = input.quoteToAccountRate;
    const hasManual =
      manualRaw !== null &&
      manualRaw !== undefined &&
      String(manualRaw).trim() !== "";
    if (hasManual) {
      rate = toD(manualRaw);
      if (!rate.isFinite() || rate.lte(0)) {
        return invalid("INVALID_CONVERSION_RATE");
      }
      // A typed rate is only unambiguous when its pair orientation is
      // known: correct an inverted pair, reject an unrelated one. A bare
      // rate (no pair) keeps its contract: quote→account.
      const pair = input.quoteToAccountRatePair;
      if (pair) {
        const base = pair.base.trim().toUpperCase();
        const quote = pair.quote.trim().toUpperCase();
        if (base === quoteCurrency && quote === accountCurrency) {
          // Direct orientation: use as-is.
        } else if (base === accountCurrency && quote === quoteCurrency) {
          rate = D1.div(rate); // inverted pair: correct the conversion
        } else {
          return invalid("INVALID_CONVERSION_RATE_PAIR");
        }
      }
      rateSource = "MANUAL";
      rateDate = null; // manual rates are undated — labeled as such in the UI
    } else {
      // No manual rate: fall back to the stored FxRate table, resolved
      // via the shared resolver (stored inverted pairs are corrected).
      const resolved = resolveConversionRateDetailed(
        quoteCurrency,
        accountCurrency,
        input.fxRates ?? []
      );
      if (!resolved) {
        return invalid("MISSING_CONVERSION_RATE");
      }
      rate = resolved.rate;
      rateSource = resolved.source;
      rateDate = resolved.date;
      rateStale = isFxRateStale(resolved.date);
    }
  }

  // Stop distance is quoted in the instrument's quote currency. Convert
  // it to the account currency before sizing the position.
  const distAccount = dist.times(rate);
  // Sized on the budget AFTER costs (== riskAmount when no costs given).
  const exactUnits = sizingBudget.div(distAccount);
  const exactLots = exactUnits.div(contractSize);

  // The broker's minimum is itself a valid volume; each subsequent volume
  // adds one lot step. Never round the minimum UP or exceed the risk budget.
  if (exactLots.lt(requestedMinLots)) {
    return invalid("INSUFFICIENT_RISK");
  }
  let lots = requestedMinLots.plus(
    floorToStep(exactLots.minus(requestedMinLots), lotStep)
  );

  // Respect the broker's maximum using the same minimum-anchored increments.
  // A truncated size is still valid, but `capped` marks it so the UI can
  // never present it as the size the risk budget asked for (MD §3.5, 6d).
  let capped = false;
  if (maxLots != null) {
    const maxTradableLots = requestedMinLots.plus(
      floorToStep(maxLots.minus(requestedMinLots), lotStep)
    );
    if (lots.gt(maxTradableLots)) {
      capped = true;
      lots = maxTradableLots;
    }
  }

  const units = lots.times(contractSize);
  const actualRiskAmount = units.times(distAccount);
  const notionalQuote = units.times(entry);

  return {
    valid: true,
    reason: undefined,
    riskAmount,
    riskBasis,
    basisAmount,
    stopDist: dist,
    stopPips: toPips(instrument, dist),
    exactUnits,
    lots,
    units,
    actualRiskAmount,
    pipValue: calcPipValue(instrument, lots, rate),
    tickValue: calcTickValue(instrument, lots, rate),
    tickDataMissing:
      instrument.tickSize == null && instrument.tickValue == null,
    notionalQuote,
    minLots: requestedMinLots,
    capped,
    costsDeducted,
    isEstimate: needsConversion,
    rateSource,
    rateDate,
    rateStale,
    conversionRate: needsConversion ? rate : null,
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
  /**
   * Net-based R: netPnl / initial risk (MD §3.3) — the SAME convention
   * as the stored Trade.rMultiple (see computeDerived) and as
   * realizedRR below. Null when the account-currency risk is unknown
   * (e.g. cross-currency without a rate) or zero.
   */
  rMultiple: Decimal | null;
  /**
   * Price-based R (gross P&L / initial risk, before costs) — the value
   * rMultiple used to carry. Kept for the simulator's "(gross)" label;
   * never present it as a bare "R multiple".
   */
  grossRMultiple: Decimal | null;
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
  // Gross (price-only) R, kept under its own name for the "(gross)"
  // label. The bare "R multiple" below is net-based (MD §3.3).
  const grossR = calcRMultiple(
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
    // Net-based R (MD §3.3): identical to realizedRR, so the live
    // preview shows the same R that gets stored (computeDerived stores
    // netPnl / riskAmount). The result classification therefore also
    // uses the net R, matching the server-side classification of the
    // stored trade.
    rMultiple: realizedRR,
    grossRMultiple: grossR,
    plannedRR: planned,
    realizedRR,
    resultType: classifyResult(pnl.netPnl, realizedRR, input.breakevenThresholdR ?? "0.1"),
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
