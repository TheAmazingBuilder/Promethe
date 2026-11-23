/**
 * Monte Carlo simulation for trading-account outcomes.
 *
 * Resamples historical R-multiples with replacement. Each simulated trade
 * risks a fixed percentage of the current equity (compounded position sizing).
 * A path is considered ruined when its equity drawdown from the initial
 * balance reaches the configured ruin threshold.
 *
 * Pure module: deterministic when a seed is supplied, no database/browser APIs.
 */

export interface MonteCarloInput {
  outcomesR: number[];
  startingBalance: number;
  riskPercent: number;
  iterations: number;
  tradesPerPath: number;
  targetPercent: number;
  ruinThresholdPercent: number;
  seed: number;
}

export interface MonteCarloDistribution {
  p5: number;
  p25: number;
  median: number;
  p75: number;
  p95: number;
}

export interface MonteCarloResult {
  sampleSize: number;
  iterations: number;
  tradesPerPath: number;
  startingBalance: number;
  riskPercent: number;
  targetPercent: number;
  ruinThresholdPercent: number;
  probabilityOfRuin: number;
  probabilityOfReachingTarget: number;
  endingBalance: MonteCarloDistribution;
  maxDrawdownPercent: MonteCarloDistribution;
  endingBalanceBuckets: Array<{ from: number; to: number; count: number }>;
  seed: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function distribution(values: number[]): MonteCarloDistribution {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p5: percentile(sorted, 0.05),
    p25: percentile(sorted, 0.25),
    median: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p95: percentile(sorted, 0.95),
  };
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function buildBuckets(values: number[], bucketCount = 10) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return [{ from: min, to: max, count: values.length }];
  }
  const width = (max - min) / bucketCount;
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    from: min + width * index,
    to: index === bucketCount - 1 ? max : min + width * (index + 1),
    count: 0,
  }));
  for (const value of values) {
    const index = Math.min(bucketCount - 1, Math.floor((value - min) / width));
    buckets[index].count += 1;
  }
  return buckets;
}

export function simulateMonteCarlo(input: MonteCarloInput): MonteCarloResult {
  const {
    outcomesR,
    startingBalance,
    riskPercent,
    iterations,
    tradesPerPath,
    targetPercent,
    ruinThresholdPercent,
    seed,
  } = input;

  if (outcomesR.length < 5 || outcomesR.some((r) => !Number.isFinite(r))) {
    throw new Error("MONTE_CARLO_SAMPLE_INVALID");
  }
  if (!Number.isFinite(startingBalance) || startingBalance <= 0) {
    throw new Error("MONTE_CARLO_BALANCE_INVALID");
  }
  if (!Number.isFinite(riskPercent) || riskPercent <= 0 || riskPercent > 10) {
    throw new Error("MONTE_CARLO_RISK_INVALID");
  }
  if (!Number.isInteger(iterations) || iterations < 100 || iterations > 10000) {
    throw new Error("MONTE_CARLO_ITERATIONS_INVALID");
  }
  if (!Number.isInteger(tradesPerPath) || tradesPerPath < 10 || tradesPerPath > 500) {
    throw new Error("MONTE_CARLO_HORIZON_INVALID");
  }
  if (!Number.isFinite(targetPercent) || targetPercent <= 0 || targetPercent > 500) {
    throw new Error("MONTE_CARLO_TARGET_INVALID");
  }
  if (!Number.isFinite(ruinThresholdPercent) || ruinThresholdPercent <= 0 || ruinThresholdPercent >= 100) {
    throw new Error("MONTE_CARLO_RUIN_THRESHOLD_INVALID");
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    throw new Error("MONTE_CARLO_SEED_INVALID");
  }

  const random = createRandom(seed);
  const endingBalances: number[] = [];
  const drawdowns: number[] = [];
  let ruinedCount = 0;
  let targetReachedCount = 0;
  const riskFraction = riskPercent / 100;
  const ruinFloor = startingBalance * (1 - ruinThresholdPercent / 100);
  const targetEquity = startingBalance * (1 + targetPercent / 100);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let equity = startingBalance;
    let peak = startingBalance;
    let maxDrawdown = 0;
    let ruined = false;
    let reachedTarget = false;

    for (let step = 0; step < tradesPerPath; step += 1) {
      const outcome = outcomesR[Math.floor(random() * outcomesR.length)];
      equity = Math.max(0, equity * (1 + riskFraction * outcome));
      if (equity > peak) peak = equity;
      const drawdown = peak > 0 ? ((peak - equity) / peak) * 100 : 100;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
      if (equity <= ruinFloor) ruined = true;
      if (equity >= targetEquity) reachedTarget = true;
    }

    endingBalances.push(equity);
    drawdowns.push(maxDrawdown);
    if (ruined) ruinedCount += 1;
    if (reachedTarget) targetReachedCount += 1;
  }

  return {
    sampleSize: outcomesR.length,
    iterations,
    tradesPerPath,
    startingBalance,
    riskPercent,
    targetPercent,
    ruinThresholdPercent,
    probabilityOfRuin: (ruinedCount / iterations) * 100,
    probabilityOfReachingTarget: (targetReachedCount / iterations) * 100,
    endingBalance: distribution(endingBalances),
    maxDrawdownPercent: distribution(drawdowns),
    endingBalanceBuckets: buildBuckets(endingBalances),
    seed,
  };
}
