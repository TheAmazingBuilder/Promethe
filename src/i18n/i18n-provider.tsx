"use client";

/**
 * i18n provider — next-intl without locale routing (single-route SPA).
 *
 * - The server layout reads the tj_locale cookie and passes the initial
 *   locale down (no flash, correct <html lang> on first paint).
 * - Switching is instant (both catalogs are bundled client-side) and
 *   persisted to the cookie + the user's Profile.locale (best-effort when
 *   unauthenticated — the signup form then stores the chosen locale).
 */
import * as React from "react";
import { NextIntlClientProvider } from "next-intl";
import { MESSAGES } from "./dictionaries";
import {
  DEFAULT_LOCALE,
  isAppLocale,
  intlLocale,
  type AppLocale,
} from "./config";
import { setFormatLocale } from "@/lib/format";

interface I18nContextValue {
  locale: AppLocale;
  /** Instantly switches the UI language and persists it. */
  setLocale: (locale: AppLocale) => void;
}

const I18nContext = React.createContext<I18nContextValue | null>(null);

const LOCALE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // 1 year

export function I18nProvider({
  initialLocale,
  children,
}: {
  initialLocale: AppLocale;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = React.useState<AppLocale>(
    isAppLocale(initialLocale) ? initialLocale : DEFAULT_LOCALE
  );

  React.useEffect(() => {
    // Keep the shared formatters in sync (numbers, prices, money).
    setFormatLocale(intlLocale(locale));
  }, [locale]);

  const setLocale = React.useCallback((next: AppLocale) => {
    setLocaleState(next);
    document.cookie = `tj_locale=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
    document.documentElement.lang = next;
    // Persist on the profile when a session exists (401 is expected otherwise).
    void fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: next }),
    }).catch(() => undefined);
  }, []);

  const value = React.useMemo(() => ({ locale, setLocale }), [locale, setLocale]);

  return (
    <NextIntlClientProvider
      locale={locale}
      messages={MESSAGES[locale]}
      timeZone="UTC"
    >
      <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
    </NextIntlClientProvider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = React.useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used inside <I18nProvider>");
  }
  return ctx;
}
