// @vitest-environment jsdom
/**
 * Render tests — trades "By day" view (MRT wave 2,
 * src/components/trades/trades-by-day-view.tsx).
 *
 * No network and no database here: the view only groups the trades it is
 * given, so the test asserts the day headers, counts and day P&L the user
 * actually sees.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n/i18n-provider";
import { TradesByDayView } from "@/components/trades/trades-by-day-view";
import type { TradeListItemDTO } from "@/lib/trading/dto";

afterEach(cleanup);

function trade(partial: Partial<TradeListItemDTO>): TradeListItemDTO {
  return {
    id: "trade-1",
    accountId: "acc-1",
    accountName: "Live Account",
    strategyId: null,
    strategyName: null,
    instrumentId: "ins-xauusd",
    symbol: "XAUUSD",
    digits: 2,
    direction: "LONG",
    orderType: "MARKET",
    status: "CLOSED",
    timeframe: "M15",
    session: "NEW_YORK",
    setupType: null,
    setupId: null,
    strategyVersion: null,
    entryTime: "2026-11-17T14:00:00.000Z",
    exitTime: "2026-11-17T16:00:00.000Z",
    entryPrice: "2345.00",
    exitPrice: "2351.80",
    stopLoss: null,
    takeProfit: null,
    lots: "0.5",
    riskPercent: null,
    pips: "68",
    netPnl: "100",
    pnlCurrency: "USD",
    rMultiple: "1",
    plannedRR: null,
    resultType: "WIN",
    exitReason: null,
    reviewStatus: "REVIEWED",
    isDraft: false,
    emotionBefore: null,
    followedPlan: null,
    createdAt: "2026-11-17T16:00:00.000Z",
    updatedAt: "2026-11-17T16:00:00.000Z",
    tags: [],
    customFields: null,
    currentPrice: null,
    ...partial,
  } as TradeListItemDTO;
}

function renderByDay(trades: TradeListItemDTO[]) {
  return render(
    <I18nProvider>
      <TradesByDayView trades={trades} timezone="UTC" />
    </I18nProvider>
  );
}

describe("TradesByDayView", () => {
  it("groups trades under one header per day, newest first", () => {
    renderByDay([
      trade({ id: "t1", entryTime: "2026-11-16T10:00:00.000Z", symbol: "EURUSD" }),
      trade({ id: "t2", entryTime: "2026-11-17T10:00:00.000Z", symbol: "XAUUSD" }),
      trade({ id: "t3", entryTime: "2026-11-17T15:00:00.000Z", symbol: "NQ" }),
    ]);
    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings.map((h) => h.textContent)).toEqual([
      expect.stringContaining("November 17"),
      expect.stringContaining("November 16"),
    ]);
    expect(screen.getByText("2 trades")).toBeTruthy();
    expect(screen.getByText("1 trade")).toBeTruthy();
    expect(screen.getByText(/EURUSD/)).toBeTruthy();
    expect(screen.getByText(/XAUUSD/)).toBeTruthy();
    expect(screen.getByText(/NQ/)).toBeTruthy();
  });

  it("shows the day P&L and the win/loss split of the listed trades", () => {
    renderByDay([
      trade({ id: "t1", netPnl: "120", resultType: "WIN" }),
      trade({ id: "t2", netPnl: "-40", resultType: "LOSS" }),
    ]);
    expect(screen.getByText("1 W, 1 L")).toBeTruthy();
    // Day P&L (80) and both trade P&Ls are shown (Money formats them).
    expect(screen.getByText(/80/)).toBeTruthy();
    expect(screen.getByText(/120/)).toBeTruthy();
    expect(screen.getByText(/40/)).toBeTruthy();
  });

  it("renders nothing for an empty list", () => {
    const { container } = renderByDay([]);
    expect(container.querySelector("section")).toBeNull();
  });
});
