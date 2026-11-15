/**
 * v2.5 Module 2 — benchmark engine unit tests (spec §4.5, §7).
 *
 * Covers: fixed % compounding/linear, fixed R per period, partial periods
 * (prorated), empty history, normalization to 100, gap at end, period
 * comparisons / beat rate, required monthly return, projection cone,
 * monthly returns, timezone boundaries (period borders don't move with DST).
 */
import { describe, expect, it } from "vitest";
import {
  buildFixedBenchmark,
  compareEquityToBenchmark,
  monthlyReturns,
  projectionCone,
  requiredMonthlyReturn,
  type EquityPointLite,
} from "@/lib/charts/benchmark";

describe("benchmark — fixed series", () => {
  it("compounding 1 %/month grows geometrically", () => {
    const s = buildFixedBenchmark(
      {
        percent: 1,
        period: "MONTH",
        compounding: true,
        startDate: "2025-01-01T00:00:00.000Z",
        startBalance: "1000",
      },
      "2025-04-01T00:00:00.000Z"
    );
    expect(s).toHaveLength(4); // start + Feb + Mar + Apr(1st)... end == Apr 1 boundary
    expect(s[0].value).toBe(1000);
    expect(s[1].value).toBeCloseTo(1010, 6);
    expect(s[2].value).toBeCloseTo(1020.1, 6);
    expect(s[3].value).toBeCloseTo(1030.301, 4);
  });

  it("linear 1 %/month grows arithmetically", () => {
    const s = buildFixedBenchmark(
      {
        percent: 1,
        period: "MONTH",
        compounding: false,
        startDate: "2025-01-01T00:00:00.000Z",
        startBalance: "1000",
      },
      "2025-04-01T00:00:00.000Z"
    );
    expect(s[2].value).toBeCloseTo(1020, 6);
    expect(s[3].value).toBeCloseTo(1030, 6);
  });

  it("fixed R per period adds R arithmetically", () => {
    const s = buildFixedBenchmark(
      {
        rPerPeriod: 2,
        period: "WEEK",
        compounding: false,
        startDate: "2025-01-06T00:00:00.000Z", // Monday
      },
      "2025-01-27T00:00:00.000Z" // 3 weeks later (Monday)
    );
    // start=100 (default base), weeks at 13, 20, 27 → 3 boundaries + start.
    expect(s[0].value).toBe(100);
    expect(s[s.length - 1].value).toBeCloseTo(106, 6);
  });

  it("partial period is prorated", () => {
    // 1 %/month from Jan 1; end mid-February (half the month elapsed).
    const s = buildFixedBenchmark(
      {
        percent: 1,
        period: "MONTH",
        compounding: false,
        startDate: "2025-01-01T00:00:00.000Z",
        startBalance: "1000",
      },
      "2025-02-15T00:00:00.000Z"
    );
    // Boundaries: start, Feb 1 (k=1). Final at Feb 15 = 1 + 14/28 periods.
    expect(s).toHaveLength(3);
    expect(s[1].value).toBeCloseTo(1010, 6);
    expect(s[2].value).toBeCloseTo(1000 * (1 + 0.01 * 1.5), 4);
  });

  it("empty result on invalid dates or end ≤ start", () => {
    expect(
      buildFixedBenchmark(
        { percent: 1, period: "MONTH", compounding: true, startDate: "nope" },
        "2025-01-01T00:00:00.000Z"
      )
    ).toEqual([]);
    expect(
      buildFixedBenchmark(
        {
          percent: 1,
          period: "MONTH",
          compounding: true,
          startDate: "2025-06-01T00:00:00.000Z",
        },
        "2025-01-01T00:00:00.000Z"
      )
    ).toEqual([]);
  });

  it("month boundaries do not shift with DST (timezone param)", () => {
    const utc = buildFixedBenchmark(
      {
        percent: 1,
        period: "MONTH",
        compounding: false,
        startDate: "2025-03-01T00:00:00.000Z",
        startBalance: "100",
      },
      "2025-04-05T00:00:00.000Z",
      "UTC"
    );
    const toronto = buildFixedBenchmark(
      {
        percent: 1,
        period: "MONTH",
        compounding: false,
        startDate: "2025-03-01T00:00:00.000Z",
        startBalance: "100",
      },
      "2025-04-05T00:00:00.000Z",
      "America/Toronto"
    );
    // DST (Mar 9) does not move the April boundary.
    expect(utc[1].date).toBe("2025-04-01T00:00:00.000Z");
    expect(toronto[1].date).toBe("2025-04-01T00:00:00.000Z");
  });
});

describe("benchmark — comparison", () => {
  const benchmark = buildFixedBenchmark(
    {
      percent: 1,
      period: "MONTH",
      compounding: false,
      startDate: "2025-01-01T00:00:00.000Z",
      startBalance: "1000",
    },
    "2025-04-01T00:00:00.000Z"
  );

  it("normalizes both curves to 100 at the common start", () => {
    const equity: EquityPointLite[] = [
      { date: "2025-01-05T00:00:00.000Z", equity: 1000 },
      { date: "2025-02-05T00:00:00.000Z", equity: 1100 },
    ];
    const r = compareEquityToBenchmark(equity, benchmark, { unit: "MONTH" });
    expect(r.firstDate).toBe("2025-01-05T00:00:00.000Z");
    const first = r.points[0];
    // Step function: at Jan 5 the benchmark is still at its base (1000).
    expect(first.equityIndex).toBeCloseTo(100, 6);
    expect(first.benchmarkIndex).toBeCloseTo(100, 6);
    // At the Feb 5 equity point the benchmark stepped to 1010 → index 101.
    const feb = r.points.find((p) => p.date === "2025-02-05T00:00:00.000Z")!;
    expect(feb.equityIndex).toBeCloseTo(110, 6);
    expect(feb.benchmarkIndex).toBeCloseTo(101, 6);
  });

  it("gap at end and beat rate", () => {
    // Equity: +2 %/month (beats 1 %/month twice, then flat).
    const equity: EquityPointLite[] = [
      { date: "2025-01-01T00:00:00.000Z", equity: 1000 },
      { date: "2025-02-01T00:00:00.000Z", equity: 1020 },
      { date: "2025-03-01T00:00:00.000Z", equity: 1040.4 },
      { date: "2025-04-01T00:00:00.000Z", equity: 1030 },
    ];
    const r = compareEquityToBenchmark(equity, benchmark, { unit: "MONTH" });
    expect(r.periods).toHaveLength(3);
    // Feb: +2 % vs +1 % → beaten ; Mar: +2 % vs +1 % → beaten ; Apr: −1 % vs +1 % → not.
    expect(r.periods.filter((p) => p.beaten)).toHaveLength(2);
    expect(r.beatRate).toBeCloseTo((2 / 3) * 100, 6);
    // End: equity index 103, linear benchmark index 103 → gap = 0.
    expect(r.gapAtEnd).toBeCloseTo(0, 6);
  });

  it("empty history → empty comparison", () => {
    const r = compareEquityToBenchmark([], benchmark);
    expect(r.points).toHaveLength(0);
    expect(r.beatRate).toBeNull();
    expect(r.gapAtEnd).toBeNull();
  });
});

describe("benchmark — goal & projection", () => {
  it("required monthly return compounds to the goal", () => {
    const r = requiredMonthlyReturn(1000, 2000, 12);
    expect(r).not.toBeNull();
    expect(1000 * Math.pow(1 + r! / 100, 12)).toBeCloseTo(2000, 4);
    expect(requiredMonthlyReturn(1000, 2000, 0)).toBeNull();
    expect(requiredMonthlyReturn(0, 2000, 12)).toBeNull();
  });

  it("projection cone from realized monthly returns", () => {
    const cone = projectionCone([1, 3], 1000, 2);
    expect(cone).not.toBeNull();
    expect(cone!.meanMonthlyReturn).toBeCloseTo(2, 6);
    expect(cone!.stdMonthlyReturn).toBeCloseTo(1, 6);
    expect(cone!.base[1]).toBeCloseTo(1000 * 1.02 * 1.02, 4);
    expect(cone!.low[1]).toBeLessThan(cone!.base[1]);
    expect(cone!.high[1]).toBeGreaterThan(cone!.base[1]);
    expect(projectionCone([1], 1000, 12)).toBeNull(); // < 2 samples
  });

  it("monthly returns over calendar months", () => {
    const equity: EquityPointLite[] = [
      { date: "2025-01-31T00:00:00.000Z", equity: 1000 },
      { date: "2025-02-15T00:00:00.000Z", equity: 1050 },
      { date: "2025-02-28T00:00:00.000Z", equity: 1040 },
      { date: "2025-03-31T00:00:00.000Z", equity: 1100 },
    ];
    const r = monthlyReturns(equity);
    // Feb uses the LAST value of Feb (1040): +4 %; Mar: 1100/1040 − 1.
    expect(r).toHaveLength(2);
    expect(r[0]).toBeCloseTo(4, 6);
    expect(r[1]).toBeCloseTo((1100 / 1040 - 1) * 100, 6);
  });
});
