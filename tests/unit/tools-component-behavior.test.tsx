/**
 * @vitest-environment jsdom
 *
 * Lot 1 Phase D (MD §3.7) — component-level behavior for the currency
 * converter and the P&L simulator.
 *
 * The pure FX / preview logic was already covered (fx.test.ts,
 * tools-freshness-labels.test.ts); what was missing was the component
 * behavior itself: the converter's stale / undated warnings and swap,
 * and the simulator's net-vs-gross R rendering, its estimate banner,
 * and its scenario save / load at component level. Hooks are stubbed
 * (no network, no database); the components render for real.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n/i18n-provider";
import { CurrencyConverter } from "@/components/tools/currency-converter";
import { PnlSimulator } from "@/components/tools/pnl-simulator";
import type { FxRateEntry } from "@/lib/tools/types";
import type { ToolScenario } from "@/lib/tools/types";

const stubs = vi.hoisted(() => ({
  fxRates: [] as FxRateEntry[],
  scenarios: [] as ToolScenario[],
  createMutate: vi.fn(),
  deleteMutate: vi.fn(),
  upsertMutate: vi.fn(),
}));

vi.mock("@/hooks/use-tools", () => ({
  isToolsTablesMissing: () => false,
  useFxRates: () => ({ data: stubs.fxRates, error: null }),
  useUpsertFxRate: () => ({ mutate: stubs.upsertMutate }),
  useDeleteFxRate: () => ({ mutate: vi.fn() }),
  useImportFxRates: () => ({ mutate: vi.fn() }),
  useToolScenarios: () => ({ data: stubs.scenarios, error: null }),
  useCreateToolScenario: () => ({ mutate: stubs.createMutate }),
  useDeleteToolScenario: () => ({ mutate: stubs.deleteMutate }),
}));

afterEach(() => {
  cleanup();
  stubs.fxRates = [];
  stubs.scenarios = [];
  stubs.createMutate.mockClear();
  stubs.deleteMutate.mockClear();
  stubs.upsertMutate.mockClear();
});

function rate(
  partial: Partial<FxRateEntry> & { base: string; quote: string; rate: string }
): FxRateEntry {
  return {
    id: `${partial.base}${partial.quote}`,
    source: "MANUAL",
    date: new Date().toISOString().slice(0, 10),
    ...partial,
  };
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function renderConverter() {
  return render(
    <I18nProvider>
      <CurrencyConverter />
    </I18nProvider>
  );
}

function renderSimulator() {
  return render(
    <I18nProvider>
      <PnlSimulator />
    </I18nProvider>
  );
}

describe("CurrencyConverter component", () => {
  it("says no rate is available when the table is empty", () => {
    renderConverter();
    expect(
      screen.getByText("No rate available for this conversion.")
    ).toBeTruthy();
  });

  it("converts with a fresh stored rate and shows no warning", () => {
    stubs.fxRates = [rate({ base: "EUR", quote: "USD", rate: "1.08" })];
    renderConverter();
    // 100 EUR × 1.08 = 108 USD.
    expect(screen.getByText("108")).toBeTruthy();
    expect(screen.getByText(/1 EUR = 1.08 USD/)).toBeTruthy();
    expect(screen.queryByText(/older than 7 days/i)).toBeNull();
    expect(screen.queryByText(/carries no date/i)).toBeNull();
  });

  it("warns on a stale (30-day-old) rate but still converts", () => {
    stubs.fxRates = [
      rate({ base: "EUR", quote: "USD", rate: "1.08", date: daysAgo(30) }),
    ];
    renderConverter();
    expect(screen.getByText("108")).toBeTruthy();
    expect(screen.getByText(/older than 7 days/i)).toBeTruthy();
    // The date shows three times: the rate-date line, the stale
    // warning, and the saved-rate table row.
    expect(screen.getAllByText(new RegExp(daysAgo(30)))).toHaveLength(3);
  });

  it("warns that freshness cannot be checked for an undated rate", () => {
    stubs.fxRates = [
      rate({ base: "EUR", quote: "USD", rate: "1.08", date: "" }),
    ];
    renderConverter();
    expect(screen.getByText("108")).toBeTruthy();
    expect(screen.getByText(/carries no date/i)).toBeTruthy();
    expect(screen.queryByText(/older than 7 days/i)).toBeNull();
  });

  it("swap inverts the conversion through the stored pair", () => {
    stubs.fxRates = [rate({ base: "EUR", quote: "USD", rate: "1.08" })];
    renderConverter();
    fireEvent.click(screen.getByRole("button", { name: "Swap currencies" }));
    // 100 USD ÷ 1.08 = 92.59 EUR.
    expect(screen.getByText("92.59")).toBeTruthy();
    expect(screen.getByText(/1 USD = 0.925926 EUR/)).toBeTruthy();
  });
});

describe("PnlSimulator component", () => {
  it("renders distinct net and gross R values for the default trade", () => {
    renderSimulator();
    // Default: XAUUSD LONG 0.50 @ 2345 -> 2351.80, SL 2340, costs 7.
    // Gross R = 6.80 / 5.00 = 1.36; net R = (340 - 7) / 250 = 1.33.
    expect(screen.getByText("R multiple (net)")).toBeTruthy();
    expect(screen.getByText("R multiple (gross)")).toBeTruthy();
    expect(screen.getByText("1.33 R")).toBeTruthy();
    expect(screen.getByText("1.36 R")).toBeTruthy();
    expect(screen.getByText("1 : 2.6")).toBeTruthy();
    // No FX conversion is needed (USD quote, USD account): no estimate note.
    expect(screen.queryByText(/shown as an estimate/i)).toBeNull();
  });

  it("shows the missing-FX banner (not the estimate note) when the account currency needs a missing rate", () => {
    renderSimulator();
    // Switch the account currency to EUR via the Radix select: with no
    // USD->EUR rate anywhere, conversionReady is false, so the
    // component shows the missing-FX banner. The preview.isEstimate
    // branch (quoteDiffersNote) is unreachable while that banner takes
    // precedence — see the source test below; engine-level isEstimate
    // is covered in tools-freshness-labels.test.ts.
    fireEvent.click(document.getElementById("sim-account-currency")!);
    fireEvent.click(screen.getByRole("option", { name: "EUR" }));
    expect(screen.getByText(/Add a valid FX rate/i)).toBeTruthy();
    expect(screen.queryByText(/shown as an estimate/i)).toBeNull();
  });

  it("keeps the isEstimate branch wired in source (quoteDiffersNote)", () => {
    // (jsdom: import.meta.url is not a file: URL here, so read the
    // source via a cwd-relative path like the other jsdom tests do
    // for fixtures.)
    const simulator = readFileSync(
      "src/components/tools/pnl-simulator.tsx",
      "utf8"
    );
    expect(simulator).toContain("preview.isEstimate");
    expect(simulator).toContain('t("quoteDiffersNote"');
  });

  it("saves a scenario with the full payload at component level", () => {
    renderSimulator();
    fireEvent.change(screen.getByLabelText("Scenario name"), {
      target: { value: "Gold scalp" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save scenario" }));
    expect(stubs.createMutate).toHaveBeenCalledTimes(1);
    expect(stubs.createMutate).toHaveBeenCalledWith({
      name: "Gold scalp",
      kind: "PNL_SIMULATOR",
      payload: {
        symbol: "XAUUSD",
        direction: "LONG",
        lots: "0.50",
        entry: "2345.00",
        exit: "2351.80",
        stopLoss: "2340.00",
        takeProfit: "2358.00",
        commission: "7",
        swap: "0",
        accountCurrency: "USD",
        manualRate: "",
      },
    });
  });

  it("does not save when the scenario name is empty", () => {
    renderSimulator();
    expect(
      screen.getByRole("button", { name: "Save scenario" })
    ).toHaveProperty("disabled", true);
    expect(stubs.createMutate).not.toHaveBeenCalled();
  });

  it("loads a saved scenario back into the inputs", () => {
    stubs.scenarios = [
      {
        id: "sc-1",
        name: "Saved scalp",
        kind: "PNL_SIMULATOR",
        createdAt: "2026-11-20T10:00:00.000Z",
        payload: {
          symbol: "XAUUSD",
          direction: "LONG",
          lots: "1.00",
          entry: "2400.00",
          exit: "2410.00",
          stopLoss: "2390.00",
          takeProfit: "2420.00",
          commission: "5",
          swap: "0",
          accountCurrency: "USD",
          manualRate: "",
        },
      },
    ];
    renderSimulator();
    expect(screen.getByDisplayValue("0.50")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Saved scalp" }));
    expect(screen.getByDisplayValue("1.00")).toBeTruthy();
    expect(screen.getByDisplayValue("2400.00")).toBeTruthy();
  });
});
