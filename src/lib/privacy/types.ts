/**
 * v2.5 Module 8 — Privacy mode types (client-safe, no imports).
 *
 * IMPORTANT — documented limit (README "Privacy & accessibility"):
 * privacy mode is a DISPLAY-ONLY convenience, NOT a security control. The
 * underlying data is still present in the page source and network responses.
 * To actually hide data from other people, use v3 share links (server-side
 * structural redaction) or the anonymized export.
 */

/** HIDE replaces sensitive values by a placeholder; BLUR blurs them via CSS. */
export type PrivacyMode = "OFF" | "HIDE" | "BLUR";

export const PRIVACY_MODES: readonly PrivacyMode[] = ["OFF", "HIDE", "BLUR"];

export function isPrivacyMode(v: unknown): v is PrivacyMode {
  return typeof v === "string" && (PRIVACY_MODES as readonly string[]).includes(v);
}

/**
 * Which value kinds are affected in HIDE/BLUR mode. R multiples, pips,
 * points, win rates and trade counts stay visible unless explicitly opted
 * out below — the "keep R & pips" contract of §3.1.
 */
export interface PrivacyScope {
  /** Net/gross P&L, commissions, swaps, fees, risk amounts, report values. */
  hideCurrencyAmounts: boolean;
  /** Lot sizes (optional per §3.1). */
  hideLots: boolean;
  /** Balances, equity, deposits/withdrawals, prop payouts and costs. */
  hideBalances: boolean;
  /** Account names/numbers. */
  hideAccountNames: boolean;
  /** Broker name / server / login. */
  hideBrokerInfo: boolean;
  /** Percentages (default false - win rate stays visible). */
  hidePercentages: boolean;
  /** R multiples & pips (default false). */
  hideRAndPips: boolean;
}

export const DEFAULT_PRIVACY_SCOPE: PrivacyScope = {
  hideCurrencyAmounts: true,
  hideLots: false,
  hideBalances: true,
  hideAccountNames: false,
  hideBrokerInfo: false,
  hidePercentages: false,
  hideRAndPips: false,
};

/** Auto-privacy triggers (§3.2). Screen-share detection is NOT promised. */
export interface PrivacyAutoEnable {
  /** Enable privacy when the window loses focus / the tab is hidden. */
  onWindowBlur: boolean;
  /** Enable privacy after N seconds without user activity (null = off). */
  onInactivitySeconds: number | null;
}

export const DEFAULT_PRIVACY_AUTO: PrivacyAutoEnable = {
  onWindowBlur: false,
  onInactivitySeconds: null,
};

/** The privacy slice of UserDisplayPreference (runtime shape). */
export interface PrivacyPreferences {
  mode: PrivacyMode;
  scope: PrivacyScope;
  auto: PrivacyAutoEnable;
  /** Normalized chord, e.g. "shift+h". */
  shortcut: string;
  /** Blur trade screenshots too (they may show balances). */
  blurScreenshots: boolean;
  /** Reveal blurred values on hover/focus (BLUR mode). */
  revealOnHover: boolean;
}

export const DEFAULT_PRIVACY_PREFERENCES: PrivacyPreferences = {
  mode: "OFF",
  scope: { ...DEFAULT_PRIVACY_SCOPE },
  auto: { ...DEFAULT_PRIVACY_AUTO },
  shortcut: "shift+h",
  blurScreenshots: false,
  revealOnHover: true,
};

/** Kinds a `<Sensitive>` wrapper can guard (§3.1). */
export type SensitiveKind =
  | "amount"
  | "balance"
  | "lots"
  | "account"
  | "broker"
  | "percent"
  | "r";

/** Maps a sensitive kind to the scope flag that controls it (pure). */
export function scopeFlagFor(kind: SensitiveKind): keyof PrivacyScope {
  switch (kind) {
    case "amount":
      return "hideCurrencyAmounts";
    case "balance":
      return "hideBalances";
    case "lots":
      return "hideLots";
    case "account":
      return "hideAccountNames";
    case "broker":
      return "hideBrokerInfo";
    case "percent":
      return "hidePercentages";
    case "r":
      return "hideRAndPips";
  }
}
