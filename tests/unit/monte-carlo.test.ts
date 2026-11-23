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
});
