/**
 * v2.5 Module 8 — WCAG 2.x contrast math (pure, no DOM).
 *
 * Used by the settings contrast checker (gain/loss colors against both
 * themes), the high-contrast token tests, and the Phase 5 audit. Target:
 * AA = 4.5:1 normal text / 3:1 large text & UI components; AAA = 7:1.
 */

/** Parses "#rgb", "#rrggbb" or "#rrggbbaa" → [r, g, b] (0-255), null if bad. */
export function parseHexColor(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{3,8})$/i.exec(hex.trim());
  if (!match) return null;
  let h = match[1];
  if (h.length === 3 || h.length === 4) {
    h = h
      .slice(0, 3)
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (h.length !== 6 && h.length !== 8) return null;
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance of an sRGB channel triple. */
export function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colors (1…21). */
export function contrastRatio(hexA: string, hexB: string): number | null {
  const a = parseHexColor(hexA);
  const b = parseHexColor(hexB);
  if (!a || !b) return null;
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

export interface ContrastCheckOptions {
  /** Large text (≥ 18pt / 14pt bold) - AA threshold drops to 3:1. */
  large?: boolean;
  /** AAA thresholds (7:1 / 4.5:1) instead of AA. */
  level?: "AA" | "AAA";
}

/** True when the foreground/background pair passes WCAG 2.2. */
export function passesContrast(
  foreground: string,
  background: string,
  options: ContrastCheckOptions = {}
): boolean {
  const ratio = contrastRatio(foreground, background);
  if (ratio == null) return false;
  const { large = false, level = "AA" } = options;
  const threshold =
    level === "AAA" ? (large ? 4.5 : 7) : large ? 3 : 4.5;
  return ratio >= threshold;
}

/** Human label "7.4:1" (null when either color is invalid). */
export function contrastLabel(
  foreground: string,
  background: string
): string | null {
  const ratio = contrastRatio(foreground, background);
  return ratio == null ? null : `${ratio.toFixed(1)}:1`;
}
