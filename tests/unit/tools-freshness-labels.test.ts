/**
 * Lot 1 Phase C (MD §3.6, items 7b + 7d) — P&L simulator estimate flag,
 * converter freshness, instruments static-data label.
 *
 * (7b) isEstimate is true ONLY when a conversion rate was actually
 * missing/estimated — a valid applied rate is not an estimate.
 * (7d) the converter warns on a stale rate (7-day policy, same as the
 * sizing path) and the instruments browser says honestly that its 37
 * presets are static reference data with no live feed.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { previewTrade } from "@/lib/trading/calculate";
import { isFxRateStale, resolveFxRate } from "@/lib/tools/fx";
import { findPreset } from "@/lib/trading/instruments";

const USDJPY = findPreset("USDJPY")!;

const messages = JSON.parse(
  readFileSync(new URL("../../messages/en.json", import.meta.url), "utf8")
) as Record<string, any>;
const converter = readFileSync(
  new URL("../../src/components/tools/currency-converter.tsx", import.meta.url),
  "utf8"
);
const browser = readFileSync(
  new URL("../../src/components/tools/instruments-browser.tsx", import.meta.url),
  "utf8"
);

describe("P&L simulator isEstimate (7b)", () => {
  const base = {
    instrument: USDJPY,
    direction: "LONG" as const,
    lots: "1",
    entry: "149",
    exit: "150",
    stopLoss: "148",
    accountCurrency: "USD",
  };

  it("is false when a valid manual rate was applied", () => {
    const p = previewTrade({ ...base, quoteToAccountRate: "0.006" });
    expect(p.isEstimate).toBe(false);
    expect(p.converted).toBe(true);
    expect(p.grossPnl.toString()).toBe("600");
  });

  it("is false when a valid stored rate was applied", () => {
    const p = previewTrade({
      ...base,
      fxRates: [{ base: "JPY", quote: "USD", rate: "0.006" }],
    });
    expect(p.isEstimate).toBe(false);
    expect(p.grossPnl.toString()).toBe("600");
  });

  it("is true only when the rate was actually missing", () => {
    const p = previewTrade(base);
    expect(p.isEstimate).toBe(true);
    expect(p.riskAmount).toBeNull();
  });

  it("is false when no conversion is needed at all", () => {
    const p = previewTrade({
      instrument: findPreset("XAUUSD")!,
      direction: "LONG",
      lots: "0.5",
      entry: "2345",
      exit: "2351.8",
      stopLoss: "2340",
      accountCurrency: "USD",
    });
    expect(p.isEstimate).toBe(false);
  });
});

describe("converter freshness (7d)", () => {
  it("flags a 30-day-old resolved rate as stale (7-day policy)", () => {
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const resolved = resolveFxRate("EUR", "USD", [
      { base: "EUR", quote: "USD", rate: "1.08", date: old, source: "MANUAL" },
    ]);
    expect(resolved?.date).toBe(old);
    expect(isFxRateStale(resolved?.date)).toBe(true);
  });

  it("does not flag a fresh rate", () => {
    const today = new Date().toISOString().slice(0, 10);
    const resolved = resolveFxRate("EUR", "USD", [
      { base: "EUR", quote: "USD", rate: "1.08", date: today, source: "MANUAL" },
    ]);
    expect(isFxRateStale(resolved?.date)).toBe(false);
  });

  it("the converter shows the stale warning and the rate date", () => {
    expect(converter).toContain("converterRateStale");
    expect(converter).toContain("converterRateUndated");
    expect(converter).toContain("isFxRateStale");
    expect(messages.tools.converterRateStale).toMatch(/stale/i);
    expect(messages.tools.converterRateUndated).toMatch(/no date/i);
  });
});

describe("instruments static-data label (7d)", () => {
  it("labels the 37 presets as static reference data, no live feed", () => {
    expect(browser).toContain('t("instrumentsStaticNote")');
    expect(messages.tools.instrumentsStaticNote).toMatch(/Static reference data/);
    expect(messages.tools.instrumentsStaticNote).toMatch(/no live feed/i);
  });
});
