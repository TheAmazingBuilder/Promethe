"use client";

/**
 * Trades grid view — card grid over the SAME filtered trade list as the
 * table (same query, same rows, same filters, same pagination). Toggle
 * Table/Grid is persisted in localStorage (see @/lib/trades/grid-stats).
 *
 * Honest limits, by design:
 * - Grade badge: the trade's MRT setup grade (A+ / A / B / C), or
 *   "Ungraded" when no grade was given — never an invented grade.
 *   A reviewed trade shows a small review check instead.
 * - Mini chart: real candles for the trade's instrument and timeframe,
 *   drawn as a dependency-free inline SVG — one batched POST
 *   /api/v1/charts/candles/batch for the whole page, not one GET per
 *   card. Candles only exist when the user imported them, so most cards
 *   show the "No screenshot" placeholder, exactly like the reference.
 * - Header stats are computed over the WHOLE filtered set (all pages),
 *   not just the visible page, via the aggregated /api/v1/trades/stats
 *   endpoint (SQL aggregates, no page loop).
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Image as ImageIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Money, Sensitive } from "@/components/privacy/money";
import {
  ResultBadge,
  GradeBadge,
  TagsBadges,
  useTradingLabels,
} from "@/components/trades/trade-bits";
import { confluenceTagsOf } from "@/lib/trading/confluences";
import { apiFetch } from "@/lib/api-client";
import { fmtDateInTz, fmtSigned, pnlClass } from "@/lib/format";
import { navigate } from "@/lib/router";
import type { TradeListItemDTO } from "@/lib/trading/dto";
import type { TradeListQuery } from "@/lib/validations/trade";
import type { CandleDTO } from "@/lib/validations/charts";
import {
  candleWindowForTrade,
  layoutCandles,
  type GridStats,
} from "@/lib/trades/grid-stats";
import { cn } from "@/lib/utils";

/** One batched candle response: results aligned by index with the request. */
interface CandleBatchPayload {
  results: Array<{ candles: CandleDTO[] }>;
}

/** Same query params as useTradesList, minus pagination. */
function listParams(query: TradeListQuery, page: number, pageSize: number) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  params.set("sort", query.sort);
  params.set("order", query.order);
  params.set("includeDrafts", String(query.includeDrafts));
  for (const [key, value] of Object.entries(query)) {
    if (["page", "pageSize", "sort", "order", "includeDrafts"].includes(key)) {
      continue;
    }
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  return params;
}

/**
 * Stats over the whole filtered set — one aggregated call (Phase 2 perf,
 * item 7), not a sequential loop over the list endpoint's pages.
 */
function useFilteredGridStats(query: TradeListQuery) {
  const key = React.useMemo(() => {
    const { page, ...rest } = query;
    void page;
    return JSON.stringify(rest);
  }, [query]);
  return useQuery<GridStats>({
    queryKey: ["trades-grid-stats", key],
    queryFn: async () =>
      apiFetch<GridStats>(
        `/api/v1/trades/stats?${listParams(query, 1, 100).toString()}`
      ),
    staleTime: 60 * 1000,
  });
}

/**
 * Mini-chart candles for the whole visible page in ONE batched POST
 * (Phase 2 perf, item 7) — one request per (instrument, timeframe)
 * group on the server, sliced per card, instead of one GET per card.
 */
function useBatchMiniCandles(trades: TradeListItemDTO[]) {
  const windows = React.useMemo(
    () =>
      trades.map((t) => ({
        instrumentId: t.instrumentId,
        ...candleWindowForTrade(t.entryTime, t.exitTime, t.timeframe),
      })),
    [trades]
  );
  const key = React.useMemo(() => JSON.stringify(windows), [windows]);
  return useQuery<CandleBatchPayload>({
    queryKey: ["trade-mini-candles-batch", key],
    queryFn: async () =>
      apiFetch<CandleBatchPayload>("/api/v1/charts/candles/batch", {
        method: "POST",
        body: JSON.stringify({ requests: windows }),
      }),
    staleTime: 5 * 60 * 1000,
    enabled: trades.length > 0,
  });
}

/** Tiny inline-SVG candlestick chart, or the honest empty placeholder. */
function MiniCandleChart({
  trade,
  candles,
  isLoading,
}: {
  trade: TradeListItemDTO;
  candles: CandleDTO[];
  isLoading: boolean;
}) {
  const t = useTranslations("tradesGrid");
  const laidOut = React.useMemo(
    () => layoutCandles(candles, 280, 104),
    [candles]
  );

  if (isLoading) {
    return (
      <div
        className="h-28 animate-pulse rounded-t-lg bg-muted/60"
        aria-hidden="true"
      />
    );
  }

  if (!laidOut) {
    return (
      <div className="flex h-28 flex-col items-center justify-center gap-2 rounded-t-lg bg-muted/40 text-muted-foreground">
        <ImageIcon className="h-5 w-5" aria-hidden="true" />
        <span className="text-xs">{t("noScreenshot")}</span>
      </div>
    );
  }

  return (
    <svg
      viewBox="0 0 280 104"
      preserveAspectRatio="none"
      className="h-28 w-full rounded-t-lg bg-muted/20"
      role="img"
      aria-label={t("miniChartLabel", { symbol: trade.symbol })}
    >
      {laidOut.map((c, i) => (
        <g key={i}>
          <line
            x1={c.cx}
            x2={c.cx}
            y1={c.yHigh}
            y2={c.yLow}
            stroke={c.up ? "#10B981" : "#F87171"}
            strokeWidth={1}
          />
          <rect
            x={c.x}
            y={Math.min(c.yOpen, c.yClose)}
            width={c.w}
            height={Math.max(1, Math.abs(c.yClose - c.yOpen))}
            fill={c.up ? "#10B981" : "#F87171"}
          />
        </g>
      ))}
    </svg>
  );
}

function TradeGridCard({
  trade,
  timezone,
  candles,
  candlesLoading,
}: {
  trade: TradeListItemDTO;
  timezone: string;
  candles: CandleDTO[];
  candlesLoading: boolean;
}) {
  const t = useTranslations("tradesGrid");
  const labels = useTradingLabels();
  const open = React.useCallback(() => navigate(`/trades/${trade.id}`), [trade.id]);
  const directionLabel = trade.direction === "LONG" ? t("buy") : t("sell");
  const sessionLabel = trade.session ? labels.session(trade.session) : null;

  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={t("openTrade", {
        symbol: trade.symbol,
        direction: directionLabel,
      })}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      className="group cursor-pointer overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-500/50 hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring"
    >
      <MiniCandleChart
        trade={trade}
        candles={candles}
        isLoading={candlesLoading}
      />
      <div className="space-y-2 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-semibold">
            {trade.symbol} <span className="font-normal text-muted-foreground">- {directionLabel}</span>
          </p>
          <Money
            signed
            value={trade.netPnl}
            currency={trade.pnlCurrency}
            className={cn("shrink-0 text-sm font-semibold tabular-nums", pnlClass(trade.netPnl))}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {fmtDateInTz(trade.entryTime, timezone)}
          {sessionLabel ? ` · ${sessionLabel}` : ""}
        </p>
        {/* Confluences (MRT wave 1) — badges only when the trade has any;
            TagsBadges renders nothing for an empty list. */}
        <TagsBadges tags={confluenceTagsOf(trade.tags)} max={3} />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {trade.resultType ? (
              <ResultBadge result={trade.resultType} />
            ) : (
              <span className="text-xs text-muted-foreground">{t("open")}</span>
            )}
            <GradeBadge grade={trade.grade} />
            {trade.rMultiple !== null && trade.rMultiple !== undefined && (
              <span className="rounded-md border bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                {fmtSigned(trade.rMultiple, 2, 2)} R
              </span>
            )}
            {trade.reviewStatus === "REVIEWED" && (
              <span title={labels.reviewStatus(trade.reviewStatus)}>
                <CheckCircle2
                  className="h-4 w-4 text-gain"
                  aria-hidden="true"
                />
                <span className="sr-only">
                  {labels.reviewStatus(trade.reviewStatus)}
                </span>
              </span>
            )}
          </div>
          <span className="truncate text-xs text-muted-foreground">
            <Sensitive kind="account">{trade.accountName}</Sensitive>
          </span>
        </div>
      </div>
    </article>
  );
}

export function TradesGridView({
  trades,
  query,
  timezone,
}: {
  trades: TradeListItemDTO[];
  query: TradeListQuery;
  timezone: string;
}) {
  const t = useTranslations("tradesGrid");
  const statsQuery = useFilteredGridStats(query);
  const stats = statsQuery.data;
  const candlesQuery = useBatchMiniCandles(trades);

  return (
    <div className="space-y-4">
      {/* ── Header stats (whole filtered set, real data only) ── */}
      <Card className="gap-0 py-3">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2 px-4">
          <div>
            <p className="text-2xl font-bold leading-none tabular-nums">
              {stats ? stats.count : "-"}
            </p>
            <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
              {t("trades")}
            </p>
          </div>
          <div>
            <p className="text-2xl font-bold leading-none tabular-nums text-gain">
              {stats ? (stats.winRate === null ? "-" : `${stats.winRate}%`) : "-"}
            </p>
            <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
              {t("winRate")}
            </p>
          </div>
          <div>
            <p
              className={cn(
                "text-2xl font-bold leading-none tabular-nums",
                stats ? pnlClass(stats.netPnl) : ""
              )}
            >
              {stats ? (
                <Money signed value={stats.netPnl} currency={stats.currency} />
              ) : (
                "-"
              )}
            </p>
            <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
              {t("netPnl")}
            </p>
          </div>
        </div>
      </Card>

      {/* ── Cards ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {trades.map((trade, i) => (
          <TradeGridCard
            key={trade.id}
            trade={trade}
            timezone={timezone}
            candles={candlesQuery.data?.results[i]?.candles ?? []}
            candlesLoading={candlesQuery.isLoading}
          />
        ))}
      </div>
    </div>
  );
}
