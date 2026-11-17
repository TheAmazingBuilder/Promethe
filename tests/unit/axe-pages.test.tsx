// @vitest-environment jsdom
/**
 * v2.5 Module 8 — automated axe checks (§3.3).
 *
 * axe-core runs against the rendered DOM of the views this module touches
 * or ships: the multi-zone clock (header), the time settings page, the
 * accessibility settings page, and the dashboard KPI strip.
 *
 * The harness mirrors tests/unit/privacy-dom-leak.test.tsx: components are
 * rendered inside <I18nProvider initialLocale="en">. Providers that fetch
 * the display preferences fall back to defaults here (no API in jsdom),
 * which is exactly the pre-load state the app renders in production.
 *
 * `document.documentElement.lang` is set explicitly: the real app sets it
 * in the root layout; jsdom starts without one.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import axe from "axe-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/i18n/i18n-provider";
import { SessionProvider } from "@/components/app/session-context";
import { A11yProvider } from "@/components/a11y/a11y-provider";
import { TimeProvider } from "@/components/time/time-provider";
import { MultiZoneClock } from "@/components/time/multi-zone-clock";
import { TimeView } from "@/components/settings-views/time-view";
import { AccessibilityView } from "@/components/settings-views/accessibility-view";
import { KpiStripWidget } from "@/components/dashboard/widgets/kpi-strip-widget";
import { computeTradeStats, type StatTrade } from "@/lib/analytics/engine";
import {
  computeAdvancedStats,
  type AnalyticsTrade,
} from "@/lib/analytics/insights";
import type { SessionPayload } from "@/lib/auth/types";

// jsdom has no window.matchMedia: stub it (A11yProvider reads the
// prefers-reduced-motion media query on mount).
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// jsdom has no ResizeObserver (Radix Slider uses it).
if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const SESSION: SessionPayload = {
  user: { id: "user-1", email: "test@example.com" },
  profile: {
    displayName: "Test",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
    theme: "dark",
    defaultAccountId: null,
    preferences: {},
    handle: null,
    publicDisplayName: null,
  },
};

function TestShell({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider initialSession={SESSION}>
        <I18nProvider>
          <A11yProvider>
            <TimeProvider>{children}</TimeProvider>
          </A11yProvider>
        </I18nProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  document.documentElement.lang = "en";
});

afterEach(() => {
  cleanup();
});

async function expectNoViolations(container: HTMLElement, label: string) {
  const results = await axe.run(container, {
    // colour-contrast cannot be measured in jsdom (no layout): axe reports
    // it as "incomplete", never as a violation, so the default rule set is
    // used as-is. Real contrast is covered by the math tests
    // (tests/unit/a11y-contrast.test.ts).
    resultTypes: ["violations"],
  });
  if (results.violations.length > 0) {
    const summary = results.violations
      .map(
        (v) =>
          `${v.id} (${v.impact ?? "?"}): ${v.help} — ${v.nodes
            .map((n) => n.html)
            .join(" | ")}`
      )
      .join("\n");
    throw new Error(`${label} — axe violations:\n${summary}`);
  }
  expect(results.violations).toHaveLength(0);
}

describe("axe — multi-zone clock", () => {
  it("compact header clock has no violations", async () => {
    const { container } = render(
      <TestShell>
        <MultiZoneClock variant="compact" />
      </TestShell>
    );
    await expectNoViolations(container, "MultiZoneClock compact");
  });

  it("full clock list has no violations", async () => {
    const { container } = render(
      <TestShell>
        <MultiZoneClock variant="full" />
      </TestShell>
    );
    await expectNoViolations(container, "MultiZoneClock full");
  });
});

describe("axe — settings pages", () => {
  it("time settings page has no violations", async () => {
    const { container } = render(
      <TestShell>
        <TimeView />
      </TestShell>
    );
    await expectNoViolations(container, "TimeView");
  });

  it("accessibility settings page has no violations", async () => {
    const { container } = render(
      <TestShell>
        <AccessibilityView />
      </TestShell>
    );
    await expectNoViolations(container, "AccessibilityView");
  });
});

describe("axe — dashboard KPI strip", () => {
  it("KPI strip with real stats has no violations", async () => {
    const trades: StatTrade[] = [
      {
        id: "1",
        entryTime: "2024-03-13T15:00:00.000Z",
        exitTime: "2024-03-13T17:00:00.000Z",
        netPnl: "120",
        rMultiple: "1.5",
        resultType: "WIN",
        strategyId: null,
        instrumentId: "xauusd",
        symbol: "XAUUSD",
        direction: "LONG",
        session: null,
        lots: "0.1",
      },
      {
        id: "2",
        entryTime: "2024-03-14T15:00:00.000Z",
        exitTime: "2024-03-14T17:00:00.000Z",
        netPnl: "-50",
        rMultiple: "-0.8",
        resultType: "LOSS",
        strategyId: null,
        instrumentId: "xauusd",
        symbol: "XAUUSD",
        direction: "SHORT",
        session: null,
        lots: "0.1",
      },
    ];
    const stats = computeTradeStats(trades);
    const advanced = computeAdvancedStats(
      trades as unknown as AnalyticsTrade[],
      stats
    );
    const data = {
      stats,
      advanced,
      extras: {
        totalPips: null,
        avgRiskPercent: null,
        reviewedPercent: null,
        currentDrawdown: "0",
        bestTrade: null,
        worstTrade: null,
        tradingDays: 2,
      },
      compare: null,
      sparkline: ["120", "70"],
    };
    const { container } = render(
      <TestShell>
        <KpiStripWidget data={data} config={null} currency="USD" />
      </TestShell>
    );
    await expectNoViolations(container, "KpiStripWidget");
  });
});
