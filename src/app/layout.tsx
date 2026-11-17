import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { PwaRegister } from "@/components/app/pwa-register";
import { ThemeProvider } from "@/components/theme-provider";
import { I18nProvider } from "@/i18n/i18n-provider";
import { DEFAULT_LOCALE } from "@/i18n/config";
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
  title: "Promethe – Trading journal & analytics",
  description:
    "Promethe, a multi-user trading journal for XAUUSD and Forex: pips, lots, contract sizes, strategy statistics and insights.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.ico",
    apple: "/icon-180.png",
  },
  appleWebApp: {
    capable: true,
    title: "Promethe",
    statusBarStyle: "black-translucent",
  },
  keywords: [
    "trading journal",
    "XAUUSD",
    "forex",
    "analytics",
    "backtesting",
  ],
};

export const viewport: Viewport = {
  themeColor: "#10b981",
};

/** App locale - English only (Phase 3, no language switcher). */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = DEFAULT_LOCALE;

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
        <I18nProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem
            disableTransitionOnChange
          >
            <PwaRegister />
            {children}
            <Toaster />
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
