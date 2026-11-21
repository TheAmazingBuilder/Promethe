/**
 * v2.5 Module 8 — Accessibility preferences (client-safe types + apply).
 *
 * Everything here is a DISPLAY concern applied through data-attributes and
 * CSS variables on <html> (globals.css "Module 8" blocks) so the changes are
 * instant, theme-agnostic and never re-render the tree. The values are
 * mirrored to localStorage (per-device) and read by the pre-paint script so
 * there is NO flash of unstyled content before hydration (§3.3).
 */

export type ContrastMode = "STANDARD" | "HIGH" | "SYSTEM";
export type ReducedMotionMode = "SYSTEM" | "ON" | "OFF";
export type FontFamilyChoice = "DEFAULT" | "DYSLEXIA_FRIENDLY" | "MONO_NUMBERS";
export type FocusRingStyle = "STANDARD" | "ENHANCED";

export interface A11yPreferences {
  /** Root font-size percent, 80-200 (WCAG 1.4.4 reflow-safe scaling). */
  textScale: number;
  contrastMode: ContrastMode;
  reducedMotion: ReducedMotionMode;
  fontFamily: FontFamilyChoice;
  /** Line-height percent 100-200 (null = theme default). */
  lineHeight: number | null;
  /** Letter-spacing per-mille −50…200 (null = theme default). */
  letterSpacing: number | null;
  focusRingStyle: FocusRingStyle;
  largerTouchTargets: boolean;
  underlineLinks: boolean;
  tabularNumbers: boolean;
}

export const DEFAULT_A11Y_PREFERENCES: A11yPreferences = {
  textScale: 100,
  contrastMode: "SYSTEM",
  reducedMotion: "SYSTEM",
  fontFamily: "DEFAULT",
  lineHeight: null,
  letterSpacing: null,
  focusRingStyle: "STANDARD",
  largerTouchTargets: false,
  underlineLinks: false,
  tabularNumbers: false,
};

/** Text-scale presets (§3.3): Small / Default / Large / Extra large. */
export const TEXT_SCALE_PRESETS: ReadonlyArray<{
  key: "small" | "default" | "large" | "xlarge";
  value: number;
}> = [
  { key: "small", value: 90 },
  { key: "default", value: 100 },
  { key: "large", value: 130 },
  { key: "xlarge", value: 160 },
];

export const A11Y_STORAGE_KEY = "tj-a11y";

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(v)));
}

/** Normalizes any partial record into valid preferences (never throws). */
export function normalizeA11yPreferences(
  raw: Partial<Record<keyof A11yPreferences, unknown>> | null | undefined
): A11yPreferences {
  const d = DEFAULT_A11Y_PREFERENCES;
  if (!raw) return { ...d };
  const contrast =
    raw.contrastMode === "HIGH" || raw.contrastMode === "STANDARD"
      ? raw.contrastMode
      : "SYSTEM";
  const motion =
    raw.reducedMotion === "ON" || raw.reducedMotion === "OFF"
      ? raw.reducedMotion
      : "SYSTEM";
  const font =
    raw.fontFamily === "DYSLEXIA_FRIENDLY" || raw.fontFamily === "MONO_NUMBERS"
      ? raw.fontFamily
      : "DEFAULT";
  return {
    textScale:
      typeof raw.textScale === "number" && Number.isFinite(raw.textScale)
        ? clamp(raw.textScale, 80, 200)
        : d.textScale,
    contrastMode: contrast,
    reducedMotion: motion,
    fontFamily: font,
    lineHeight:
      typeof raw.lineHeight === "number" && Number.isFinite(raw.lineHeight)
        ? raw.lineHeight === 0
          ? null // 0 = unset → theme default
          : clamp(raw.lineHeight, 100, 200)
        : null,
    letterSpacing:
      typeof raw.letterSpacing === "number" && Number.isFinite(raw.letterSpacing)
        ? clamp(raw.letterSpacing, -50, 200)
        : null,
    focusRingStyle: raw.focusRingStyle === "ENHANCED" ? "ENHANCED" : "STANDARD",
    largerTouchTargets: raw.largerTouchTargets === true,
    underlineLinks: raw.underlineLinks === true,
    tabularNumbers: raw.tabularNumbers === true,
  };
}

/**
 * Applies the preferences to <html> (client only). Idempotent — safe to call
 * on every change. Mirrors the exact attribute names produced by the
 * pre-paint script so first paint and later updates never disagree.
 */
export function applyA11yToDocument(prefs: A11yPreferences): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  // Text scale — root font-size percent (rem tokens scale automatically).
  if (prefs.textScale !== 100) {
    root.style.fontSize = `${prefs.textScale}%`;
  } else {
    root.style.removeProperty("font-size");
  }

  // Contrast (STANDARD clears, HIGH sets, SYSTEM lets the media query rule).
  if (prefs.contrastMode === "HIGH" || prefs.contrastMode === "STANDARD") {
    root.setAttribute("data-contrast", prefs.contrastMode.toLowerCase());
  } else {
    root.removeAttribute("data-contrast");
  }

  // Reduced motion (SYSTEM lets prefers-reduced-motion rule).
  if (prefs.reducedMotion === "ON" || prefs.reducedMotion === "OFF") {
    root.setAttribute("data-motion", prefs.reducedMotion.toLowerCase());
  } else {
    root.removeAttribute("data-motion");
  }

  // Font family.
  if (prefs.fontFamily === "DYSLEXIA_FRIENDLY") {
    root.setAttribute("data-font", "dyslexia-friendly");
  } else if (prefs.fontFamily === "MONO_NUMBERS") {
    root.setAttribute("data-font", "mono-numbers");
  } else {
    root.removeAttribute("data-font");
  }

  // Line height / letter spacing via CSS variables.
  if (prefs.lineHeight != null) {
    root.style.setProperty("--a11y-line-height", String(prefs.lineHeight / 100));
  } else {
    root.style.removeProperty("--a11y-line-height");
  }
  if (prefs.letterSpacing != null) {
    root.style.setProperty("--a11y-letter-spacing", `${prefs.letterSpacing / 1000}em`);
  } else {
    root.style.removeProperty("--a11y-letter-spacing");
  }

  // Focus ring.
  if (prefs.focusRingStyle === "ENHANCED") {
    root.setAttribute("data-focus-ring", "enhanced");
  } else {
    root.removeAttribute("data-focus-ring");
  }

  // Boolean toggles.
  setBoolAttr(root, "data-touch", prefs.largerTouchTargets, "large");
  setBoolAttr(root, "data-underline-links", prefs.underlineLinks, "1");
  setBoolAttr(root, "data-tabular-nums", prefs.tabularNumbers, "1");
}

function setBoolAttr(
  root: HTMLElement,
  name: string,
  on: boolean,
  value: string
): void {
  if (on) root.setAttribute(name, value);
  else root.removeAttribute(name);
}

/** Reads localStorage (browser only) - null when absent/invalid. */
export function readStoredA11y(): A11yPreferences | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(A11Y_STORAGE_KEY);
    if (!raw) return null;
    return normalizeA11yPreferences(JSON.parse(raw) as Partial<A11yPreferences>);
  } catch {
    return null;
  }
}

/** Persists to localStorage (browser only, never throws). */
export function persistA11y(prefs: A11yPreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(A11Y_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore — preferences still apply in-memory for this session.
  }
}
