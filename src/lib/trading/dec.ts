/**
 * Decimal foundation for ALL financial math.
 * Never use JS floats for money/prices/lots/pips.
 *
 * Prisma interop: Prisma.Decimal IS decimal.js. At the DB boundary we pass
 * strings (exact round-trip), and engine inputs accept string | number | Decimal.
 */
import Decimal from "decimal.js";

Decimal.set({
  precision: 28,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -18,
  toExpPos: 24,
});

export { Decimal };
export type DecimalInput = Decimal.Value;

/** Safe conversion; null/undefined/invalid → fallback (default 0). */
export function toD(
  v: DecimalInput | null | undefined,
  fallback?: DecimalInput
): Decimal {
  if (v === null || v === undefined) return new Decimal(fallback ?? 0);
  if (Decimal.isDecimal(v)) return v as Decimal;
  try {
    return new Decimal(v);
  } catch {
    return new Decimal(fallback ?? 0);
  }
}

export const D0 = new Decimal(0);
export const D1 = new Decimal(1);
export const D10 = new Decimal(10);
export const D100 = new Decimal(100);

/** Round DOWN to a step (e.g. lot step 0.01) — never risk more than requested. */
export function floorToStep(v: DecimalInput, step: DecimalInput): Decimal {
  const s = toD(step);
  if (s.lte(0)) return toD(v);
  return toD(v).div(s).floor().times(s);
}
