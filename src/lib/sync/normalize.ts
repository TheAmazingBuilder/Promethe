/**
 * v3 — Pure normalization shared by the EA sync engine AND the file import
 * parsers (v3 §4.2: "shared parsing-normalization module so file import and
 * EA produce identical trades").
 *
 * Everything here is pure and client-safe: no Prisma, no Node APIs.
 */
import { D0, Decimal, toD } from "@/lib/trading/dec";
import type { MtPlatform } from "./types";

// ── Time conversion ──────────────────────────────────────────────────────────

/**
 * Converts a broker SERVER time (unix seconds) to a UTC Date using the GMT
 * offset announced in the payload. The EA never converts to UTC itself —
 * it sends server time + offset, we do the arithmetic once, here.
 */
export function serverTimeToUtc(unixSeconds: number, gmtOffsetSeconds: number): Date {
  return new Date((unixSeconds - gmtOffsetSeconds) * 1000);
}

/** Builds an externalId stable across the EA and the import parsers. */
export function positionExternalId(
  platform: MtPlatform,
  server: string,
  login: string,
  positionId: string
): string {
  return `${platform}:${server}:${login}:${positionId}`;
}

/**
 * MT4 partial-close stitching: when a partial close happens, MT4 creates a
 * new ticket for the REMAINDER whose comment references the original, e.g.
 * "from #123456" (remainder points at the original) or "to #123456"
 * (closed part points at the remainder's chain head).
 */
export function parseMt4ChainComment(comment: string | null | undefined): {
  kind: "from" | "to";
  ticket: string;
} | null {
  if (!comment) return null;
  const match = /(?:from|de)\s*#?(\d+)|to\s*#?(\d+)/i.exec(comment.trim());
  if (!match) return null;
  if (match[1]) return { kind: "from", ticket: match[1] };
  if (match[2]) return { kind: "to", ticket: match[2] };
  return null;
}

// ── Cost conversion ──────────────────────────────────────────────────────────

/**
 * MetaTrader signs costs NEGATIVE (a 0.70 commission arrives as "-0.70").
 * The app convention is the opposite (positive = cost, negative = credit).
 */
export function eaCostToAppCost(value: string | number | null | undefined): Decimal {
  if (value === null || value === undefined || value === "") return D0;
  const d = toD(value);
  if (!d.isFinite()) return D0;
  return d.negated();
}

/** Sum of EA-signed costs converted to app signing. */
export function eaCostsToApp(
  commission?: string | null,
  swap?: string | null,
  fees?: string | null
): { commission: Decimal; swap: Decimal; fees: Decimal } {
  return {
    commission: eaCostToAppCost(commission),
    swap: eaCostToAppCost(swap),
    fees: eaCostToAppCost(fees),
  };
}

/**
 * Broker net P&L from an EA closing payload, in the ACCOUNT currency:
 * net = gross profit + (EA-signed costs, still MT convention).
 */
export function brokerNetPnl(
  profit: string | number,
  commission?: string | null,
  swap?: string | null,
  fees?: string | null
): Decimal {
  const gross = toD(profit);
  const costs = eaCostToAppCost(commission)
    .plus(eaCostToAppCost(swap))
    .plus(eaCostToAppCost(fees));
  return gross.minus(costs);
}

// ── Symbol normalization ─────────────────────────────────────────────────────

/** Well-known retail aliases → canonical symbols. */
const SYMBOL_ALIASES: Record<string, string> = {
  GOLD: "XAUUSD",
  XAU: "XAUUSD",
  SILVER: "XAGUSD",
  XAG: "XAGUSD",
  DAX: "GER40",
  DE30: "GER40",
  DAX40: "GER40",
  US30: "US30",
  DOW: "US30",
  WS30: "US30",
  NAS100: "NAS100",
  USTEC: "NAS100",
  SPX500: "SPX500",
  US500: "SPX500",
  GER40: "GER40",
};

/** Suffixes/prefixes brokers append to symbols ("XAUUSDm", "EURUSD.pro"). */
const SYMBOL_SUFFIXES = [
  ".pro", ".raw", ".ecn", ".ecnpro", ".stp", ".stp2", ".sz", ".premium",
  ".int", ".i", ".m", ".c", ".classic", ".standard", ".cent", ".micro",
  ".forex", ".fx", ".spot", ".swapfree", ".s", ".r", ".a", ".e", ".g",
  "_i", "_m", "_pro", "_raw", "_ecn", "+", "#", "-",
  // Bare single-letter retail suffixes (Exness "XAUUSDm", ICMarkets "EURUSDr"…).
  "m", "t", "r", "s", "c", "i", "z", "e", "a", "g",
];
const SYMBOL_PREFIXES = ["micro.", "m.", "pro.", "ecn.", "raw."];

/**
 * Normalizes a broker symbol to its canonical form:
 *  1. alias map (GOLD → XAUUSD …) — re-checked after every strip
 *  2. iteratively strips known suffixes / prefixes
 * Returns the UPPERCASE best-effort canonical symbol (never empty). The
 * bare single-letter suffixes are a documented heuristic: real retail
 * feed names ("XAUUSDm", "EURUSDr") normalize cleanly, aliases are applied
 * between strips so "SILVERm" → "SILVER" → "XAGUSD" instead of over-stripping.
 */
export function normalizeBrokerSymbol(brokerSymbol: string): string {
  let symbol = brokerSymbol.trim().toUpperCase();
  if (!symbol) return brokerSymbol;

  let changed = true;
  while (changed) {
    changed = false;

    // Alias first (and between strips): "GOLD" → "XAUUSD", "SILVER" → "XAGUSD".
    const alias = SYMBOL_ALIASES[symbol];
    if (alias && alias !== symbol) {
      symbol = alias;
      changed = true;
      continue;
    }

    for (const suffix of SYMBOL_SUFFIXES) {
      const upper = suffix.toUpperCase();
      if (symbol.length > upper.length + 3 && symbol.endsWith(upper)) {
        symbol = symbol.slice(0, -upper.length);
        changed = true;
        break;
      }
    }
    if (!changed) {
      for (const prefix of SYMBOL_PREFIXES) {
        const upper = prefix.toUpperCase();
        if (symbol.length > upper.length + 3 && symbol.startsWith(upper)) {
          symbol = symbol.slice(upper.length);
          changed = true;
          break;
        }
      }
    }
  }
  return symbol;
}

// ── Instrument spec inference ────────────────────────────────────────────────

export interface InferredSpec {
  digits: number;
  pipSize: string;
  pointSize: string;
  contractSize: string;
  tickSize: string | null;
  tickValue: string | null;
}

/**
 * Infers an InstrumentSpec from the EA-provided symbolSpec. The pipSize is a
 * HEURISTIC (10 points per pip for FX; 0.10 for 2-digit metals) — the user
 * confirms/overrides it in the symbol-mapping UI (XAUUSD stays configurable,
 * as in v1).
 */
export function inferSpecFromPayload(spec: {
  digits: string;
  point: string;
  tickSize: string;
  tickValue: string;
  contractSize: string;
}): InferredSpec {
  const digits = Math.max(0, Math.round(toD(spec.digits).toNumber()));
  const point = toD(spec.point);
  const safePoint = point.gt(0) ? point : toD(Math.pow(10, -digits));

  // pip = 10 points for 3/5-digit FX quotes; for metals (2 digits, price
  // magnitude in thousands) the retail convention is 0.10.
  let pipSize: Decimal;
  if (digits <= 2) {
    pipSize = safePoint.times(10); // 2 digits, point 0.01 → pip 0.10 (XAU)
    if (pipSize.lte(0)) pipSize = toD("0.10");
  } else {
    pipSize = safePoint.times(10); // 5 digits → 0.0001 ; 3 digits (JPY) → 0.01
    if (pipSize.lte(0)) pipSize = toD("0.0001");
  }

  return {
    digits,
    pipSize: pipSize.toString(),
    pointSize: safePoint.toString(),
    contractSize: toD(spec.contractSize).gt(0) ? spec.contractSize : "100000",
    tickSize: spec.tickSize && toD(spec.tickSize).gt(0) ? spec.tickSize : null,
    tickValue: spec.tickValue && toD(spec.tickValue).gt(0) ? spec.tickValue : null,
  };
}

/** Default spec when nothing is known about the symbol (pending mapping). */
export function fallbackSpec(): InferredSpec {
  return {
    digits: 5,
    pipSize: "0.0001",
    pointSize: "0.00001",
    contractSize: "100000",
    tickSize: null,
    tickValue: null,
  };
}

// ── Exit reason inference ────────────────────────────────────────────────────

/**
 * Infers the exit reason from the final price vs SL/TP with a small
 * tolerance (brokers fill at/slippage past the exact level).
 */
export function inferExitReason(
  direction: "LONG" | "SHORT",
  closePrice: string | number,
  stopLoss?: string | number | null,
  takeProfit?: string | number | null
): string {
  const close = toD(closePrice);
  const tolerance = close.abs().times("0.0005"); // 0.05% of price magnitude
  const atStop = (level: string | number | null | undefined) =>
    level !== null && level !== undefined && close.minus(toD(level)).abs().lte(tolerance);

  if (stopLoss != null && atStop(stopLoss)) return "SL_HIT";
  if (takeProfit != null && atStop(takeProfit)) return "TP_HIT";
  return "MANUAL";
}

// ── Balances ─────────────────────────────────────────────────────────────────

/** Maps a BALANCE_OPERATION to the CashTransaction type. */
export function balanceOperationType(
  amount: string | number,
  kind?: "DEPOSIT" | "WITHDRAWAL" | "CREDIT" | null
): "DEPOSIT" | "WITHDRAWAL" | "BONUS" {
  if (kind === "CREDIT") return "BONUS";
  return toD(amount).gte(0) ? "DEPOSIT" : "WITHDRAWAL";
}
