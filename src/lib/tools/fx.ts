/**
 * v2.5 Module 5 - currency conversion (FxRate).
 *
 * Rates are manual or CSV-imported (see the converter tab). Resolution:
 *   1. an explicitly provided manual rate always wins (calcPnL contract);
 *   2. direct rate base->quote, or its inverse;
 *   3. triangulation through one intermediate currency (USD first, then
 *      the other majors). Path is returned so the UI can show how the rate
 *      was derived, e.g. EUR->USD->XAU.
 */
import { D1, toD, type DecimalInput } from "@/lib/trading/dec";
import type { Decimal } from "decimal.js";
import type { FxRateEntry } from "./types";

export interface FxRateInput {
  base: string;
  quote: string;
  rate: DecimalInput;
}

export interface ResolvedFxRate {
  rate: Decimal;
  /** e.g. ["EURUSD", "USDJPY"] - the legs actually used. */
  path: string[];
  /** True when a triangulation leg was needed. */
  triangulated: boolean;
}

const TRIANGULATION_HUBS = ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD"];

function norm(code: string): string {
  return code.trim().toUpperCase();
}

function findDirect(
  from: string,
  to: string,
  rates: FxRateInput[]
): { rate: Decimal; direct: boolean } | null {
  for (const r of rates) {
    const b = norm(r.base);
    const q = norm(r.quote);
    const v = toD(r.rate);
    if (!v.isFinite() || v.lte(0)) continue;
    if (b === from && q === to) return { rate: v, direct: true };
    if (b === to && q === from) return { rate: D1.div(v), direct: true };
  }
  return null;
}

/** Resolve 1 `from` = rate `to`. Null when no path exists. */
export function resolveFxRate(
  from: string,
  to: string,
  rates: FxRateInput[]
): ResolvedFxRate | null {
  const f = norm(from);
  const t = norm(to);
  if (!f || !t) return null;
  if (f === t) return { rate: D1, path: [], triangulated: false };
  const direct = findDirect(f, t, rates);
  if (direct) {
    return {
      rate: direct.rate,
      path: [`${f}${t}`],
      triangulated: false,
    };
  }
  for (const hub of TRIANGULATION_HUBS) {
    if (hub === f || hub === t) continue;
    const leg1 = findDirect(f, hub, rates);
    const leg2 = findDirect(hub, t, rates);
    if (leg1 && leg2) {
      return {
        rate: leg1.rate.times(leg2.rate),
        path: [`${f}${hub}`, `${hub}${t}`],
        triangulated: true,
      };
    }
  }
  return null;
}

/**
 * Conversion rate for calcPnL: quote -> account.
 * `manualRate` (explicit user input) always wins; otherwise the stored
 * FxRate table is resolved (direct or triangulated). Null = no conversion.
 */
export function resolveConversionRate(
  quoteCurrency: string,
  accountCurrency: string,
  rates: FxRateInput[],
  manualRate?: DecimalInput | null
): Decimal | null {
  if (manualRate !== null && manualRate !== undefined && String(manualRate) !== "") {
    const m = toD(manualRate);
    if (m.gt(0)) return m;
  }
  if (!quoteCurrency || !accountCurrency) return null;
  const resolved = resolveFxRate(quoteCurrency, accountCurrency, rates);
  return resolved ? resolved.rate : null;
}

/** Parse a CSV of FX rates: header `base,quote,rate` (or pair,rate).
 * Rows carry no id: the server assigns one on upsert. */
export function parseFxCsv(text: string): {
  rates: Omit<FxRateEntry, "id">[];
  errors: string[];
} {
  const rates: Omit<FxRateEntry, "id">[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/);
  const today = new Date().toISOString().slice(0, 10);
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return;
    const cells = line.split(/[;,]/).map((c) => c.trim());
    const first = (cells[0] ?? "").toUpperCase();
    if (/BASE|PAIR|SYMBOL/.test(first)) return; // header
    let base = "";
    let quote = "";
    let rateRaw = "";
    if (cells.length >= 3) {
      [base, quote, rateRaw] = cells as [string, string, string];
    } else if (cells.length === 2 && first.length === 6) {
      base = first.slice(0, 3);
      quote = first.slice(3, 6);
      rateRaw = cells[1] ?? "";
    } else {
      errors.push(`L${idx + 1}: ${line}`);
      return;
    }
    const parsedRate = toD(rateRaw);
    if (!parsedRate.isFinite() || parsedRate.lte(0)) {
      errors.push(`L${idx + 1}: ${line}`);
      return;
    }
    rates.push({
      base: base.toUpperCase(),
      quote: quote.toUpperCase(),
      rate: parsedRate.toString(),
      source: "CSV",
      date: today,
    });
  });
  return { rates, errors };
}
