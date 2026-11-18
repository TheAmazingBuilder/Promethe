/**
 * TradeJournal — statistical helpers for advanced analytics (v2.5 Module 6).
 *
 * Pure, client-safe functions: Wilson score intervals, median / MAD /
 * robust z-scores, and an exact two-sided binomial test. No dependencies
 * beyond the standard library; all inputs are plain numbers.
 */

/** Mean of a number list (null when empty). */
export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Population standard deviation (null when empty). */
export function stdDev(values: number[]): number | null {
  if (values.length === 0) return null;
  const mu = mean(values) ?? 0;
  const variance =
    values.reduce((acc, v) => acc + (v - mu) * (v - mu), 0) / values.length;
  return Math.sqrt(variance);
}

/** Median (null when empty). */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Median absolute deviation around the median (null when empty).
 * MAD = median(|x − median(x)|).
 */
export function mad(values: number[]): { median: number; mad: number } | null {
  const med = median(values);
  if (med == null) return null;
  const deviations = values.map((v) => Math.abs(v - med));
  const madValue = median(deviations);
  if (madValue == null) return null;
  return { median: med, mad: madValue };
}

/**
 * Robust z-score: (x − median) / (1.4826 · MAD). The 1.4826 factor makes
 * MAD a consistent estimator of the standard deviation for normal data.
 *
 * Fallback: when more than half the values are identical, MAD is 0 and a
 * plain robust score is undefined — the classic z-score (mean / std) is
 * used instead, so a far value among near-identical ones is still flagged.
 * Returns null only when there is no spread at all (std is 0 too) or the
 * input list is empty.
 */
export function robustZ(
  value: number,
  values: number[]
): number | null {
  if (values.length === 0) return null;
  const stats = mad(values);
  if (stats == null) return null;
  if (stats.mad > 0) {
    return (value - stats.median) / (1.4826 * stats.mad);
  }
  const mu = mean(values) ?? 0;
  const sd = stdDev(values);
  if (sd == null || sd === 0) return null;
  return (value - mu) / sd;
}

/** Wilson score interval for a proportion (95 % by default, z = 1.96). */
export function wilsonInterval(
  successes: number,
  trials: number,
  z = 1.96
): { lower: number; upper: number; center: number } | null {
  if (trials <= 0 || successes < 0 || successes > trials) return null;
  const p = successes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denom;
  const half =
    (z * Math.sqrt(p * (1 - p) / trials + z2 / (4 * trials * trials))) /
    denom;
  return {
    lower: Math.max(0, center - half),
    upper: Math.min(1, center + half),
    center,
  };
}

/** Binomial probability mass, computed iteratively (stable for n ≤ ~1000). */
export function binomialPmf(k: number, n: number, p: number): number {
  if (k < 0 || k > n || p < 0 || p > 1) return 0;
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  // pmf(0) then walk up to k.
  let pmf = Math.pow(1 - p, n);
  for (let i = 1; i <= k; i++) {
    pmf *= ((n - i + 1) / i) * (p / (1 - p));
  }
  return pmf;
}

/**
 * Exact two-sided binomial p-value: P(X at least as extreme as `observed`
 * successes in `trials` draws under H0 p = `p0`). "At least as extreme"
 * means every outcome whose pmf is ≤ pmf(observed).
 */
export function binomialTwoSidedP(
  observed: number,
  trials: number,
  p0: number
): number | null {
  if (trials <= 0 || observed < 0 || observed > trials) return null;
  if (p0 <= 0 || p0 >= 1) return null;
  const pmfObs = binomialPmf(observed, trials, p0);
  let p = 0;
  for (let k = 0; k <= trials; k++) {
    if (binomialPmf(k, trials, p0) <= pmfObs + 1e-12) {
      p += binomialPmf(k, trials, p0);
    }
  }
  return Math.min(1, p);
}
