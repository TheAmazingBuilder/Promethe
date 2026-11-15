"use client";

/**
 * v2.5 Module 2 — trade replay player (spec §4.3).
 *
 * Bar-by-bar replay of a closed trade on lightweight-charts with the pure
 * engine (/src/lib/charts/replay.ts): play/pause, step, speed 0.5×→10×,
 * scrubber, jump to entry/MFE/MAE/exit, pre-entry judgement mode (N bars
 * before entry, trade lines hidden until entry), live panel at the cursor
 * (pips, R, running MFE/MAE, distances, time in trade, events reached,
 * moving SL), keyboard controls (space, arrows), honest limitations banner.
 * Candles after the cursor are NEVER sent to the chart (no look-ahead).
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronsLeft,
  ChevronsRight,
  Flag,
  Gauge,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useSession } from "@/components/app/session-context";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api-client";
import { fmtDateTimeInTz } from "@/lib/format";
import { CANDLE_TIMEFRAMES, type CandleTimeframe } from "@/lib/validations/charts";
import { resample, type Candle } from "@/lib/charts/price";
import {
  createReplayEngine,
  type ReplayState,
} from "@/lib/charts/replay";
import type { TradeDetailDTO } from "@/lib/trading/dto";
import { PriceChartSection, TradeChart } from "./price-chart";

interface CandleWindowPayload {
  instrumentId: string;
  symbol: string;
  digits: number;
  pipSize: string;
  timeframe: CandleTimeframe | null;
  storedTimeframes: CandleTimeframe[];
  from: string;
  to: string;
  candles: Array<{
    time: number;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string | null;
  }>;
}

const SPEEDS = [0.5, 1, 2, 4, 10] as const;
const REPLAY_WINDOW_BARS = 200;

export function ReplayPlayerSection({ trade }: { trade: TradeDetailDTO }) {
  const t = useTranslations("chartsBuilder.replay");
  const tCommon = useTranslations("common");
  const { resolvedTheme } = useTheme();
  const { session } = useSession();
  const timezone = session?.profile.timezone ?? "UTC";
  const dark = resolvedTheme === "dark";

  const defaultTf = (CANDLE_TIMEFRAMES as readonly string[]).includes(
    trade.timeframe ?? ""
  )
    ? (trade.timeframe as CandleTimeframe)
    : "M15";
  const [timeframe, setTimeframe] = React.useState<CandleTimeframe>(defaultTf);
  const [preEntry, setPreEntry] = React.useState(false);
  const [preEntryBars, setPreEntryBars] = React.useState(10);
  const [state, setState] = React.useState<ReplayState | null>(null);

  // Window: a bounded number of bars around the trade.
  const window = React.useMemo(() => {
    const tfMin = { M1: 1, M5: 5, M15: 15, M30: 30, H1: 60, H4: 240, D1: 1440 }[timeframe];
    const padMs = REPLAY_WINDOW_BARS / 2 * tfMin * 60_000;
    const entry = new Date(trade.entryTime).getTime();
    const exit = new Date(trade.exitTime ?? trade.entryTime).getTime();
    return {
      from: new Date(Math.max(0, entry - padMs)).toISOString(),
      to: new Date(exit + padMs).toISOString(),
    };
  }, [trade.entryTime, trade.exitTime, timeframe]);

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
        `/api/charts/candles?instrumentId=${encodeURIComponent(trade.instrumentId)}&timeframe=${timeframe}&from=${encodeURIComponent(window.from)}&to=${encodeURIComponent(window.to)}`
      ),
    staleTime: 60 * 1000,
  });

  const engine = React.useMemo(() => {
    const data = candleQuery.data;
    if (!data || data.candles.length === 0) return null;
    let candles: Candle[] = data.candles.map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));
    if (data.timeframe && data.timeframe !== timeframe) {
      candles = resample(candles, timeframe);
    }
    if (candles.length === 0) return null;
    try {
      return createReplayEngine(candles, trade, {
        pipSize: Number(data.pipSize) || 1,
        preEntryBars: preEntry ? preEntryBars : 0,
      });
    } catch {
      return null;
    }
  }, [candleQuery.data, timeframe, trade, preEntry, preEntryBars]);

  // (Re)initialize the state when the engine changes.
  React.useEffect(() => {
    if (engine) setState(engine.initialState());
  }, [engine]);

  // Play loop — speed in bars/second (reduced-motion users control it manually).
  React.useEffect(() => {
    if (!engine || !state?.playing) return;
    const interval = Math.max(40, Math.round(1000 / state.speed));
    const id = setInterval(() => {
      setState((s) => {
        if (!s || !s.playing) return s;
        if (s.cursor >= engine.candles.length - 1) {
          return { ...s, playing: false };
        }
        return { ...s, cursor: s.cursor + 1 };
      });
    }, interval);
    return () => clearInterval(id);
  }, [engine, state?.playing, state?.speed]);

  const snap = React.useMemo(
    () => (engine && state ? engine.snapshot(state) : null),
    [engine, state]
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!engine || !state) return;
    if (e.key === " ") {
      e.preventDefault();
      setState(engine.setPlaying(state, !state.playing));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setState(engine.step(state, 1));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setState(engine.step(state, -1));
    }
  };

  const fmtDur = (sec: number) => {
    if (sec < 3600) return `${Math.round(sec / 60)} min`;
    if (sec < 86400) return `${(sec / 3600).toFixed(1)} h`;
    return `${(sec / 86400).toFixed(1)} d`;
  };

  if (candleQuery.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("title")} — {trade.symbol}</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-96 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!engine || !state || !snap) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("title")} — {trade.symbol}</CardTitle>
          <CardDescription>{t("needCandles")}</CardDescription>
        </CardHeader>
        <CardContent>
          <PriceChartSection trade={trade} />
        </CardContent>
      </Card>
    );
  }

  // Trade view for the chart: current SL, events filtered to the cursor,
  // exit shown only once reached (reuses buildTradeOverlay wholesale).
  const nowSec = snap.candle != null ? snap.candle.time : 0;
  const cursorTrade: TradeDetailDTO = {
    ...trade,
    stopLoss:
      snap.position?.currentSl != null
        ? String(snap.position.currentSl)
        : trade.stopLoss,
    initialStopLoss: snap.preEntry ? null : trade.initialStopLoss,
    executions: (trade.executions ?? []).filter(
      (e) => new Date(e.time).getTime() / 1000 <= nowSec
    ),
    newsEvents: (trade.newsEvents ?? []).filter(
      (n) => new Date(n.time).getTime() / 1000 <= nowSec
    ),
    modifications: (trade.modifications ?? []).filter(
      (m) => new Date(m.time).getTime() / 1000 <= nowSec
    ),
    exitTime: snap.closed ? trade.exitTime : null,
    exitPrice: snap.closed ? trade.exitPrice : null,
  };

  const pos = snap.position;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">
            {t("title")} — {trade.symbol}
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
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setState(engine.initialState())}
            aria-label={t("restart")}
          >
            <RotateCcw aria-hidden="true" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Limitations banner (honest replay quality note). */}
        <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-muted-foreground">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          {t("limitations")}
        </p>

        {/* Controls (keyboard reachable) */}
        <div
          className="flex flex-wrap items-center gap-1.5 rounded-md border p-2"
          tabIndex={0}
          role="group"
          aria-label={t("controlsAria")}
          onKeyDown={onKeyDown}
        >
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            aria-label={t("jumpEntry")}
            onClick={() => setState(engine.seek(state, engine.entryIdx))}
          >
            <SkipBack aria-hidden="true" />
            <span className="hidden sm:inline">{t("entryBtn")}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            aria-label={t("stepBack")}
            onClick={() => setState(engine.step(state, -1))}
          >
            <ChevronsLeft aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            className="h-8 w-16"
            aria-label={state.playing ? t("pause") : t("play")}
            onClick={() => setState(engine.setPlaying(state, !state.playing))}
          >
            {state.playing ? (
              <Pause aria-hidden="true" />
            ) : (
              <Play aria-hidden="true" />
            )}
            {state.playing ? t("pause") : t("play")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            aria-label={t("stepForward")}
            onClick={() => setState(engine.step(state, 1))}
          >
            <ChevronsRight aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            aria-label={t("jumpExit")}
            onClick={() =>
              engine.exitIdx != null && setState(engine.seek(state, engine.exitIdx))
            }
          >
            <span className="hidden sm:inline">{t("exitBtn")}</span>
            <SkipForward aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            aria-label={t("jumpMfe")}
            disabled={engine.mfeIdx == null}
            onClick={() =>
              engine.mfeIdx != null && setState(engine.seek(state, engine.mfeIdx))
            }
          >
            <TrendingUp aria-hidden="true" />
            <span className="hidden sm:inline">MFE</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            aria-label={t("jumpMae")}
            disabled={engine.maeIdx == null}
            onClick={() =>
              engine.maeIdx != null && setState(engine.seek(state, engine.maeIdx))
            }
          >
            <TrendingDown aria-hidden="true" />
            <span className="hidden sm:inline">MAE</span>
          </Button>
          <div className="flex items-center gap-1.5">
            <Label className="sr-only" htmlFor="replay-speed">
              {t("speed")}
            </Label>
            <Select
              value={String(state.speed)}
              onValueChange={(v) => setState(engine.setSpeed(state, Number(v)))}
            >
              <SelectTrigger id="replay-speed" className="h-8 w-[70px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPEEDS.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s}×
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="pre-entry"
              checked={preEntry}
              onCheckedChange={setPreEntry}
              aria-label={t("preEntry")}
            />
            <Label htmlFor="pre-entry" className="text-xs text-muted-foreground">
              {t("preEntry")}
            </Label>
            {preEntry && (
              <Select
                value={String(preEntryBars)}
                onValueChange={(v) => setPreEntryBars(Number(v))}
              >
                <SelectTrigger className="h-8 w-[76px]" aria-label={t("preEntryBars")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[5, 10, 20, 50].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {/* Scrubber */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{fmtDateTimeInTz(new Date(engine.candles[0].time * 1000).toISOString(), timezone)}</span>
            <span aria-live="polite">
              {snap.candle
                ? fmtDateTimeInTz(
                    new Date(snap.candle.time * 1000).toISOString(),
                    timezone
                  )
                : ""}
              {" · "}
              {state.cursor + 1}/{engine.candles.length}
            </span>
            <span>
              {fmtDateTimeInTz(
                new Date(
                  engine.candles[engine.candles.length - 1].time * 1000
                ).toISOString(),
                timezone
              )}
            </span>
          </div>
          <Slider
            value={[Math.min(state.cursor, engine.candles.length - 1)]}
            min={0}
            max={engine.candles.length - 1}
            step={1}
            onValueChange={(v) => setState(engine.seek(state, v[0] ?? 0))}
            aria-label={t("scrubber")}
          />
        </div>

        {/* Chart (no look-ahead: only snap.visible is rendered) */}
        <TradeChart
          trade={cursorTrade}
          candles={snap.visible}
          digits={candleQuery.data?.digits ?? trade.digits}
          dark={dark}
          timezone={timezone}
          tfLabel={timeframe}
        />

        {/* Live panel */}
        <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-4" aria-live="polite">
          <div>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Gauge aria-hidden="true" className="h-3.5 w-3.5" />
              {t("floating")}
            </p>
            {pos ? (
              <p className="mt-0.5 font-mono text-sm">
                <span className={pos.pips >= 0 ? "text-gain" : "text-loss"}>
                  {pos.pips >= 0 ? "+" : ""}
                  {pos.pips} pips
                </span>{" "}
                ·{" "}
                <span className={pos.rMultiple >= 0 ? "text-gain" : "text-loss"}>
                  {pos.rMultiple >= 0 ? "+" : ""}
                  {pos.rMultiple} R
                </span>
              </p>
            ) : (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {snap.preEntry ? t("preEntryActive") : "—"}
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("runningExtremes")}</p>
            {pos ? (
              <p className="mt-0.5 font-mono text-sm">
                MFE <span className="text-gain">+{pos.mfeR} R</span> · MAE{" "}
                <span className="text-loss">−{pos.maeR} R</span>
              </p>
            ) : (
              <p className="mt-0.5 text-sm text-muted-foreground">—</p>
            )}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("distances")}</p>
            {pos ? (
              <p className="mt-0.5 font-mono text-sm">
                SL {pos.distanceToSlPips ?? "—"} pips · TP{" "}
                {pos.distanceToTpPips ?? "—"} pips
              </p>
            ) : (
              <p className="mt-0.5 text-sm text-muted-foreground">—</p>
            )}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("timeInTrade")}</p>
            <p className="mt-0.5 font-mono text-sm">
              {snap.preEntry ? "—" : fmtDur(snap.timeInTradeSec)}
              {snap.closed ? ` · ${t("closedLabel")}` : ""}
            </p>
          </div>
          {/* Events reached */}
          <div className="sm:col-span-2 lg:col-span-4">
            <p className="text-xs text-muted-foreground">{t("events")}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {snap.events.length === 0 ? (
                <span className="text-sm text-muted-foreground">—</span>
              ) : (
                snap.events.map((e, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]"
                  >
                    {e.kind === "NEWS" ? "📰" : e.kind === "SL_MOVE" ? "⇄" : "•"}{" "}
                    {e.label}
                  </span>
                ))
              )}
            </div>
            {snap.slTpBothTouched && (
              <p className="mt-1.5 flex items-center gap-1.5 text-[11px] italic text-amber-500">
                <Flag aria-hidden="true" className="h-3 w-3" />
                {t("ambiguity")}
              </p>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t("keyboardHint")}</p>
      </CardContent>
    </Card>
  );
}
