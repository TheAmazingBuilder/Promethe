/**
 * Leverage and margin simulator.
 *
 * Notional and required margin are calculated in the selected account
 * currency. A quote-to-account FX rate is mandatory whenever the instrument
 * quote currency differs from the account currency.
 */
import { D0, D100, toD, type DecimalInput } from "@/lib/trading/dec";
import type { Decimal } from "decimal.js";
import type { InstrumentSpec } from "@/lib/trading/types";
import { resolveConversionRate, type FxRateInput } from "./fx";

export interface MarginPositionInput {
  symbol: string;
  instrument: InstrumentSpec;
  lots: DecimalInput;
  entry: DecimalInput;
  /** Optional explicit quote-to-account rate for this position. */
  quoteToAccountRate?: DecimalInput | null;
  /** Set to true for the hypothetical what-if position. */
  hypothetical?: boolean;
}

export interface MarginInput {
  /** Account equity (balance + floating P&L), in account currency. */
  equity: DecimalInput;
  /** Account balance retained for compatibility with existing callers. */
  balance: DecimalInput;
  leverage: DecimalInput;
  accountCurrency?: string | null;
  fxRates?: FxRateInput[] | null;
  /** Margin call level in % (default 100). */
  marginCallLevel?: DecimalInput | null;
  /** Stop-out level in % (default 50). */
  stopOutLevel?: DecimalInput | null;
  positions: MarginPositionInput[];
}

export type MarginInvalidReason =
  | "INVALID_EQUITY"
  | "INVALID_LEVERAGE"
  | "MISSING_ACCOUNT_CURRENCY"
  | "MISSING_QUOTE_CURRENCY"
  | "MISSING_CONVERSION_RATE"
  | "INVALID_POSITION"
  | "INVALID_MARGIN_LEVELS";

export interface MarginPositionResult {
  symbol: string;
  lots: Decimal;
  /** Instrument notional before FX conversion, in quote currency. */
  notionalQuote: Decimal;
  /** Notional in account currency; null when FX conversion is unavailable. */
  notional: Decimal | null;
  /** Required margin in account currency; null when FX conversion is unavailable. */
  requiredMargin: Decimal | null;
  conversionRate: Decimal | null;
  hypothetical: boolean;
}

export interface MarginResult {
  valid: boolean;
  reason: MarginInvalidReason | null;
  missingFxSymbols: string[];
  positions: MarginPositionResult[];
  usedMargin: Decimal | null;
  freeMargin: Decimal | null;
  /** equity / usedMargin * 100, null when no margin is used or calculation is invalid. */
  marginLevel: Decimal | null;
  /** Equity that can be lost before the margin call level. */
  distanceToMarginCall: Decimal | null;
  /** Equity that can be lost before the stop-out level. */
  distanceToStopOut: Decimal | null;
  marginCall: boolean;
  stopOut: boolean;
}

function invalidResult(
  reason: MarginInvalidReason,
  positions: MarginPositionResult[] = [],
  missingFxSymbols: string[] = []
): MarginResult {
  return {
    valid: false,
    reason,
    missingFxSymbols,
    positions,
    usedMargin: null,
    freeMargin: null,
    marginLevel: null,
    distanceToMarginCall: null,
    distanceToStopOut: null,
    marginCall: false,
    stopOut: false,
  };
}

export function calcMargin(input: MarginInput): MarginResult {
  const equity = toD(input.equity);
  const leverage = toD(input.leverage);
  const mcLevel = input.marginCallLevel == null ? toD(100) : toD(input.marginCallLevel);
  const soLevel = input.stopOutLevel == null ? toD(50) : toD(input.stopOutLevel);
  const accountCurrency = input.accountCurrency?.trim().toUpperCase() ?? "";
  const rates = input.fxRates ?? [];

  if (!equity.isFinite()) return invalidResult("INVALID_EQUITY");
  if (!leverage.isFinite() || leverage.lte(0)) return invalidResult("INVALID_LEVERAGE");
  if (!accountCurrency) return invalidResult("MISSING_ACCOUNT_CURRENCY");
  if (
    !mcLevel.isFinite() ||
    !soLevel.isFinite() ||
    mcLevel.lt(0) ||
    soLevel.lt(0) ||
    soLevel.gt(mcLevel)
  ) {
    return invalidResult("INVALID_MARGIN_LEVELS");
  }

  const missingFxSymbols: string[] = [];
  const positions: MarginPositionResult[] = [];
  for (const p of input.positions) {
    const lots = toD(p.lots);
    const entry = toD(p.entry);
    const contractSize = toD(p.instrument.contractSize);
    const quoteCurrency = p.instrument.quoteCurrency?.trim().toUpperCase() ?? "";

    if (
      !lots.isFinite() ||
      !entry.isFinite() ||
      !contractSize.isFinite() ||
      lots.lte(0) ||
      entry.lte(0) ||
      contractSize.lte(0)
    ) {
      return invalidResult("INVALID_POSITION", positions, missingFxSymbols);
    }
    if (!quoteCurrency) return invalidResult("MISSING_QUOTE_CURRENCY", positions, missingFxSymbols);

    const notionalQuote = lots.times(contractSize).times(entry);
    const conversionRate = resolveConversionRate(
      quoteCurrency,
      accountCurrency,
      rates,
      p.quoteToAccountRate ?? null
    );
    if (!conversionRate || !conversionRate.isFinite() || conversionRate.lte(0)) {
      missingFxSymbols.push(p.symbol);
      positions.push({
        symbol: p.symbol,
        lots,
        notionalQuote,
        notional: null,
        requiredMargin: null,
        conversionRate: null,
        hypothetical: p.hypothetical ?? false,
      });
      continue;
    }

    const notional = notionalQuote.times(conversionRate);
    positions.push({
      symbol: p.symbol,
      lots,
      notionalQuote,
      notional,
      requiredMargin: notional.div(leverage),
      conversionRate,
      hypothetical: p.hypothetical ?? false,
    });
  }

  if (missingFxSymbols.length > 0) {
    return invalidResult("MISSING_CONVERSION_RATE", positions, missingFxSymbols);
  }

  const usedMargin = positions.reduce(
    (acc, p) => acc.plus(p.requiredMargin ?? D0),
    D0
  );
  const freeMargin = equity.minus(usedMargin);
  const marginLevel = usedMargin.gt(0) ? equity.div(usedMargin).times(D100) : null;

  const distanceTo = (level: Decimal): Decimal | null => {
    if (!usedMargin.gt(0)) return null;
    return equity.minus(usedMargin.times(level).div(D100));
  };

  return {
    valid: true,
    reason: null,
    missingFxSymbols: [],
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
