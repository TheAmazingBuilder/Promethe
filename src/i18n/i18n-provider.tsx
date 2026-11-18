"use client";

/**
 * i18n provider — next-intl without locale routing (single-route SPA).
 *
 * English only (Phase 3): the locale is always "en". There is no language
 * switcher, no locale cookie, and no profile persistence for language.
 * The server layout renders <html lang="en"> on first paint.
 */
import * as React from "react";
import { NextIntlClientProvider } from "next-intl";
import { MESSAGES } from "./dictionaries";
import { DEFAULT_LOCALE, intlLocale } from "./config";
import { setFormatLocale } from "@/lib/format";

interface I18nContextValue {
  locale: typeof DEFAULT_LOCALE;
}

const I18nContext = React.createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const locale = DEFAULT_LOCALE;

  React.useEffect(() => {
    // Keep the shared formatters in sync (numbers, prices, money).
    setFormatLocale(intlLocale(locale));
  }, [locale]);

  const value = React.useMemo(() => ({ locale }), [locale]);

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
