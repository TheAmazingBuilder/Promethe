import { describe, expect, it } from "vitest";
import { simulateMonteCarlo } from "@/lib/analytics/monte-carlo";

const base = {
  outcomesR: [1, 1, 1, 1, 1, 1],
  startingBalance: 10_000,
  riskPercent: 1,
  iterations: 500,
  tradesPerPath: 50,
  targetPercent: 5,
  ruinThresholdPercent: 30,
  seed: 12345,
};

describe("Monte Carlo simulation", () => {
  it("is reproducible for a fixed seed", () => {
    expect(simulateMonteCarlo(base)).toEqual(simulateMonteCarlo(base));
  });

  it("compounds positive historical R outcomes and reaches the target", () => {
    const result = simulateMonteCarlo(base);
    expect(result.probabilityOfRuin).toBe(0);
    expect(result.probabilityOfReachingTarget).toBe(100);
    expect(result.endingBalance.median).toBeGreaterThan(base.startingBalance);
    expect(result.endingBalanceBuckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(base.iterations);
  });

  it("detects ruin when every sampled trade loses more than the configured threshold permits", () => {
    const result = simulateMonteCarlo({
      ...base,
      outcomesR: [-10, -10, -10, -10, -10],
      riskPercent: 5,
      ruinThresholdPercent: 20,
    });
    expect(result.probabilityOfRuin).toBe(100);
    expect(result.probabilityOfReachingTarget).toBe(0);
  });

  it("rejects insufficient historical samples", () => {
    expect(() => simulateMonteCarlo({ ...base, outcomesR: [1, -1, 0, 1] })).toThrow("MONTE_CARLO_SAMPLE_INVALID");
  });

  it("rejects invalid risk and iteration bounds", () => {
    expect(() => simulateMonteCarlo({ ...base, riskPercent: 11 })).toThrow("MONTE_CARLO_RISK_INVALID");
    expect(() => simulateMonteCarlo({ ...base, iterations: 99 })).toThrow("MONTE_CARLO_ITERATIONS_INVALID");
  });

  it("STOP freezes a ruined path at the equity of the ruin step", () => {
    const result = simulateMonteCarlo({
      ...base,
      outcomesR: [-10, -10, -10, -10, -10],
      riskPercent: 5,
      ruinThresholdPercent: 20,
      ruinBehavior: "STOP",
    });
    expect(result.probabilityOfRuin).toBe(100);
    expect(result.probabilityOfReachingTarget).toBe(0);
    // One losing trade halves the equity: 10_000 -> 5_000, below the 8_000
    // ruin floor, so every path stops there and never trades again.
    expect(result.endingBalance.median).toBe(5000);
    expect(result.endingBalance.p95).toBe(5000);
    expect(result.equityBands[result.equityBands.length - 1].median).toBe(5000);
  });

  it("CONTINUE keeps trading after ruin, so a ruined path can fall further", () => {
    const result = simulateMonteCarlo({
      ...base,
      outcomesR: [-10, -10, -10, -10, -10],
      riskPercent: 5,
      ruinThresholdPercent: 20,
      ruinBehavior: "CONTINUE",
    });
    expect(result.probabilityOfRuin).toBe(100);
    expect(result.probabilityOfReachingTarget).toBe(0);
    // 50 halvings: the median ending balance is effectively zero.
    expect(result.endingBalance.median).toBeLessThan(1);
    expect(result.equityBands[result.equityBands.length - 1].median).toBeLessThan(1);
  });

  it("STOP and CONTINUE agree on ruin probability for the same seed", () => {
    const sample = {
      ...base,
      outcomesR: [-2, -1, 0.5, 1, 2, 3],
      riskPercent: 2,
      ruinThresholdPercent: 15,
    };
    const stopped = simulateMonteCarlo({ ...sample, ruinBehavior: "STOP" });
    const continued = simulateMonteCarlo({ ...sample, ruinBehavior: "CONTINUE" });
    // Ruin is defined by ever touching the floor; stopping early does not
    // change whether a path touches it, because paths draw independently.
    expect(stopped.probabilityOfRuin).toBe(continued.probabilityOfRuin);
    expect(stopped.source).toBe("HISTORICAL");
    expect(continued.ruinBehavior).toBe("CONTINUE");
  });

  it("hypothetical win rate 100% compounds the average win exactly", () => {
    const result = simulateMonteCarlo({
      startingBalance: 10_000,
      source: "HYPOTHETICAL",
      hypothetical: { winRatePercent: 100, avgWinR: 1, avgLossR: -1 },
      riskPercent: 1,
      iterations: 200,
      tradesPerPath: 10,
      targetPercent: 5,
      ruinThresholdPercent: 30,
      seed: 7,
    });
    expect(result.source).toBe("HYPOTHETICAL");
    expect(result.sampleSize).toBe(0);
    expect(result.probabilityOfRuin).toBe(0);
    expect(result.probabilityOfReachingTarget).toBe(100);
    expect(result.endingBalance.median).toBeCloseTo(10_000 * 1.01 ** 10, 1);
  });

  it("hypothetical win rate 0% compounds the average loss exactly", () => {
    const result = simulateMonteCarlo({
      startingBalance: 10_000,
      source: "HYPOTHETICAL",
      hypothetical: { winRatePercent: 0, avgWinR: 1, avgLossR: -1 },
      riskPercent: 1,
      iterations: 200,
      tradesPerPath: 10,
      targetPercent: 5,
      ruinThresholdPercent: 30,
      seed: 7,
    });
    expect(result.probabilityOfRuin).toBe(0);
    expect(result.probabilityOfReachingTarget).toBe(0);
    expect(result.endingBalance.median).toBeCloseTo(10_000 * 0.99 ** 10, 1);
  });

  it("hypothetical runs are reproducible for a fixed seed", () => {
    const input = {
      startingBalance: 10_000,
      source: "HYPOTHETICAL" as const,
      hypothetical: { winRatePercent: 55, avgWinR: 1.5, avgLossR: -1 },
      riskPercent: 1,
      iterations: 500,
      tradesPerPath: 50,
      targetPercent: 10,
      ruinThresholdPercent: 30,
      seed: 99,
    };
    expect(simulateMonteCarlo(input)).toEqual(simulateMonteCarlo(input));
  });

  it("equity bands cover every step and stay ordered", () => {
    const result = simulateMonteCarlo(base);
    expect(result.equityBands).toHaveLength(base.tradesPerPath + 1);
    expect(result.equityBands[0]).toEqual({
      step: 0,
      p5: base.startingBalance,
      p25: base.startingBalance,
      median: base.startingBalance,
      p75: base.startingBalance,
      p95: base.startingBalance,
    });
    for (const band of result.equityBands) {
      expect(band.p5).toBeLessThanOrEqual(band.p25);
      expect(band.p25).toBeLessThanOrEqual(band.median);
      expect(band.median).toBeLessThanOrEqual(band.p75);
      expect(band.p75).toBeLessThanOrEqual(band.p95);
    }
    expect(result.equityBandPaths).toBe(Math.min(base.iterations, 1000));
  });

  it("rejects an invalid ruin behavior and invalid hypothetical parameters", () => {
    expect(() =>
      simulateMonteCarlo({ ...base, ruinBehavior: "PAUSE" as "STOP" }),
    ).toThrow("MONTE_CARLO_RUIN_BEHAVIOR_INVALID");
    expect(() =>
      simulateMonteCarlo({
        startingBalance: 10_000,
        source: "HYPOTHETICAL",
        riskPercent: 1,
        iterations: 200,
        tradesPerPath: 20,
        targetPercent: 10,
        ruinThresholdPercent: 30,
        seed: 1,
      }),
    ).toThrow("MONTE_CARLO_HYPOTHETICAL_INVALID");
    expect(() =>
      simulateMonteCarlo({
        startingBalance: 10_000,
        source: "HYPOTHETICAL",
        hypothetical: { winRatePercent: 101, avgWinR: 1, avgLossR: -1 },
        riskPercent: 1,
        iterations: 200,
        tradesPerPath: 20,
        targetPercent: 10,
        ruinThresholdPercent: 30,
        seed: 1,
      }),
    ).toThrow("MONTE_CARLO_HYPOTHETICAL_INVALID");
    expect(() =>
      simulateMonteCarlo({ ...base, outcomesR: undefined, source: "HISTORICAL" }),
    ).toThrow("MONTE_CARLO_SAMPLE_INVALID");
  });

  it("handles extreme volatility and loss-dominated samples without crashing", () => {
    const volatile = simulateMonteCarlo({
      ...base,
      outcomesR: [-20, 20, -20, 20, -20],
      riskPercent: 10,
    });
    expect(volatile.endingBalanceBuckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(base.iterations);
    expect(volatile.probabilityOfRuin).toBeGreaterThanOrEqual(0);
    expect(volatile.probabilityOfRuin).toBeLessThanOrEqual(100);

    const losing = simulateMonteCarlo({
      ...base,
      outcomesR: [-2, -2, -2, -1, -1],
      riskPercent: 2,
      ruinThresholdPercent: 10,
    });
    expect(losing.probabilityOfRuin).toBeGreaterThan(0);
    expect(losing.probabilityOfReachingTarget).toBe(0);
    expect(losing.endingBalance.median).toBeLessThan(base.startingBalance);
  });
});
