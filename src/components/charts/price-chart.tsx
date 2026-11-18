"use client";

/**
 * v2.5 Module 2 — per-trade price chart (spec §4.2).
 *
 * Candlestick chart on TradingView lightweight-charts (Apache-2.0 —
 * attribution link in the footer). Entry/exit/partial markers, price lines
 * (entry, initial/final SL/TP, moved-SL steps), news markers, timeframe
 * switcher (M1→D1) with client-side resampling from the finest stored
 * candles, crosshair OHLC legend, context padding before/after the trade,
 * coverage banner, CSV candle import dialog when no candles exist, inline
 * SVG fallback (entry/SL/TP ruler) without candles. Lazy-loaded bundle.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { FileUp, Loader2, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/components/app/session-context";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { apiErrorMessage } from "@/lib/i18n-errors";
import { fmtDateTimeInTz, fmtPrice } from "@/lib/format";
import {
  CANDLE_TIMEFRAMES,
  type CandleDTO,
  type CandleTimeframe,
} from "@/lib/validations/charts";
import {
  buildTradeOverlay,
  coverage,
  resample,
  OVERLAY_COLORS,
  type Candle,
} from "@/lib/charts/price";
import type { TradeDetailDTO } from "@/lib/trading/dto";

interface CandleWindowPayload {
  instrumentId: string;
  symbol: string;
  digits: number;
  timeframe: CandleTimeframe | null;
  storedTimeframes: CandleTimeframe[];
  from: string;
  to: string;
  candles: CandleDTO[];
}

const PADDING_OPTIONS = [10, 30, 100] as const;

/** Resolve a CSS token to a concrete rgba() color for lightweight-charts.
 *  The chart library only parses hex/rgb/rgba — computed oklch()/lab() values
 *  from modern browsers are normalized by PAINTING a pixel and reading the
 *  RGBA bytes back (fillStyle round-trip alone keeps the lab() serialization).
 */
function cssVar(name: string): string {
  if (typeof window === "undefined") return "rgba(136, 136, 136, 1)";
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return "rgba(136, 136, 136, 1)";
  if (/^#[0-9a-fA-F]{3,8}$/.test(raw) || /^rgba?\(/.test(raw)) return raw;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "rgba(136, 136, 136, 1)";
    ctx.fillStyle = raw;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
  } catch {
    return "rgba(136, 136, 136, 1)";
  }
}

// ── Chart (inner, mounted only client-side; exported for the replay player) ──

export function TradeChart({
  trade,
  candles,
  digits,
  dark,
  timezone,
  tfLabel,
}: {
  trade: TradeDetailDTO;
  candles: Candle[];
  digits: number;
  dark: boolean;
  timezone: string;
  tfLabel: string;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const chartRef = React.useRef<IChartApi | null>(null);
  const seriesRef = React.useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [hovered, setHovered] = React.useState<Candle | null>(null);
  const t = useTranslations("chartsBuilder.price");

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 420,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: cssVar("--muted-foreground"),
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: dark ? "#ffffff10" : "#00000010" },
        horzLines: { color: dark ? "#ffffff10" : "#00000010" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { labelBackgroundColor: cssVar("--primary") },
        horzLine: { labelBackgroundColor: cssVar("--primary") },
      },
      rightPriceScale: { borderColor: cssVar("--border") },
      timeScale: { borderColor: cssVar("--border"), timeVisible: true, secondsVisible: false },
      localization: {
        priceFormatter: (p: number) => p.toFixed(digits),
      },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: cssVar("--gain"),
      downColor: cssVar("--loss"),
      borderUpColor: cssVar("--gain"),
      borderDownColor: cssVar("--loss"),
      wickUpColor: cssVar("--gain"),
      wickDownColor: cssVar("--loss"),
      priceFormat: { type: "price", precision: digits, minMove: Number((10 ** -digits).toFixed(digits)) },
    });
    chartRef.current = chart;
    seriesRef.current = series;

    // Crosshair legend.
    chart.subscribeCrosshairMove((param) => {
      const data = param.seriesData.get(series) as
        | { open: number; high: number; low: number; close: number }
        | undefined;
      if (!data || param.time == null) {
        setHovered(null);
        return;
      }
      setHovered({
        time: param.time as number,
        open: String(data.open),
        high: String(data.high),
        low: String(data.low),
        close: String(data.close),
        volume: null,
      });
    });

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth });
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [dark, digits]);

  // Data + overlay.
  React.useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || candles.length === 0) return;

    series.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
      }))
    );

    const { markers, lines } = buildTradeOverlay(trade);
    createSeriesMarkers(
      series,
      markers.map((m) => ({
        time: m.time as UTCTimestamp,
        position: m.position,
        color: cssVar(m.color.replace("var(", "").replace(")", "")) || m.color,
        shape: m.shape,
        text: m.text,
        size: 1,
      }))
    );
    for (const line of lines) {
      series.createPriceLine({
        price: line.price,
        title: line.title,
        color: cssVar(line.color.replace("var(", "").replace(")", "")) || line.color,
        lineWidth: line.width,
        lineStyle:
          line.lineStyle === "solid"
            ? LineStyle.Solid
            : line.lineStyle === "dotted"
              ? LineStyle.Dotted
              : line.lineStyle === "largeDashed"
                ? LineStyle.LargeDashed
                : LineStyle.Dashed,
        axisLabelVisible: true,
      });
    }

    chart.timeScale().fitContent();
  }, [candles, trade]);

  const hoveredText = hovered
    ? `${fmtDateTimeInTz(new Date(hovered.time * 1000).toISOString(), timezone)} - O ${hovered.open} H ${hovered.high} L ${hovered.low} C ${hovered.close}`
    : t("crosshairHint");

  return (
    <div className="space-y-1">
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-muted/40 px-3 py-1.5 font-mono text-xs text-muted-foreground"
        aria-live="polite"
      >
        <span className="font-sans font-medium text-foreground">{tfLabel}</span>
        <span>{hoveredText}</span>
      </div>
      <div
        ref={containerRef}
        className="h-[420px] w-full touch-pan-y"
        role="img"
        aria-label={t("chartAria", { symbol: trade.symbol })}
      />
    </div>
  );
}

// ── Section (data fetching + controls + fallback) ────────────────────────────

export function PriceChartSection({ trade }: { trade: TradeDetailDTO }) {
  const t = useTranslations("chartsBuilder.price");
  const tCommon = useTranslations("common");
  const { resolvedTheme } = useTheme();
  const { session } = useSession();
  const { toast } = useToast();
  const qc = useQueryClient();
  const timezone = session?.profile.timezone ?? "UTC";
  const dark = resolvedTheme === "dark";

  const defaultTf = (CANDLE_TIMEFRAMES as readonly string[]).includes(
    trade.timeframe ?? ""
  )
    ? (trade.timeframe as CandleTimeframe)
    : "M15";
  const [timeframe, setTimeframe] = React.useState<CandleTimeframe>(defaultTf);
  const [padding, setPadding] = React.useState<(typeof PADDING_OPTIONS)[number]>(30);
  const [importOpen, setImportOpen] = React.useState(false);

  // Window: entry − padding bars, exit + padding bars (of the requested tf).
  const window = React.useMemo(() => {
    const tfMin = { M1: 1, M5: 5, M15: 15, M30: 30, H1: 60, H4: 240, D1: 1440 }[timeframe];
    const padMs = padding * tfMin * 60_000;
    const entry = new Date(trade.entryTime).getTime();
    const exit = new Date(trade.exitTime ?? trade.entryTime).getTime();
    return {
      from: new Date(Math.max(0, entry - padMs)).toISOString(),
      to: new Date(exit + padMs).toISOString(),
    };
  }, [trade.entryTime, trade.exitTime, timeframe, padding]);

  const candleQuery = useQuery({
    queryKey: [
      "charts",
      "candles",
      trade.instrumentId,
      timeframe,
      window.from,
      window.to,
    ],
    queryFn: async () =>
      apiFetch<CandleWindowPayload>(
        `/api/v1/charts/candles?instrumentId=${encodeURIComponent(trade.instrumentId)}&timeframe=${timeframe}&from=${encodeURIComponent(window.from)}&to=${encodeURIComponent(window.to)}`
      ),
    staleTime: 60 * 1000,
  });

  const data = candleQuery.data;
  const storedTf = data?.timeframe ?? null;
  const rawCandles: Candle[] = React.useMemo(
    () =>
      (data?.candles ?? []).map((c) => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })),
    [data]
  );
  const displayCandles = React.useMemo(() => {
    // Resample when the server returned a finer stored timeframe
    // (resampling an empty list yields an empty list).
    if (storedTf != null && storedTf !== timeframe) {
      return resample(rawCandles, timeframe);
    }
    return rawCandles;
  }, [rawCandles, storedTf, timeframe]);

  const cov = React.useMemo(() => {
    if (displayCandles.length === 0) return null;
    return coverage(
      displayCandles,
      Math.floor(new Date(trade.entryTime).getTime() / 1000),
      Math.floor(new Date(trade.exitTime ?? trade.entryTime).getTime() / 1000),
      timeframe
    );
  }, [displayCandles, trade.entryTime, trade.exitTime, timeframe]);

  const fmtTime = (sec: number | null) =>
    sec == null
      ? "-"
      : fmtDateTimeInTz(new Date(sec * 1000).toISOString(), timezone);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">
            {t("title")} - {trade.symbol}
          </CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Select value={timeframe} onValueChange={(v) => setTimeframe(v as CandleTimeframe)}>
            <SelectTrigger className="h-8 w-[74px]" aria-label={t("timeframe")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CANDLE_TIMEFRAMES.map((tf) => (
                <SelectItem key={tf} value={tf}>
                  {tf}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(padding)}
            onValueChange={(v) => setPadding(Number(v) as (typeof PADDING_OPTIONS)[number])}
          >
            <SelectTrigger className="h-8 w-[110px]" aria-label={t("padding")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PADDING_OPTIONS.map((p) => (
                <SelectItem key={p} value={String(p)}>
                  {t("paddingBars", { count: p })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => void candleQuery.refetch()}
            aria-label={tCommon("refresh")}
          >
            <RefreshCw aria-hidden="true" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {candleQuery.isLoading ? (
          <Skeleton className="h-[420px] w-full" />
        ) : displayCandles.length === 0 ? (
          <NoCandlesFallback
            trade={trade}
            storedTimeframes={data?.storedTimeframes ?? []}
            onImport={() => setImportOpen(true)}
            t={t}
          />
        ) : (
          <>
            {(cov == null || !cov.coversFrom || !cov.coversTo) && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-muted-foreground">
                {t("coverageBanner", {
                  from: fmtTime(cov?.first ?? null),
                  to: fmtTime(cov?.last ?? null),
                })}
              </p>
            )}
            {data?.timeframe && data.timeframe !== timeframe && (
              <p className="text-xs text-muted-foreground">
                {t("resampledFrom", { tf: data.timeframe })}
              </p>
            )}
            <TradeChart
              trade={trade}
              candles={displayCandles}
              digits={data?.digits ?? trade.digits}
              dark={dark}
              timezone={timezone}
              tfLabel={timeframe}
            />
          </>
        )}
        {/* TradingView lightweight-charts attribution (Apache-2.0). */}
        <p className="text-right text-[10px] text-muted-foreground">
          {t("attribution")}{" "}
          <a
            className="underline underline-offset-2 hover:text-foreground"
            href="https://www.tradingview.com/lightweight-charts/"
            target="_blank"
            rel="noopener noreferrer"
          >
            TradingView lightweight-charts
          </a>{" "}
          · Apache-2.0
        </p>
      </CardContent>

      <CandleImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        trade={trade}
        timezone={timezone}
        onImported={() => {
          void qc.invalidateQueries({ queryKey: ["charts", "candles"] });
        }}
      />
    </Card>
  );
}

// ── No-candles fallback (inline SVG ruler) ───────────────────────────────────

function NoCandlesFallback({
  trade,
  storedTimeframes,
  onImport,
  t,
}: {
  trade: TradeDetailDTO;
  storedTimeframes: CandleTimeframe[];
  onImport: () => void;
  t: (k: string, params?: Record<string, string | number>) => string;
}) {
  const entry = Number(trade.entryPrice);
  const sl = trade.stopLoss != null ? Number(trade.stopLoss) : null;
  const tp = trade.takeProfit != null ? Number(trade.takeProfit) : null;
  const levels = [
    { label: "TP", price: tp, color: "var(--gain)" },
    { label: "Entry", price: entry, color: "var(--chart-1)" },
    { label: "SL", price: sl, color: "var(--loss)" },
  ].filter((l): l is { label: string; price: number; color: string } => l.price != null);
  const prices = levels.map((l) => l.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const pad = (max - min) * 0.15 || 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed py-8 text-center">
        <svg
          viewBox="0 0 640 200"
          className="w-full max-w-xl"
          role="img"
          aria-label={t("fallbackAria")}
        >
          {levels.map((l, i) => {
            const y = 30 + ((max + pad - l.price) / (max - min + 2 * pad)) * 140;
            return (
              <g key={l.label}>
                <line
                  x1={40}
                  x2={600}
                  y1={y}
                  y2={y}
                  stroke={l.color}
                  strokeWidth={l.label === "Entry" ? 2 : 1.5}
                  strokeDasharray={l.label === "Entry" ? undefined : "6 3"}
                />
                <text x={44} y={y - 5} fontSize={11} fill="var(--foreground)">
                  {l.label} {fmtPrice(l.price, 2)}
                </text>
                <text x={604} y={y + 3} fontSize={9} fill="var(--muted-foreground)" textAnchor="end">
                  {i === 0 ? "" : ""}
                </text>
              </g>
            );
          })}
        </svg>
        <p className="font-medium">{t("noCandles")}</p>
        <p className="max-w-md text-sm text-muted-foreground">
          {storedTimeframes.length > 0
            ? t("noCandlesAtTf", { tfs: storedTimeframes.join(", ") })
            : t("noCandlesDesc")}
        </p>
        <Button size="sm" className="mt-1" onClick={onImport}>
          <FileUp aria-hidden="true" />
          {t("importCta")}
        </Button>
      </div>
    </div>
  );
}

// ── CSV import dialog ────────────────────────────────────────────────────────

function CandleImportDialog({
  open,
  onOpenChange,
  trade,
  timezone,
  onImported,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  trade: TradeDetailDTO;
  timezone: string;
  onImported: () => void;
}) {
  const t = useTranslations("chartsBuilder.price");
  const tCommon = useTranslations("common");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const [csv, setCsv] = React.useState("");
  const [tz, setTz] = React.useState(timezone);
  const [tf, setTf] = React.useState<CandleTimeframe>("M15");
  const [busy, setBusy] = React.useState(false);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setCsv(text.slice(0, 8_000_000));
  };

  const doImport = async () => {
    if (!csv.trim()) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ imported: number; skipped: number; pruned: number }>(
        "/api/v1/charts/candles/import",
        {
          method: "POST",
          body: JSON.stringify({
            instrumentId: trade.instrumentId,
            timeframe: tf,
            timezone: tz,
            csv,
          }),
        }
      );
      toast({
        title: t("importDone"),
        description: t("importStats", {
          imported: res.imported,
          skipped: res.skipped,
          pruned: res.pruned,
        }),
      });
      onOpenChange(false);
      setCsv("");
      onImported();
    } catch (error) {
      const err = error instanceof ApiClientError ? error : null;
      toast({
        title: tCommon("error"),
        description: apiErrorMessage(
          tRoot,
          err?.code,
          error instanceof Error ? error.message : ""
        ),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("importTitle")}</DialogTitle>
          <DialogDescription>{t("importDesc", { symbol: trade.symbol })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="candle-file">{t("importFile")}</Label>
            <input
              id="candle-file"
              type="file"
              accept=".csv,text/csv"
              className="text-sm"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <p className="text-xs text-muted-foreground">{t("importFormat")}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("importTimeframe")}</Label>
              <Select value={tf} onValueChange={(v) => setTf(v as CandleTimeframe)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CANDLE_TIMEFRAMES.map((x) => (
                    <SelectItem key={x} value={x}>
                      {x}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="candle-tz">{t("importTz")}</Label>
              <input
                id="candle-tz"
                className="h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm"
                value={tz}
                onChange={(e) => setTz(e.target.value)}
                placeholder="America/Toronto"
              />
            </div>
          </div>
          {csv && (
            <div className="space-y-1.5">
              <Label htmlFor="candle-preview">{t("importPreview")}</Label>
              <Textarea
                id="candle-preview"
                readOnly
                value={csv.slice(0, 500)}
                className="h-24 font-mono text-[10px]"
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => void doImport()} disabled={busy || !csv.trim()}>
            {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : <FileUp aria-hidden="true" />}
            {t("importAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
