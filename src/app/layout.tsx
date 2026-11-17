import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";
import { I18nProvider } from "@/i18n/i18n-provider";
import { DEFAULT_LOCALE, type AppLocale } from "@/i18n/config";
import { PRE_PAINT_SCRIPT } from "@/lib/a11y/pre-paint";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Promethe - Journal de trading & analytique",
  description:
    "Promethe, a multi-user trading journal for XAUUSD and Forex: pips, lots, contract sizes, strategy statistics and insights.",
  icons: {
    icon: "/favicon.ico",
    apple: "/icon-180.png",
  },
  keywords: [
    "trading journal",
    "XAUUSD",
    "forex",
    "analytics",
    "backtesting",
  ],
};

/** App locale - English only since the language switcher was removed. */
function getInitialLocale(): AppLocale {
  return DEFAULT_LOCALE;
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = getInitialLocale();

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* v2.5 Module 8 — pre-paint: apply stored a11y/privacy preferences
            before first paint (no flash, works logged out, per device). */}
        <script dangerouslySetInnerHTML={{ __html: PRE_PAINT_SCRIPT }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <I18nProvider initialLocale={locale}>
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem
            disableTransitionOnChange
          >
            {children}
            <Toaster />
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
