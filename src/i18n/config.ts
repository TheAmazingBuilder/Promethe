/**
 * i18n configuration — client-safe constants shared by server and browser.
 * English-only UI (language switcher removed); the FR catalog is kept for
 * public share links that explicitly request ?lang=fr.
 */

export const LOCALES = ["en", "fr"] as const;
export type AppLocale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "en";

/** Cookie holding the UI locale (read by the server layout on first paint). */
export const LOCALE_COOKIE = "tj_locale";

export function isAppLocale(
  value: string | null | undefined
): value is AppLocale {
  return value === "fr" || value === "en";
}

/**
 * Intl locale used by date/number formatting (fr-CA matches the primary
 * user's timezone America/Toronto; en-CA keeps identical grouping).
 */
export function intlLocale(locale: AppLocale): string {
  return locale === "fr" ? "fr-CA" : "en-CA";
}
