/**
 * i18n configuration — client-safe constants shared by server and browser.
 * English-only UI (Phase 3): a single locale, "en". There is no language
 * switcher, no FR catalog, and no ?lang= parameter anywhere.
 */

export const LOCALES = ["en"] as const;
export type AppLocale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "en";

/** Intl locale used by date/number formatting. */
export function intlLocale(_locale: AppLocale): string {
  return "en-CA";
}

export function isAppLocale(
  value: string | null | undefined
): value is AppLocale {
  return value === "en";
}
