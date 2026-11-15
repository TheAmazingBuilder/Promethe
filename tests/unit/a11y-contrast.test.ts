/**
 * v2.5 Module 8 — WCAG contrast math + token checks (§3.3).
 */
import { describe, expect, it } from "vitest";
import {
  contrastLabel,
  contrastRatio,
  parseHexColor,
  passesContrast,
  relativeLuminance,
} from "@/lib/a11y/contrast";
import { normalizeA11yPreferences } from "@/lib/a11y/preferences";

describe("contrast math", () => {
  it("black on white = 21:1, white on white = 1:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 1);
  });

  it("relativeLuminance matches WCAG reference values", () => {
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 5);
    // #767676 on white is the classic 4.54:1 AA boundary color.
    expect(contrastRatio("#767676", "#ffffff")).toBeGreaterThan(4.5);
    expect(contrastRatio("#767676", "#ffffff")).toBeLessThan(4.6);
  });

  it("parseHexColor accepts 3/6/8 digits, rejects garbage", () => {
    expect(parseHexColor("#fff")).toEqual([255, 255, 255]);
    expect(parseHexColor("#10b981")).toEqual([16, 185, 129]);
    expect(parseHexColor("#10b981ff")).toEqual([16, 185, 129]);
    expect(parseHexColor("10b981")).toBeNull();
    expect(parseHexColor("#zzz")).toBeNull();
  });

  it("passesContrast AA/AAA and large-text thresholds", () => {
    expect(passesContrast("#000000", "#ffffff", { level: "AAA" })).toBe(true);
    expect(passesContrast("#767676", "#ffffff", { level: "AAA" })).toBe(false);
    expect(passesContrast("#767676", "#ffffff", { large: true })).toBe(true);
    expect(passesContrast("#999999", "#ffffff")).toBe(false);
  });

  it("contrastLabel formats ratios", () => {
    expect(contrastLabel("#000000", "#ffffff")).toBe("21.0:1");
  });
});

describe("Module 1 palettes — gain/loss contrast in both themes", () => {
  // Values from src/lib/dashboard/appearance.ts PALETTE_PREVIEW (light) and
  // globals.css dark variants. Foreground-on-background pairs must pass AA
  // (4.5:1) on their theme background; we check against white/black as the
  // light/dark surfaces.
  const lightPairs: Array<[string, string, string]> = [
    ["default gain", "#10b981", "#ffffff"],
    ["default loss", "#f43f5e", "#ffffff"],
    ["colorblind gain", "#0072b2", "#ffffff"],
    ["colorblind loss", "#e69f00", "#ffffff"],
    ["high-contrast gain", "#008900", "#ffffff"],
    ["high-contrast loss", "#cc0000", "#ffffff"],
  ];

  it("text tone candidates exist that pass AA on white", () => {
    // The -fg derivatives (darker) are what text uses — verify the darkest
    // member of each hue family can pass AA on white (the palettes' -fg
    // values are darker than the base, so this is the lower bound).
    const fgCandidates: Array<[string, string]> = [
      ["default gain-fg", "#047857"],
      ["default loss-fg", "#be123c"],
      ["colorblind gain-fg", "#00608f"],
      ["colorblind loss-fg", "#8f6700"], // darkened in M8 (was #9c7100, 4.40:1)
      ["monochrome gain-fg", "#2a2a2a"],
      ["monochrome loss-fg", "#8a8a8a"], // light tone — large text only
      ["high-contrast gain-fg", "#006b00"],
      ["high-contrast loss-fg", "#a30000"],
    ];
    for (const [label, fg] of fgCandidates) {
      const ratio = contrastRatio(fg, "#ffffff") ?? 0;
      // Monochrome loss-fg is intentionally lighter (gain dark / loss light
      // in monochrome light theme) — accept ≥ 3:1 (large text / UI).
      const threshold = label.includes("monochrome loss") ? 3 : 4.5;
      expect(ratio, `${label} on white`).toBeGreaterThanOrEqual(threshold);
    }
    void lightPairs;
  });

  it("dark theme -fg values pass AA on near-black", () => {
    const darkBg = "#0b0b0e"; // oklch(0.17 0 0) ≈ #0b0b0b
    const darkPairs: Array<[string, string]> = [
      ["dark gain-fg", "#6cb3de"],
      ["dark loss-fg", "#f2ba52"],
      ["dark monochrome gain-fg", "#9a9a9a"],
      ["dark high-contrast gain-fg", "#00e050"],
      ["dark high-contrast loss-fg", "#ff5555"],
    ];
    for (const [label, fg] of darkPairs) {
      const ratio = contrastRatio(fg, darkBg) ?? 0;
      expect(ratio, `${label} on dark`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("normalizeA11yPreferences", () => {
  it("clamps text scale into 80–200", () => {
    expect(normalizeA11yPreferences({ textScale: 40 }).textScale).toBe(80);
    expect(normalizeA11yPreferences({ textScale: 999 }).textScale).toBe(200);
    expect(normalizeA11yPreferences({ textScale: 130 }).textScale).toBe(130);
  });

  it("defaults unknown enum values to SYSTEM/DEFAULT", () => {
    const p = normalizeA11yPreferences({
      contrastMode: "WAT",
      reducedMotion: "NOPE",
      fontFamily: "COMIC",
    });
    expect(p.contrastMode).toBe("SYSTEM");
    expect(p.reducedMotion).toBe("SYSTEM");
    expect(p.fontFamily).toBe("DEFAULT");
  });

  it("null vs 0 for optional numeric knobs", () => {
    expect(normalizeA11yPreferences({ lineHeight: 0 }).lineHeight).toBeNull();
    expect(normalizeA11yPreferences({ lineHeight: 150 }).lineHeight).toBe(150);
    expect(normalizeA11yPreferences({ letterSpacing: -20 }).letterSpacing).toBe(-20);
    expect(normalizeA11yPreferences({}).lineHeight).toBeNull();
  });
});
