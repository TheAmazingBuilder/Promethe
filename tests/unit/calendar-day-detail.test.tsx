// @vitest-environment jsdom
/**
 * Render tests — calendar day-detail panel (MRT wave 2,
 * src/components/calendar/calendar-day-detail.tsx).
 *
 * Presentational component: data arrives via props, so no network and no
 * database here. Asserts the day totals, the trade rows, the journal
 * bias/lesson and the honest empty states.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n/i18n-provider";
import { CalendarDayDetail } from "@/components/calendar/calendar-day-detail";
import type {
  CalendarDayPayload,
  JournalEntryDTO,
  TradeListItemDTO,
} from "@/lib/trading/dto";

afterEach(cleanup);

function trade(partial: Partial<TradeListItemDTO>): TradeListItemDTO {
  return {
    id: "trade-1",
    accountId: "acc-1",
    accountName: "Live Account",
    strategyId: null,
    strategyName: "London Sweep",
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
    riskPercent: "1",
    pips: "68",
    netPnl: "120",
    pnlCurrency: "USD",
    rMultiple: "1.5",
    plannedRR: "2",
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

function day(
  partial: Partial<CalendarDayPayload> = {}
): CalendarDayPayload {
  return {
    date: "2026-11-17",
    accountId: null,
    currency: "USD",
    timezone: "UTC",
    trades: [trade({})],
    netPnl: "120",
    tradeCount: 1,
    wins: 1,
    losses: 0,
    totalR: "1.5",
    ...partial,
  };
}

function journal(partial: Partial<JournalEntryDTO> = {}): JournalEntryDTO {
  return {
    id: "j-1",
    date: "2026-11-17",
    preMarketPlan: null,
    postMarketReview: null,
    mood: null,
    sleepQuality: null,
    disciplineScore: 8,
    keyLesson: "Wait for the sweep.",
    marketBias: "Bullish above 2340",
    updatedAt: "2026-11-17T18:00:00.000Z",
    ...partial,
  };
}

function renderPanel(props: {
  day?: CalendarDayPayload | null;
  journal?: JournalEntryDTO | null;
  isLoading?: boolean;
  journalLoading?: boolean;
  isError?: boolean;
}) {
  return render(
    <I18nProvider>
      <CalendarDayDetail
        date="2026-11-17"
        // Explicit null must stay null (no journal / no day), so the
        // defaults apply only when the prop is omitted entirely.
        day={"day" in props ? (props.day ?? null) : day()}
        journal={"journal" in props ? (props.journal ?? null) : journal()}
        isLoading={props.isLoading ?? false}
        journalLoading={props.journalLoading ?? false}
        isError={props.isError ?? false}
        onRetry={vi.fn()}
        onClose={vi.fn()}
        timezone="UTC"
      />
    </I18nProvider>
  );
}

describe("CalendarDayDetail", () => {
  it("shows the day totals, the trade rows and the journal bias and lesson", () => {
    renderPanel({});
    expect(screen.getByText(/November 17/)).toBeTruthy();
    expect(screen.getByText("1 trade closed")).toBeTruthy();
    // Day total and trade P&L both show 120.
    expect(screen.getAllByText(/120/).length).toBe(2);
    expect(screen.getByText(/XAUUSD/)).toBeTruthy();
    expect(screen.getByText(/London Sweep/)).toBeTruthy();
    expect(screen.getByText(/Bullish above 2340/)).toBeTruthy();
    expect(screen.getByText(/Wait for the sweep/)).toBeTruthy();
    expect(screen.getByText(/Discipline/)).toBeTruthy();
    expect(screen.getByText(/8\/10/)).toBeTruthy();
  });

  it("shows an honest empty state on a day without trades, with no fake zeros", () => {
    renderPanel({
      day: day({ trades: [], netPnl: "0", tradeCount: 0, wins: 0, losses: 0, totalR: null }),
      journal: null,
    });
    expect(screen.getByText("No trades closed on this day")).toBeTruthy();
    expect(screen.getByText("No journal entry for this day yet.")).toBeTruthy();
    expect(screen.queryByText("Net P&L")).toBeNull();
  });

  it("shows the error state with a retry button", () => {
    renderPanel({ day: null, journal: null, isError: true });
    expect(screen.getByText("Could not load this day.")).toBeTruthy();
    expect(screen.getByText("Retry")).toBeTruthy();
  });

  it("shows a loading state while the day loads", () => {
    const { container } = renderPanel({ isLoading: true });
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    expect(screen.getByText("Loading the day...")).toBeTruthy();
  });
});
