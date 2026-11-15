/**
 * Appearance system constants (v2.5 Module 1, spec §1) — client-safe.
 *
 * Mirrors the CSS token overrides in globals.css so the UI can render preview
 * swatches with the ACTUAL palette values, and the dashboard grid can map the
 * density setting to react-grid-layout numbers. The CSS stays the single
 * source of truth for rendering; these maps exist for previews and layout math.
 */

/** Palette keys — must match appearanceInputSchema's enum. */
export const PALETTE_KEYS = [
  "default",
  "colorblind",
  "deuteranopia",
  "protanopia",
  "monochrome",
  "high-contrast",
  "custom",
] as const;

export type PaletteKey = (typeof PALETTE_KEYS)[number];

export function isPaletteKey(value: string): value is PaletteKey {
  return (PALETTE_KEYS as readonly string[]).includes(value);
}

/** Density keys — must match appearanceInputSchema's enum. */
export const DENSITY_KEYS = ["COMPACT", "COMFORTABLE", "SPACIOUS"] as const;

export type DensityKey = (typeof DENSITY_KEYS)[number];

export function isDensityKey(value: string): value is DensityKey {
  return (DENSITY_KEYS as readonly string[]).includes(value);
}

/** react-grid-layout numbers per density (mirrors --dash-row-h / --dash-gap). */
export const DENSITY_GRID: Record<
  DensityKey,
  { rowHeight: number; gap: number }
> = {
  COMPACT: { rowHeight: 34, gap: 8 },
  COMFORTABLE: { rowHeight: 40, gap: 12 },
  SPACIOUS: { rowHeight: 46, gap: 16 },
};

/** Chart palette keys — must match appearanceInputSchema's enum. */
export const CHART_PALETTE_KEYS = [
  "default",
  "colorblind",
  "monochrome",
  "vivid",
] as const;

export type ChartPaletteKey = (typeof CHART_PALETTE_KEYS)[number];

export function isChartPaletteKey(value: string): value is ChartPaletteKey {
  return (CHART_PALETTE_KEYS as readonly string[]).includes(value);
}

/**
 * Preview swatches per palette (gain / loss / neutral) — the LIGHT-theme
 * values of each palette, hardcoded for the option cards in the settings UI.
 * The rendered page keeps using the live CSS variables.
 */
export const PALETTE_PREVIEW: Record<
  Exclude<PaletteKey, "custom">,
  { gain: string; loss: string; neutral: string }
> = {
  default: { gain: "#10b981", loss: "#f43f5e", neutral: "#8b8f98" },
  colorblind: { gain: "#0072b2", loss: "#e69f00", neutral: "#8b8f98" },
  deuteranopia: { gain: "#0072b2", loss: "#e69f00", neutral: "#8b8f98" },
  protanopia: { gain: "#0072b2", loss: "#e69f00", neutral: "#8b8f98" },
  monochrome: { gain: "#5a5f66", loss: "#a8adb4", neutral: "#8b8f98" },
  "high-contrast": { gain: "#008900", loss: "#cc0000", neutral: "#6b7075" },
};

/** 5-swatch strips for the chart-palette option cards (light theme). */
export const CHART_PALETTE_PREVIEW: Record<
  ChartPaletteKey,
  readonly [string, string, string, string, string]
> = {
  default: ["#e76a2c", "#22a6b8", "#3b5bdb", "#d9a514", "#d9584a"],
  colorblind: ["#0072b2", "#e69f00", "#009e73", "#cc79a7", "#56b4e9"],
  monochrome: ["#5a5f66", "#71767d", "#8b8f98", "#a8adb4", "#c3c7cc"],
  vivid: ["#e63329", "#1fb45b", "#7b3fe4", "#e8b90f", "#d6339a"],
};

/** Focus-mode block ids — must match appearanceInputSchema's enum. */
export const FOCUS_BLOCKS = [
  "rules",
  "risk",
  "prop",
  "openTrades",
  "session",
  "actions",
  "planNote",
] as const;

export type FocusBlock = (typeof FOCUS_BLOCKS)[number];

/** Default focus config: every block, amounts visible. */
export const DEFAULT_FOCUS_BLOCKS: readonly FocusBlock[] = FOCUS_BLOCKS;

export function parseFocusBlocks(value: string[] | undefined): FocusBlock[] {
  if (value == null || value.length === 0) return [...DEFAULT_FOCUS_BLOCKS];
  const valid = new Set<string>(FOCUS_BLOCKS);
  const blocks = value.filter((b): b is FocusBlock => valid.has(b));
  // Preserve the canonical order regardless of the stored order.
  return FOCUS_BLOCKS.filter((b) => blocks.includes(b));
}
