/**
 * v2.5 Module 8 — Privacy display policy (pure, client & server safe).
 *
 * One place decides how a sensitive value behaves under HIDE / BLUR:
 *  - HIDE → the value is replaced by a width-stable placeholder and NEVER
 *    reaches the DOM (the formatters return the placeholder themselves, so
 *    page text, attributes, chart SVG text and titles cannot leak it);
 *  - BLUR → the value renders normally but the `.sensitive` CSS class blurs
 *    it (the real text IS in the DOM — documented limit, §3.2).
 */
import { scopeFlagFor, type PrivacyPreferences, type SensitiveKind } from "./types";

/** Width-stable placeholder (always the same 4 bullets - §3.1). */
export const PRIVACY_PLACEHOLDER = "••••";

/** True when `kind` must be masked in HIDE mode / blurred in BLUR mode. */
export function isSensitiveKindHidden(
  prefs: PrivacyPreferences,
  kind: SensitiveKind
): boolean {
  if (prefs.mode !== "HIDE" && prefs.mode !== "BLUR") return false;
  return prefs.scope[scopeFlagFor(kind)] === true;
}

/** True when values of `kind` must carry the `.sensitive` blur class. */
export function isSensitiveKindBlurred(
  prefs: PrivacyPreferences,
  kind: SensitiveKind
): boolean {
  return prefs.mode === "BLUR" && isSensitiveKindHidden(prefs, kind);
}

/**
 * The effective display string for `kind` in HIDE mode: the placeholder when
 * hidden, `real` otherwise. Used by the formatters in src/lib/format.ts.
 */
export function privacyMask(
  prefs: PrivacyPreferences,
  kind: SensitiveKind,
  real: string
): string {
  if (prefs.mode === "HIDE" && isSensitiveKindHidden(prefs, kind)) {
    return PRIVACY_PLACEHOLDER;
  }
  return real;
}

/**
 * Server-side notification redaction policy (§3.1): when
 * hideAmountsInNotifications is on, bodies are composed with R multiples /
 * pips only. This helper strips money-looking fragments from an already
 * composed body as a defense-in-depth (the composers avoid amounts in the
 * first place). Amount-shaped tokens: "1 234,56 USD", "+$120", "−45,50 EUR".
 */
export function redactAmountsInText(text: string): string {
  return text
    .replace(
      /[+\-−]?[$€£¥]?\s?\d{1,3}(?:[ \u00a0\u202f.,]\d{3})*(?:[.,]\d{1,4})?\s?(?:USD|EUR|GBP|JPY|CAD|AUD|CHF|NZD)?\b/g,
      (match) => {
        // Only mask matches that look like an amount (digits + currency
        // code/symbol). Plain counts ("3 trades") stay readable, untouched.
        if (!/\d/.test(match)) return match;
        const trimmed = match.trim();
        const hasCurrency =
          /(?:USD|EUR|GBP|JPY|CAD|AUD|CHF|NZD)$/.test(trimmed) ||
          /[$€£¥]/.test(trimmed);
        return hasCurrency ? PRIVACY_PLACEHOLDER : match;
      }
    )
    .replace(/ {2,}/g, " ")
    .trim();
}
