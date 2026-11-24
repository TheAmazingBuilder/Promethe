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
  /** Signed notional in ACCOUNT currency (positive = long the currency). */
  notional: Decimal;
  /** Signed open risk attributed to this leg (account currency). */
  risk: Decimal;
}

export interface DecomposedTrade {
  trade: OpenTradeLike;
  legs: CurrencyLeg[];
  /** Open risk of the whole trade in account currency (0 when no SL). */
  openRisk: Decimal;
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
  let openRisk = D0;
  if (trade.riskAmount !== null && trade.riskAmount !== undefined && String(trade.riskAmount) !== "") {
    openRisk = toD(trade.riskAmount).abs();
  } else if (trade.stopLoss !== null && trade.stopLoss !== undefined && String(trade.stopLoss) !== "") {
    const dist = entry.minus(toD(trade.stopLoss)).abs();
    openRisk = toAccount(dist.times(units), quote, accountCurrency, fxRates);
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
  const legs: CurrencyLeg[] = [];
  const quoteNotional = units.times(current);
  const quoteLegAccount = toAccount(quoteNotional, quote, accountCurrency, fxRates);
  if (base) {
    legs.push({
      currency: base,
      notional: quoteLegAccount.times(sign),
      risk: openRisk.times(sign).div(2),
    });
  }
  legs.push({
    currency: quote,
    notional: quoteLegAccount.times(-sign),
    risk: openRisk.times(-sign).div(2),
  });

  return { trade, legs, openRisk, hasStopLoss, floatingPnl, conversionMissing };
}

export interface CurrencyExposure {
  currency: string;
  /** Signed aggregate notional (account currency). */
  notional: Decimal;
  /** Signed aggregate open risk (account currency). */
  risk: Decimal;
  /** Number of open positions touching this currency. */
  positionCount: number;
  /** Number of positions with positive exposure to this currency. */
  longPositionCount: number;
  /** Number of positions with negative exposure to this currency. */
  shortPositionCount: number;
  /** Long and short notionals kept separate for the duplication check. */
  longNotional: Decimal;
  shortNotional: Decimal;
}

export interface ExposureSummary {
  byCurrency: CurrencyExposure[];
  byInstrument: { key: string; risk: Decimal; notional: Decimal; count: number }[];
  byStrategy: { key: string; risk: Decimal; notional: Decimal; count: number }[];
  totalOpenRisk: Decimal;
  noStopLoss: DecomposedTrade[];
  /** Symbols whose quote currency could not be converted into the account currency. */
  missingFxSymbols: string[];
}

export function aggregateExposure(
  decomposed: DecomposedTrade[]
): ExposureSummary {
  const byCurrency = new Map<string, CurrencyExposure>();
  const byInstrument = new Map<string, { risk: Decimal; notional: Decimal; count: number }>();
  const byStrategy = new Map<string, { risk: Decimal; notional: Decimal; count: number }>();
  let totalOpenRisk = D0;
  const noStopLoss: DecomposedTrade[] = [];
  const missingFxSymbols = new Set<string>();

  for (const d of decomposed) {
    totalOpenRisk = totalOpenRisk.plus(d.openRisk);
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
      cur.notional = cur.notional.plus(leg.notional);
      cur.risk = cur.risk.plus(leg.risk);
      cur.positionCount += 1;
      if (leg.notional.gt(0)) {
        cur.longNotional = cur.longNotional.plus(leg.notional);
        cur.longPositionCount++;
      } else if (leg.notional.lt(0)) {
        cur.shortNotional = cur.shortNotional.plus(leg.notional);
        cur.shortPositionCount++;
      }
      byCurrency.set(leg.currency, cur);
    }
    const inst = byInstrument.get(d.trade.symbol) ?? { risk: D0, notional: D0, count: 0 };
    inst.risk = inst.risk.plus(d.openRisk);
    inst.notional = inst.notional.plus(
      d.legs.reduce((acc, l) => acc.plus(l.notional.abs()), D0).div(2)
    );
    inst.count += 1;
    byInstrument.set(d.trade.symbol, inst);

    const strat = d.trade.strategyName ?? "";
    const st = byStrategy.get(strat) ?? { risk: D0, notional: D0, count: 0 };
    st.risk = st.risk.plus(d.openRisk);
    st.notional = st.notional.plus(
      d.legs.reduce((acc, l) => acc.plus(l.notional.abs()), D0).div(2)
    );
    st.count += 1;
    byStrategy.set(strat, st);
  }

  const sortDesc = <T extends { risk: Decimal }>(a: T, b: T): number =>
    b.risk.abs().cmp(a.risk.abs());

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
    const candidates = [
      {
        direction: "LONG" as const,
        positionCount: currency.longPositionCount,
        notional: currency.longNotional.abs(),
      },
      {
        direction: "SHORT" as const,
        positionCount: currency.shortPositionCount,
        notional: currency.shortNotional.abs(),
      },
    ];

    for (const candidate of candidates) {
      if (candidate.positionCount < 2) continue;
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
      const beforeCur = before.byCurrency.find((b) => b.currency === c.currency);
      const beforePct = beforeCur && balance.gt(0)
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
