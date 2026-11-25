/**
 * Monte Carlo simulation for trading-account outcomes.
 *
 * Resamples historical R-multiples with replacement, or draws win/loss
 * outcomes from hypothetical parameters. Each simulated trade risks a
 * fixed percentage of the current equity (compounded position sizing).
 * A path is considered ruined when its equity drawdown from the initial
 * balance reaches the configured ruin threshold.
 *
 * Ruin behavior:
 * - STOP (default): the path ends the moment the ruin floor is reached.
 *   The trader is assumed to stop trading, so the ending balance freezes
 *   at the equity of the ruin step and the path can no longer recover or
 *   reach the target afterwards.
 * - CONTINUE: the path keeps trading after ruin and may recover. Ruin
 *   is still recorded (the path counts as ruined), but the ending
 *   balance and drawdown keep moving. This models a trader who keeps
 *   trading through a drawdown that crossed the threshold.
 *
 * Pure module: deterministic when a seed is supplied, no database/browser APIs.
 */

export type MonteCarloRuinBehavior = "STOP" | "CONTINUE";
export type MonteCarloSource = "HISTORICAL" | "HYPOTHETICAL";

export interface MonteCarloHypothetical {
  winRatePercent: number;
  avgWinR: number;
  avgLossR: number;
}

export interface MonteCarloInput {
  outcomesR?: number[];
  source?: MonteCarloSource;
  hypothetical?: MonteCarloHypothetical;
  startingBalance: number;
  riskPercent: number;
  iterations: number;
  tradesPerPath: number;
  targetPercent: number;
  ruinThresholdPercent: number;
  ruinBehavior?: MonteCarloRuinBehavior;
  seed: number;
}

export interface MonteCarloDistribution {
  p5: number;
  p25: number;
  median: number;
  p75: number;
  p95: number;
}

export interface MonteCarloEquityBand {
  step: number;
  p5: number;
  p25: number;
  median: number;
  p75: number;
  p95: number;
}

export interface MonteCarloResult {
  source: MonteCarloSource;
  ruinBehavior: MonteCarloRuinBehavior;
  sampleSize: number;
  hypothetical?: MonteCarloHypothetical;
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
  equityBands: MonteCarloEquityBand[];
  equityBandPaths: number;
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

/** Paths kept for the equity fan chart; bands are exact up to this limit. */
const BAND_PATH_LIMIT = 1000;

export function simulateMonteCarlo(input: MonteCarloInput): MonteCarloResult {
  const {
    outcomesR,
    source = "HISTORICAL",
    hypothetical,
    startingBalance,
    riskPercent,
    iterations,
    tradesPerPath,
    targetPercent,
    ruinThresholdPercent,
    ruinBehavior = "STOP",
    seed,
  } = input;

  if (source !== "HISTORICAL" && source !== "HYPOTHETICAL") {
    throw new Error("MONTE_CARLO_SOURCE_INVALID");
  }
  if (ruinBehavior !== "STOP" && ruinBehavior !== "CONTINUE") {
    throw new Error("MONTE_CARLO_RUIN_BEHAVIOR_INVALID");
  }
  if (source === "HISTORICAL") {
    if (
      outcomesR == null ||
      outcomesR.length < 5 ||
      outcomesR.some((r) => !Number.isFinite(r))
    ) {
      throw new Error("MONTE_CARLO_SAMPLE_INVALID");
    }
  } else if (
    hypothetical == null ||
    !Number.isFinite(hypothetical.winRatePercent) ||
    hypothetical.winRatePercent < 0 ||
    hypothetical.winRatePercent > 100 ||
    !Number.isFinite(hypothetical.avgWinR) ||
    hypothetical.avgWinR <= 0 ||
    hypothetical.avgWinR > 20 ||
    !Number.isFinite(hypothetical.avgLossR) ||
    hypothetical.avgLossR >= 0 ||
    hypothetical.avgLossR < -20
  ) {
    throw new Error("MONTE_CARLO_HYPOTHETICAL_INVALID");
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

  const endingBalances: number[] = [];
  const drawdowns: number[] = [];
  const bandSeries: number[][] = [];
  let ruinedCount = 0;
  let targetReachedCount = 0;
  const riskFraction = riskPercent / 100;
  const ruinFloor = startingBalance * (1 - ruinThresholdPercent / 100);
  const targetEquity = startingBalance * (1 + targetPercent / 100);

  // One independent stream per path: a path that stops early (STOP mode)
  // must not shift the draws of the paths that follow, so STOP and
  // CONTINUE stay comparable for the same seed.
  const nextOutcome = (draw: () => number): number => {
    if (source === "HYPOTHETICAL" && hypothetical != null) {
      return draw() < hypothetical.winRatePercent / 100
        ? hypothetical.avgWinR
        : hypothetical.avgLossR;
    }
    const outcomes = outcomesR as number[];
    return outcomes[Math.floor(draw() * outcomes.length)];
  };

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const draw = createRandom(seed + iteration);
    let equity = startingBalance;
    let peak = startingBalance;
    let maxDrawdown = 0;
    let ruined = false;
    let reachedTarget = false;
    let stopped = false;
    const series: number[] = [startingBalance];

    for (let step = 0; step < tradesPerPath; step += 1) {
      if (!stopped) {
        const outcome = nextOutcome(draw);
        equity = Math.max(0, equity * (1 + riskFraction * outcome));
        if (equity > peak) peak = equity;
        const drawdown = peak > 0 ? ((peak - equity) / peak) * 100 : 100;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;
        if (equity >= targetEquity) reachedTarget = true;
        if (equity <= ruinFloor) {
          ruined = true;
          if (ruinBehavior === "STOP") stopped = true;
        }
      }
      series.push(equity);
    }

    endingBalances.push(equity);
    drawdowns.push(maxDrawdown);
    if (bandSeries.length < BAND_PATH_LIMIT) bandSeries.push(series);
    if (ruined) ruinedCount += 1;
    if (reachedTarget) targetReachedCount += 1;
  }

  const equityBands: MonteCarloEquityBand[] = [];
  for (let step = 0; step <= tradesPerPath; step += 1) {
    const values = bandSeries.map((series) => series[step]);
    const band = distribution(values);
    equityBands.push({ step, ...band });
  }

  return {
    source,
    ruinBehavior,
    sampleSize: source === "HISTORICAL" ? (outcomesR as number[]).length : 0,
    ...(source === "HYPOTHETICAL" && hypothetical != null ? { hypothetical } : {}),
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
    equityBands,
    equityBandPaths: bandSeries.length,
    seed,
  };
}
