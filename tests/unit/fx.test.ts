import { describe, expect, it } from "vitest";
import { parseFxCsv, resolveConversionRate, resolveFxRate } from "@/lib/tools/fx";

describe("resolveFxRate", () => {
  it("resolves direct and inverse rates", () => {
    const rates = [{ base: "USD", quote: "JPY", rate: "149.25" }];
    expect(resolveFxRate("USD", "JPY", rates)?.rate.toString()).toBe("149.25");
    expect(resolveFxRate("JPY", "USD", rates)?.rate.toString()).toBe(
      "0.006700167504187604"
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
