import { describe, expect, it } from "vitest";
import {
  getCandlestickPattern,
  isCandlestickPatternCategory,
  isCandlestickPatternId,
  listCandlestickPatterns,
  searchCandlestickPatterns,
} from "@/lib/gaia/patterns/catalog";

describe("Gaia candlestick pattern catalog", () => {
  it("exposes a stable, unique set of built-in pattern ids", () => {
    const patterns = listCandlestickPatterns();
    const ids = patterns.map((pattern) => pattern.id);

    expect(patterns.length).toBeGreaterThanOrEqual(16);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("doji");
    expect(ids).toContain("three-white-soldiers");
    expect(ids).toContain("three-black-crows");
  });

  it("resolves only known ids and keeps illustration paths code-owned", () => {
    expect(getCandlestickPattern("doji")?.illustration).toBe(
      "/patterns/candlesticks/doji.svg",
    );
    expect(getCandlestickPattern("../private/file")).toBeUndefined();
    expect(isCandlestickPatternId("hammer")).toBe(true);
    expect(isCandlestickPatternId("not-a-pattern")).toBe(false);
  });

  it("searches by names, aliases, accents and ids", () => {
    expect(searchCandlestickPatterns({ query: "Doji" }).map((p) => p.id)).toContain("doji");
    expect(searchCandlestickPatterns({ query: "marteau" }).map((p) => p.id)).toContain("hammer");
    expect(searchCandlestickPatterns({ query: "étoile du matin" }).map((p) => p.id)).toContain("morning-star");
    expect(searchCandlestickPatterns({ query: "three-black-crows" }).map((p) => p.id)).toContain("three-black-crows");
  });

  it("combines text, category and bias filters", () => {
    const results = searchCandlestickPatterns({
      query: "doji",
      category: "indecision",
      bias: "neutral",
    });
    expect(results.map((p) => p.id)).toEqual(["doji", "long-legged-doji"]);
  });

  it("returns all patterns for empty query and all filters", () => {
    expect(searchCandlestickPatterns()).toHaveLength(listCandlestickPatterns().length);
    expect(searchCandlestickPatterns({ category: "all", bias: "all" })).toHaveLength(
      listCandlestickPatterns().length,
    );
  });

  it("validates the finite category vocabulary", () => {
    expect(isCandlestickPatternCategory("indecision")).toBe(true);
    expect(isCandlestickPatternCategory("arbitrary")).toBe(false);
  });

  it("provides the explanatory fields required by the future library UI", () => {
    for (const pattern of listCandlestickPatterns()) {
      expect(pattern.name.trim()).not.toBe("");
      expect(pattern.description.trim()).not.toBe("");
      expect(pattern.marketContext.trim()).not.toBe("");
      expect(pattern.interpretation.trim()).not.toBe("");
      expect(pattern.confirmation.trim()).not.toBe("");
      expect(pattern.caveats.trim()).not.toBe("");
      expect(pattern.illustration).toMatch(/^\/patterns\/candlesticks\/[a-z0-9-]+\.svg$/);
    }
  });
});
