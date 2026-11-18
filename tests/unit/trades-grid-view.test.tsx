// @vitest-environment jsdom
/**
 * Render tests — trades grid view (src/components/trades/trades-grid-view.tsx).
 *
 * No network and no database here: the candle and stats queries hit the
 * relative API paths, which fail in jsdom, so the test asserts the honest
 * fallback the user actually sees when no chart data is available.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/i18n/i18n-provider";
import { TradesGridView } from "@/components/trades/trades-grid-view";
import type { TradeListItemDTO } from "@/lib/trading/dto";
import type { TradeListQuery } from "@/lib/validations/trade";

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
    entryTime: "2026-07-30T14:00:00.000Z",
    exitTime: "2026-07-30T16:00:00.000Z",
    entryPrice: "2345.00",
    exitPrice: "2351.80",
    stopLoss: null,
    takeProfit: null,
    lots: "0.5",
    riskPercent: null,
    pips: "68",
    netPnl: "341",
    pnlCurrency: "USD",
    rMultiple: "1.8",
    plannedRR: null,
    resultType: "WIN",
    exitReason: null,
    reviewStatus: "REVIEWED",
    isDraft: false,
    emotionBefore: null,
    followedPlan: null,
    createdAt: "2026-07-30T16:00:00.000Z",
    updatedAt: "2026-07-30T16:00:00.000Z",
    tags: [],
    customFields: null,
    currentPrice: null,
    ...partial,
  } as TradeListItemDTO;
}

const QUERY = {
  page: 1,
  pageSize: 25,
  sort: "entryTime",
  order: "desc",
  includeDrafts: false,
} as TradeListQuery;

function renderGrid(trades: TradeListItemDTO[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <TradesGridView trades={trades} query={QUERY} timezone="UTC" />
      </I18nProvider>
    </QueryClientProvider>
  );
}

describe("TradesGridView", () => {
  it("renders a card per trade with symbol, direction, P&L and account", async () => {
    renderGrid([
      trade({}),
      trade({
        id: "trade-2",
        symbol: "NQ",
        direction: "SHORT",
        resultType: "LOSS",
        netPnl: "-118",
        reviewStatus: "NOT_REVIEWED",
        rMultiple: "-1",
      }),
    ]);
    expect(screen.getByText(/XAUUSD/)).toBeTruthy();
    expect(screen.getByText(/NQ/)).toBeTruthy();
    expect(screen.getByText(/Buy/)).toBeTruthy();
    expect(screen.getByText(/Sell/)).toBeTruthy();
    expect(screen.getByText(/341/)).toBeTruthy();
    expect(screen.getByText(/118/)).toBeTruthy();
    expect(screen.getAllByText(/Live Account/).length).toBe(2);
    expect(screen.getByText("Win")).toBeTruthy();
    expect(screen.getByText("Loss")).toBeTruthy();
  });

  it("shows the No screenshot placeholder when no candles are available", async () => {
    renderGrid([trade({})]);
    expect(
      await screen.findByText("No screenshot", {}, { timeout: 5000 })
    ).toBeTruthy();
  });

  it("shows an open trade without a result badge", () => {
    renderGrid([
      trade({ id: "trade-3", status: "OPEN", resultType: null, exitTime: null }),
    ]);
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.queryByText("Win")).toBeNull();
  });
});
