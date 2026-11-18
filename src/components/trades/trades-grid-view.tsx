"use client";

/**
 * Trades grid view — card grid over the SAME filtered trade list as the
 * table (same query, same rows, same filters, same pagination). Toggle
 * Table/Grid is persisted in localStorage (see @/lib/trades/grid-stats).
 *
 * Honest limits, by design:
 * - No grade badge: Promethe stores no letter grade on a trade
 *   (TradeReview holds 1-5 scores, not exposed on the list DTO), so no
 *   grade is shown rather than an invented one. A reviewed trade shows a
 *   small review check instead.
 * - Mini chart: real candles from /api/v1/charts/candles for the trade's
 *   instrument and timeframe, drawn as a dependency-free inline SVG.
 *   Candles only exist when the user imported them, so most cards show
 *   the "No screenshot" placeholder, exactly like the reference.
 * - Header stats are computed over the WHOLE filtered set (all pages),
 *   not just the visible page, via the existing list endpoint.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Image as ImageIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Money, Sensitive } from "@/components/privacy/money";
import { ResultBadge, useTradingLabels } from "@/components/trades/trade-bits";
import { apiFetch } from "@/lib/api-client";
import { fmtDateInTz, fmtSigned, pnlClass } from "@/lib/format";
import { navigate } from "@/lib/router";
import type { PaginatedDTO, TradeListItemDTO } from "@/lib/trading/dto";
import type { TradeListQuery } from "@/lib/validations/trade";
import type { CandleDTO } from "@/lib/validations/charts";
import {
  candleWindowForTrade,
  computeGridStats,
  layoutCandles,
  type GridStats,
} from "@/lib/trades/grid-stats";
import { cn } from "@/lib/utils";

interface CandleWindowPayload {
  candles: CandleDTO[];
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
 * Stats over the whole filtered set. Journals are small (tens to low
 * hundreds of trades); the loop is capped at 100 pages (10,000 trades).
 */
function useFilteredGridStats(query: TradeListQuery) {
  const key = React.useMemo(() => {
    const { page, ...rest } = query;
    void page;
    return JSON.stringify(rest);
  }, [query]);
  return useQuery<GridStats>({
    queryKey: ["trades-grid-stats", key],
    queryFn: async () => {
      const first = await apiFetch<PaginatedDTO<TradeListItemDTO>>(
        `/api/v1/trades?${listParams(query, 1, 100).toString()}`
      );
      let all = [...first.data];
      const pages = Math.min(first.totalPages, 100);
      for (let p = 2; p <= pages; p += 1) {
        const next = await apiFetch<PaginatedDTO<TradeListItemDTO>>(
          `/api/v1/trades?${listParams(query, p, 100).toString()}`
        );
        all = all.concat(next.data);
      }
      return computeGridStats(all);
    },
    staleTime: 60 * 1000,
  });
}

/** Tiny inline-SVG candlestick chart, or the honest empty placeholder. */
function MiniCandleChart({ trade }: { trade: TradeListItemDTO }) {
  const t = useTranslations("tradesGrid");
  const window = React.useMemo(
    () =>
      candleWindowForTrade(trade.entryTime, trade.exitTime, trade.timeframe),
    [trade.entryTime, trade.exitTime, trade.timeframe]
  );
  const candlesQuery = useQuery<CandleWindowPayload>({
    queryKey: [
      "trade-mini-candles",
      trade.instrumentId,
      window.timeframe,
      window.from,
      window.to,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        instrumentId: trade.instrumentId,
        timeframe: window.timeframe,
        from: window.from,
        to: window.to,
      });
      return apiFetch<CandleWindowPayload>(
        `/api/v1/charts/candles?${params.toString()}`
      );
    },
    staleTime: 5 * 60 * 1000,
  });

  const candles = candlesQuery.data?.candles ?? [];
  const laidOut = React.useMemo(
    () => layoutCandles(candles, 280, 104),
    [candles]
  );

  if (candlesQuery.isLoading) {
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
}: {
  trade: TradeListItemDTO;
  timezone: string;
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
      <MiniCandleChart trade={trade} />
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
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {trade.resultType ? (
              <ResultBadge result={trade.resultType} />
            ) : (
              <span className="text-xs text-muted-foreground">{t("open")}</span>
            )}
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
        {trades.map((trade) => (
          <TradeGridCard key={trade.id} trade={trade} timezone={timezone} />
        ))}
      </div>
    </div>
  );
}
