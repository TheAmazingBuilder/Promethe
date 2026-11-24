/**
 * v2.5 Module 5 - currency exposure engine.
 *
 * Every open trade is decomposed into currency legs:
 *   EURUSD long  = long EUR, short USD
 *   XAUUSD long  = long XAU, short USD
 *   USDJPY short = short USD, long JPY
 * Legs are notionals (units x price, quote leg converted at the entry
 * price) aggregated per currency, per instrument and per strategy, plus
 * the open risk (entry vs SL distance). Duplication = the same currency
 * in the same direction on 2+ positions above a configurable % of the
 * account balance. The pre-trade check is advisory only: it never blocks
 * a trade, it warns.
 *
 * FX-missing policy (MD §3.6, Lot 1 Phase C): when the quote→account
 * conversion is unavailable, notionals AND open risk are NULLED — the
 * same treatment floating P&L already had — never shown unconverted at
 * 1:1. One exception: an open risk supplied by the server as
 * `riskAmount` is already in account currency, so it stays known and
 * only the notionals are nulled. Aggregates that mix in an unknown leg
 * are null too (never a partial sum presented as a total); the affected
 * symbols are listed in `missingFxSymbols` and the dashboard warns.
 */
import { D0, D100, toD, type DecimalInput } from "@/lib/trading/dec";
import type { Decimal } from "decimal.js";
import { findPreset } from "@/lib/trading/instruments";
import type { FxRateInput } from "./fx";
import { resolveFxRate } from "./fx";
import type { ExposureSettings } from "./types";

export interface OpenTradeLike {
  id: string;
  symbol: string;
  direction: string; // LONG | SHORT
  lots: DecimalInput;
  entryPrice: DecimalInput;
  stopLoss: DecimalInput | null;
  /** Current price override (exposure dashboard) or null = entry price. */
  currentPrice?: DecimalInput | null;
  strategyName?: string | null;
  /** Account currency of the trade, for the risk conversion. */
  accountCurrency?: string | null;
  /** Open risk in account currency when the server already computed it. */
  riskAmount?: DecimalInput | null;
}

export interface CurrencyLeg {
  currency: string;
  /**
   * Signed notional in ACCOUNT currency (positive = long the currency).
   * Null when the quote→account conversion is unavailable (see the
   * FX-missing policy above) — never an unconverted 1:1 figure.
   */
  notional: Decimal | null;
  /**
   * Signed open risk attributed to this leg (account currency).
   * Null when the trade's open risk itself is unknown.
   */
  risk: Decimal | null;
}

export interface DecomposedTrade {
  trade: OpenTradeLike;
  legs: CurrencyLeg[];
  /**
   * Open risk of the whole trade in account currency (0 when no SL).
   * Null when it is price-derived and the quote→account conversion is
   * unavailable. Stays known when the server supplied `riskAmount`
   * (already account currency).
   */
  openRisk: Decimal | null;
  hasStopLoss: boolean;
  /** Unrealised P&L in account currency; null when FX conversion is unavailable. */
  floatingPnl: Decimal | null;
  /** True when quote-currency amounts had to fall back to an unconverted estimate. */
  conversionMissing: boolean;
}

/** Split a symbol into base/quote using presets first, then the 6-letter rule. */
export function splitSymbol(symbol: string): {
  base: string | null;
  quote: string;
} {
  const upper = symbol.trim().toUpperCase();
  const preset = findPreset(upper);
  if (preset) {
    return { base: preset.baseCurrency, quote: preset.quoteCurrency ?? "USD" };
  }
  if (/^[A-Z]{6}$/.test(upper)) {
    return { base: upper.slice(0, 3), quote: upper.slice(3, 6) };
  }
  if (upper.endsWith("USD")) return { base: upper.slice(0, -3) || null, quote: "USD" };
  if (upper.endsWith("EUR")) return { base: upper.slice(0, -3) || null, quote: "EUR" };
  return { base: null, quote: "USD" };
}

function toAccount(
  amount: Decimal,
  fromCurrency: string,
  accountCurrency: string,
  rates: FxRateInput[]
): Decimal {
  if (fromCurrency === accountCurrency) return amount;
  const resolved = resolveFxRate(fromCurrency, accountCurrency, rates);
  return resolved ? amount.times(resolved.rate) : amount;
}

export function decomposeTrade(
  trade: OpenTradeLike,
  accountCurrency: string,
  contractSize: DecimalInput,
  fxRates: FxRateInput[] = []
): DecomposedTrade {
  const { base, quote } = splitSymbol(trade.symbol);
  const sign = trade.direction === "LONG" ? 1 : -1;
  const units = toD(trade.lots).times(toD(contractSize));
  const entry = toD(trade.entryPrice);
  const current =
    trade.currentPrice !== null && trade.currentPrice !== undefined && String(trade.currentPrice) !== ""
      ? toD(trade.currentPrice)
      : entry;
  const conversionMissing =
    quote !== accountCurrency &&
    resolveFxRate(quote, accountCurrency, fxRates) === null;

  // Open risk: |entry - SL| * units, converted quote -> account.
  // A server-supplied riskAmount is already account currency, so it
  // stays known even when FX is missing; a price-derived risk with no
  // conversion is unknown (null), never estimated at 1:1.
  let openRisk: Decimal | null = D0;
  if (trade.riskAmount !== null && trade.riskAmount !== undefined && String(trade.riskAmount) !== "") {
    openRisk = toD(trade.riskAmount).abs();
  } else if (trade.stopLoss !== null && trade.stopLoss !== undefined && String(trade.stopLoss) !== "") {
    const dist = entry.minus(toD(trade.stopLoss)).abs();
    openRisk = conversionMissing
      ? null
      : toAccount(dist.times(units), quote, accountCurrency, fxRates);
  }
  const hasStopLoss =
    trade.stopLoss !== null && trade.stopLoss !== undefined && String(trade.stopLoss) !== "";

  // Floating P&L estimate (quote currency, converted at rate 1 when unknown).
  const diff = sign === 1 ? current.minus(entry) : entry.minus(current);
  const floatingQuote = diff.times(units);
  const floatingPnl = conversionMissing
    ? null
    : toAccount(floatingQuote, quote, accountCurrency, fxRates);

  // Legs: base leg = units of base (valued at the current price in quote,
  // then converted); quote leg = -units * price in quote, converted.
  // With no conversion both legs are quote-denominated, so both notionals
  // are null; leg risk follows the (possibly known) open risk.
  const legs: CurrencyLeg[] = [];
  const quoteNotional = units.times(current);
  const quoteLegAccount = conversionMissing
    ? null
    : toAccount(quoteNotional, quote, accountCurrency, fxRates);
  const legRisk = (s: number): Decimal | null =>
    openRisk === null ? null : openRisk.times(s).div(2);
  if (base) {
    legs.push({
      currency: base,
      notional: quoteLegAccount === null ? null : quoteLegAccount.times(sign),
      risk: legRisk(sign),
    });
  }
  legs.push({
    currency: quote,
    notional: quoteLegAccount === null ? null : quoteLegAccount.times(-sign),
    risk: legRisk(-sign),
  });

  return { trade, legs, openRisk, hasStopLoss, floatingPnl, conversionMissing };
}

export interface CurrencyExposure {
  currency: string;
  /**
   * Signed aggregate notional (account currency). Null when any leg's
   * notional is unknown (FX missing) — a partial sum would understate
   * the exposure, so no sum is shown at all.
   */
  notional: Decimal | null;
  /** Signed aggregate open risk (account currency); null when any leg's risk is unknown. */
  risk: Decimal | null;
  /** Number of open positions touching this currency. */
  positionCount: number;
  /** Number of positions with positive exposure to this currency. */
  longPositionCount: number;
  /** Number of positions with negative exposure to this currency. */
  shortPositionCount: number;
  /** Long and short notionals kept separate for the duplication check; null when unknown. */
  longNotional: Decimal | null;
  shortNotional: Decimal | null;
}

export interface ExposureSummary {
  byCurrency: CurrencyExposure[];
  byInstrument: { key: string; risk: Decimal | null; notional: Decimal | null; count: number }[];
  byStrategy: { key: string; risk: Decimal | null; notional: Decimal | null; count: number }[];
  /** Σ open risk of the known trades; null when any trade's open risk is unknown. */
  totalOpenRisk: Decimal | null;
  noStopLoss: DecomposedTrade[];
  /** Symbols whose quote currency could not be converted into the account currency. */
  missingFxSymbols: string[];
}

/** Add two amounts, propagating unknown (null) instead of summing around it. */
function addKnown(a: Decimal | null, b: Decimal | null): Decimal | null {
  if (a === null || b === null) return null;
  return a.plus(b);
}

export function aggregateExposure(
  decomposed: DecomposedTrade[]
): ExposureSummary {
  const byCurrency = new Map<string, CurrencyExposure>();
  const byInstrument = new Map<string, { risk: Decimal | null; notional: Decimal | null; count: number }>();
  const byStrategy = new Map<string, { risk: Decimal | null; notional: Decimal | null; count: number }>();
  let totalOpenRisk: Decimal | null = D0;
  const noStopLoss: DecomposedTrade[] = [];
  const missingFxSymbols = new Set<string>();

  for (const d of decomposed) {
    totalOpenRisk = addKnown(totalOpenRisk, d.openRisk);
    if (!d.hasStopLoss) noStopLoss.push(d);
    if (d.conversionMissing) missingFxSymbols.add(d.trade.symbol);
    for (const leg of d.legs) {
      const cur = byCurrency.get(leg.currency) ?? {
        currency: leg.currency,
        notional: D0,
        risk: D0,
        positionCount: 0,
        longPositionCount: 0,
        shortPositionCount: 0,
        longNotional: D0,
        shortNotional: D0,
      };
      cur.notional = addKnown(cur.notional, leg.notional);
      cur.risk = addKnown(cur.risk, leg.risk);
      cur.positionCount += 1;
      if (leg.notional !== null && leg.notional.gt(0)) {
        cur.longNotional = addKnown(cur.longNotional, leg.notional);
        cur.longPositionCount++;
      } else if (leg.notional !== null && leg.notional.lt(0)) {
        cur.shortNotional = addKnown(cur.shortNotional, leg.notional);
        cur.shortPositionCount++;
      }
      byCurrency.set(leg.currency, cur);
    }
    const inst = byInstrument.get(d.trade.symbol) ?? { risk: D0 as Decimal | null, notional: D0 as Decimal | null, count: 0 };
    inst.risk = addKnown(inst.risk, d.openRisk);
    const legsAbs = d.legs.reduce<Decimal | null>(
      (acc, l) => addKnown(acc, l.notional === null ? null : l.notional.abs()),
      D0
    );
    inst.notional = addKnown(inst.notional, legsAbs === null ? null : legsAbs.div(2));
    inst.count += 1;
    byInstrument.set(d.trade.symbol, inst);

    const strat = d.trade.strategyName ?? "";
    const st = byStrategy.get(strat) ?? { risk: D0 as Decimal | null, notional: D0 as Decimal | null, count: 0 };
    st.risk = addKnown(st.risk, d.openRisk);
    st.notional = addKnown(st.notional, legsAbs === null ? null : legsAbs.div(2));
    st.count += 1;
    byStrategy.set(strat, st);
  }

  // Nulls sort last: an unknown exposure is not "small", it is unknown.
  const sortDesc = <T extends { risk: Decimal | null }>(a: T, b: T): number => {
    if (a.risk === null && b.risk === null) return 0;
    if (a.risk === null) return 1;
    if (b.risk === null) return -1;
    return b.risk.abs().cmp(a.risk.abs());
  };

  return {
    byCurrency: [...byCurrency.values()].sort(sortDesc),
    byInstrument: [...byInstrument.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort(sortDesc),
    byStrategy: [...byStrategy.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort(sortDesc),
    totalOpenRisk,
    noStopLoss,
    missingFxSymbols: [...missingFxSymbols].sort(),
  };
}

export interface DuplicationAlert {
  currency: string;
  direction: "LONG" | "SHORT";
  positionCount: number;
  /** Same-direction notional in account currency. */
  notional: Decimal;
  riskPctOfBalance: Decimal;
}

/** Same currency, same direction, on 2+ positions, above the threshold. */
export function detectDuplication(
  summary: ExposureSummary,
  accountBalance: DecimalInput,
  settings: ExposureSettings
): DuplicationAlert[] {
  const balance = toD(accountBalance);
  if (!settings.enabled || !balance.isFinite() || balance.lte(0)) return [];
  const threshold = toD(settings.duplicationThresholdPercent);
  if (!threshold.isFinite() || threshold.lte(0)) return [];

  const alerts: DuplicationAlert[] = [];
  for (const currency of summary.byCurrency) {
    // A currency whose same-direction notional is unknown (FX missing)
    // cannot be evaluated against the threshold — skip it, never guess.
    const candidates = [
      {
        direction: "LONG" as const,
        positionCount: currency.longPositionCount,
        notional: currency.longNotional === null ? null : currency.longNotional.abs(),
      },
      {
        direction: "SHORT" as const,
        positionCount: currency.shortPositionCount,
        notional: currency.shortNotional === null ? null : currency.shortNotional.abs(),
      },
    ];

    for (const candidate of candidates) {
      if (candidate.positionCount < 2) continue;
      if (candidate.notional === null) continue;
      const pct = candidate.notional.div(balance).times(D100);
      if (pct.gte(threshold)) {
        alerts.push({
          currency: currency.currency,
          direction: candidate.direction,
          positionCount: candidate.positionCount,
          notional: candidate.notional,
          riskPctOfBalance: pct,
        });
      }
    }
  }
  return alerts;
}

export interface PreTradeWarning {
  level: "info" | "warning";
  messageKey: "duplication" | "concentration" | "noStopLoss";
  currency?: string;
  detail: string;
}

/**
 * Non-blocking pre-trade check: warns when the new position increases an
 * already concentrated currency or duplicates a currency held elsewhere.
 * Returns an empty array when there is nothing to flag. Never throws for
 * bad input: an unparseable new trade simply yields no warning.
 */
export function checkPreTrade(
  candidate: OpenTradeLike,
  openTrades: OpenTradeLike[],
  accountBalance: DecimalInput,
  accountCurrency: string,
  contractSizeFor: (symbol: string) => DecimalInput,
  settings: ExposureSettings,
  fxRates: FxRateInput[] = []
): PreTradeWarning[] {
  const warnings: PreTradeWarning[] = [];
  try {
    if (!settings.enabled) return warnings;
    const balance = toD(accountBalance);
    const decomposeAll = (list: OpenTradeLike[]): DecomposedTrade[] =>
      list.map((t) => decomposeTrade(t, accountCurrency, contractSizeFor(t.symbol), fxRates));
    const before = aggregateExposure(decomposeAll(openTrades));
    const after = aggregateExposure([
      ...decomposeAll(openTrades),
      decomposeTrade(candidate, accountCurrency, contractSizeFor(candidate.symbol), fxRates),
    ]);
    const maxPct = toD(settings.maxCurrencyExposurePercent);
    for (const c of after.byCurrency) {
      // Unknown notionals (FX missing) cannot be compared to the
      // threshold — skip the currency instead of treating it as 0.
      if (c.notional === null) continue;
      const beforeCur = before.byCurrency.find((b) => b.currency === c.currency);
      const beforePct = beforeCur && beforeCur.notional !== null && balance.gt(0)
        ? beforeCur.notional.abs().div(balance).times(D100)
        : D0;
      const afterPct = balance.gt(0)
        ? c.notional.abs().div(balance).times(D100)
        : D0;
      if (afterPct.gte(maxPct) && afterPct.gt(beforePct)) {
        warnings.push({
          level: "warning",
          messageKey: "concentration",
          currency: c.currency,
          detail: `${c.currency}: ${afterPct.toFixed(1)}%`,
        });
      }
    }
    const dups = detectDuplication(after, accountBalance, settings);
    for (const d of dups) {
      const wasDup = detectDuplication(before, accountBalance, settings).some(
        (b) => b.currency === d.currency && b.direction === d.direction
      );
      if (!wasDup) {
        warnings.push({
          level: "warning",
          messageKey: "duplication",
          currency: d.currency,
          detail: `${d.currency} ${d.direction} x${d.positionCount}`,
        });
      }
    }
    if (
      candidate.stopLoss === null ||
      candidate.stopLoss === undefined ||
      String(candidate.stopLoss) === ""
    ) {
      warnings.push({ level: "info", messageKey: "noStopLoss", detail: "" });
    }
  } catch {
    return [];
  }
  return warnings;
}
