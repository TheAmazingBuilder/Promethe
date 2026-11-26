import { describe, expect, it } from "vitest";
import {
  isFxRateStale,
  parseFxCsv,
  resolveConversionRate,
  resolveConversionRateDetailed,
  resolveFxRate,
} from "@/lib/tools/fx";

describe("resolveFxRate — provenance", () => {
  it("carries the date/source of the leg used, direct and inverted", () => {
    const rates = [
      { base: "USD", quote: "JPY", rate: "149.25", date: "2026-11-20", source: "CSV" },
    ];
    const direct = resolveFxRate("USD", "JPY", rates);
    expect(direct?.date).toBe("2026-11-20");
    expect(direct?.source).toBe("CSV");
    const inverted = resolveFxRate("JPY", "USD", rates);
    expect(inverted?.rate.toFixed(12)).toBe("0.006700167504");
    expect(inverted?.date).toBe("2026-11-20");
    expect(inverted?.source).toBe("CSV");
  });

  it("triangulation reports the oldest leg date", () => {
    const result = resolveFxRate("EUR", "JPY", [
      { base: "EUR", quote: "USD", rate: "1.1", date: "2026-11-20", source: "MANUAL" },
      { base: "USD", quote: "JPY", rate: "150", date: "2026-11-10", source: "CSV" },
    ]);
    expect(result?.rate.toString()).toBe("165");
    expect(result?.date).toBe("2026-11-10");
  });
});

describe("resolveConversionRateDetailed", () => {
  it("manual rate wins, labeled MANUAL with no date", () => {
    const d = resolveConversionRateDetailed("JPY", "USD", [
      { base: "JPY", quote: "USD", rate: "0.006", date: "2026-11-20", source: "CSV" },
    ], "0.007");
    expect(d?.rate.toString()).toBe("0.007");
    expect(d?.source).toBe("MANUAL");
    expect(d?.date).toBeNull();
  });

  it("stored fallback keeps source + FxRate.rateDate", () => {
    const d = resolveConversionRateDetailed("JPY", "USD", [
      { base: "JPY", quote: "USD", rate: "0.006", date: "2026-11-20", source: "CSV" },
    ]);
    expect(d?.rate.toString()).toBe("0.006");
    expect(d?.source).toBe("STORED");
    expect(d?.date).toBe("2026-11-20");
  });

  it("returns null when no manual rate and no stored path exists", () => {
    expect(resolveConversionRateDetailed("JPY", "USD", [])).toBeNull();
  });
});

describe("isFxRateStale", () => {
  const now = new Date("2026-11-24T12:00:00.000Z");
  it("undated rates are flagged stale", () => {
    expect(isFxRateStale(null, now)).toBe(true);
    expect(isFxRateStale(undefined, now)).toBe(true);
    expect(isFxRateStale("", now)).toBe(true);
  });
  it("today's rate is fresh, a 6-day-old rate is fresh, an 8-day-old rate is stale", () => {
    expect(isFxRateStale("2026-11-24", now)).toBe(false);
    expect(isFxRateStale("2026-11-18", now)).toBe(false);
    expect(isFxRateStale("2026-11-16", now)).toBe(true);
    expect(isFxRateStale("2020-01-01", now)).toBe(true);
  });
  it("a future-dated rate is not stale", () => {
    expect(isFxRateStale("2026-11-25", now)).toBe(false);
  });
});

describe("resolveFxRate", () => {
  it("resolves direct and inverse rates", () => {
    const rates = [{ base: "USD", quote: "JPY", rate: "149.25" }];
    expect(resolveFxRate("USD", "JPY", rates)?.rate.toString()).toBe("149.25");
    expect(resolveFxRate("JPY", "USD", rates)?.rate.toFixed(12)).toBe(
      "0.006700167504"
    );
  });

  it("triangulates through an intermediate currency", () => {
    const result = resolveFxRate("EUR", "JPY", [
      { base: "EUR", quote: "USD", rate: "1.1" },
      { base: "USD", quote: "JPY", rate: "150" },
    ]);
    expect(result?.rate.toString()).toBe("165");
    expect(result?.triangulated).toBe(true);
    expect(result?.path).toEqual(["EURUSD", "USDJPY"]);
  });

  it("rejects missing currency codes and non-finite rates", () => {
    expect(resolveFxRate("", "", [])).toBeNull();
    expect(
      resolveFxRate("USD", "JPY", [{ base: "USD", quote: "JPY", rate: "NaN" }])
    ).toBeNull();
  });

  it("prefers a positive manual rate and falls back when the manual rate is invalid", () => {
    const rates = [{ base: "JPY", quote: "USD", rate: "0.006" }];
    expect(resolveConversionRate("JPY", "USD", rates, "0.007")?.toString()).toBe(
      "0.007"
    );
    expect(resolveConversionRate("JPY", "USD", rates, "0")?.toString()).toBe(
      "0.006"
    );
  });
});

describe("parseFxCsv", () => {
  it("preserves decimal precision and rejects invalid rates", () => {
    const result = parseFxCsv(
      "base,quote,rate\nEUR,USD,1.085000123456789\nUSD,JPY,149.123456789012345\nUSD,JPY,0\nUSD,JPY,-1\nUSD,JPY,NaN"
    );

    expect(result.rates.map((rate) => rate.rate)).toEqual([
      "1.085000123456789",
      "149.123456789012345",
    ]);
    expect(result.errors).toHaveLength(3);
  });
});
