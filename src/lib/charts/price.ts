/**
 * TradeJournal — price chart helpers (v2.5 Module 2, spec §4.2).
 *
 * PURE and client-safe: candle resampling (from the finest stored timeframe,
 * UTC epoch bucketing — DST-safe by construction since buckets are absolute),
 * trade overlay building (entry/exit/partial markers, SL/TP/moved-SL price
 * lines, news markers) and candle coverage checks.
 *
 * Intrabar ordering is UNKNOWN from OHLC candles: replay makes conservative
 * documented assumptions (see replay.ts). Prices stay strings until display.
 */
import type { CandleTimeframe } from "@/lib/validations/charts";
import { TF_MINUTES } from "@/lib/validations/charts";

// ── Candle shape (client mirror of PriceCandle) ──────────────────────────────

export interface Candle {
  /** Bar open time, epoch SECONDS (UTC). */
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string | null;
}

// ── Resampling ───────────────────────────────────────────────────────────────

/**
 * Resample candles to a coarser timeframe. Buckets are absolute UTC epochs
 * (floor(time / tfSec) · tfSec) — no DST or timezone ambiguity. Gaps and
 * weekends simply produce missing buckets. Input MUST be sorted ascending;
 * output is sorted ascending with merged OHLCV per bucket.
 */
export function resample(candles: Candle[], target: CandleTimeframe): Candle[] {
  const tfSec = TF_MINUTES[target] * 60;
  const buckets = new Map<number, Candle>();
  for (const c of candles) {
    const bucketTime = Math.floor(c.time / tfSec) * tfSec;
    const existing = buckets.get(bucketTime);
    if (!existing) {
      buckets.set(bucketTime, { ...c, time: bucketTime });
      continue;
    }
    // Merge OHLCV.
    const high = Math.max(Number(existing.high), Number(c.high));
    const low = Math.min(Number(existing.low), Number(c.low));
    const volExisting = existing.volume != null ? Number(existing.volume) : null;
    const volNew = c.volume != null ? Number(c.volume) : null;
    const volume =
      volExisting != null && volNew != null
        ? String(volExisting + volNew)
        : (volExisting ?? volNew) != null
          ? String(volExisting ?? volNew)
          : null;
    buckets.set(bucketTime, {
      ...existing,
      high: String(high),
      low: String(low),
      close: c.close, // last candle in the bucket closes it
      volume,
    });
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

/** Finest stored timeframe usable to build `target` (null = none suitable). */
export function finestFor(
  available: CandleTimeframe[],
  target: CandleTimeframe
): CandleTimeframe | null {
  const suitable = available
    .filter((tf) => TF_MINUTES[tf] <= TF_MINUTES[target])
    .sort((a, b) => TF_MINUTES[a] - TF_MINUTES[b]);
  return suitable[0] ?? null;
}

// ── Coverage ─────────────────────────────────────────────────────────────────

export interface CoverageInfo {
  first: number | null;
  last: number | null;
  /** Candles exist at or before `from` (with the target timeframe tolerance). */
  coversFrom: boolean;
  /** Candles exist at or after `to`. */
  coversTo: boolean;
  /** Biggest gap between consecutive bars, in seconds (0 for ≤ 1 bar). */
  maxGapSec: number;
  count: number;
}

/**
 * Coverage of a candle list over [fromSec, toSec] (epoch seconds). A boundary
 * is "covered" when a bar exists within one target-timeframe step of it.
 */
export function coverage(
  candles: Candle[],
  fromSec: number,
  toSec: number,
  tf: CandleTimeframe
): CoverageInfo {
  const tfSec = TF_MINUTES[tf] * 60;
  if (candles.length === 0) {
    return {
      first: null,
      last: null,
      coversFrom: false,
      coversTo: false,
      maxGapSec: 0,
      count: 0,
    };
  }
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const first = sorted[0].time;
  const last = sorted[sorted.length - 1].time;
  let maxGapSec = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = sorted[i].time - sorted[i - 1].time;
    if (gap > maxGapSec) maxGapSec = gap;
  }
  return {
    first,
    last,
    coversFrom: first <= fromSec + tfSec,
    coversTo: last >= toSec - tfSec,
    maxGapSec,
    count: sorted.length,
  };
}

// ── Trade overlay ────────────────────────────────────────────────────────────

/** Minimal trade shape for overlay building (subset of TradeDetailDTO). */
export interface OverlayTrade {
  direction: string; // LONG | SHORT
  entryTime: string; // ISO
  exitTime: string | null;
  entryPrice: string;
  exitPrice: string | null;
  stopLoss: string | null;
  takeProfit: string | null;
  initialStopLoss: string | null;
  initialTakeProfit: string | null;
  executions?: Array<{
    type: string; // ENTRY | ADD | PARTIAL_EXIT | FINAL_EXIT
    time: string;
    price: string;
    lots: string;
  }>;
  modifications?: Array<{
    time: string;
    field: string; // STOP_LOSS | TAKE_PROFIT | VOLUME | OTHER
    oldValue: string | null;
    newValue: string | null;
  }>;
  newsEvents?: Array<{
    title: string;
    time: string;
    importance: string; // LOW | MEDIUM | HIGH
  }>;
}

export interface OverlayMarker {
  /** Epoch seconds. */
  time: number;
  position: "aboveBar" | "belowBar";
  color: string; // CSS token expression, resolved by the chart component
  shape: "circle" | "square" | "arrowUp" | "arrowDown";
  text: string;
}

export interface OverlayLine {
  price: number;
  title: string;
  /** CSS color or token expression. */
  color: string;
  /** dashed | solid | dotted | largeDashed */
  lineStyle: "dashed" | "solid" | "dotted" | "largeDashed";
  width: 1 | 2;
}

/** Semantic colors — token expressions resolved in the browser. */
export const OVERLAY_COLORS = {
  entry: "var(--chart-1)",
  exit: "var(--chart-2)",
  sl: "var(--loss)",
  tp: "var(--gain)",
  news: "var(--neutral)",
  partial: "var(--chart-3)",
} as const;

const toSec = (iso: string): number => Math.floor(new Date(iso).getTime() / 1000);

/**
 * Build the chart overlay: markers (entry, exit, partials, adds, news) and
 * price lines (entry, initial SL/TP, final SL/TP, moved-SL steps).
 * Long entries sit BELOW the bar, shorts ABOVE (and vice versa for exits).
 */
export function buildTradeOverlay(trade: OverlayTrade): {
  markers: OverlayMarker[];
  lines: OverlayLine[];
  slSteps: Array<{ time: number; price: number }>;
} {
  const long = trade.direction === "LONG";
  const markers: OverlayMarker[] = [];
  const lines: OverlayLine[] = [];
  const slSteps: Array<{ time: number; price: number }> = [];

  // ── Markers ──
  if (trade.executions && trade.executions.length > 0) {
    for (const e of trade.executions) {
      const t = toSec(e.time);
      if (e.type === "ENTRY") {
        markers.push({
          time: t,
          position: long ? "belowBar" : "aboveBar",
          color: OVERLAY_COLORS.entry,
          shape: long ? "arrowUp" : "arrowDown",
          text: `Entry ${e.price}`,
        });
      } else if (e.type === "ADD") {
        markers.push({
          time: t,
          position: long ? "belowBar" : "aboveBar",
          color: OVERLAY_COLORS.entry,
          shape: "circle",
          text: `Add ${e.lots}`,
        });
      } else if (e.type === "PARTIAL_EXIT") {
        markers.push({
          time: t,
          position: long ? "aboveBar" : "belowBar",
          color: OVERLAY_COLORS.partial,
          shape: "square",
          text: `Partial ${e.lots}`,
        });
      } else if (e.type === "FINAL_EXIT") {
        markers.push({
          time: t,
          position: long ? "aboveBar" : "belowBar",
          color: OVERLAY_COLORS.exit,
          shape: long ? "arrowDown" : "arrowUp",
          text: `Exit ${e.price}`,
        });
      }
    }
  } else {
    // Aggregate fallback: single entry + exit markers.
    markers.push({
      time: toSec(trade.entryTime),
      position: long ? "belowBar" : "aboveBar",
      color: OVERLAY_COLORS.entry,
      shape: long ? "arrowUp" : "arrowDown",
      text: `Entry ${trade.entryPrice}`,
    });
    if (trade.exitTime && trade.exitPrice) {
      markers.push({
        time: toSec(trade.exitTime),
        position: long ? "aboveBar" : "belowBar",
        color: OVERLAY_COLORS.exit,
        shape: long ? "arrowDown" : "arrowUp",
        text: `Exit ${trade.exitPrice}`,
      });
    }
  }

  // News markers.
  for (const n of trade.newsEvents ?? []) {
    markers.push({
      time: toSec(n.time),
      position: "aboveBar",
      color: OVERLAY_COLORS.news,
      shape: "square",
      text: `📰 ${n.title}`.slice(0, 40),
    });
  }
  markers.sort((a, b) => a.time - b.time);

  // ── Price lines ──
  const entry = Number(trade.entryPrice);
  if (Number.isFinite(entry)) {
    lines.push({
      price: entry,
      title: "Entry",
      color: OVERLAY_COLORS.entry,
      lineStyle: "solid",
      width: 2,
    });
  }
  const iSl = trade.initialStopLoss != null ? Number(trade.initialStopLoss) : null;
  const iTp = trade.initialTakeProfit != null ? Number(trade.initialTakeProfit) : null;
  const fSl = trade.stopLoss != null ? Number(trade.stopLoss) : null;
  const fTp = trade.takeProfit != null ? Number(trade.takeProfit) : null;

  if (iSl != null && Number.isFinite(iSl)) {
    lines.push({
      price: iSl,
      title: fSl != null && fSl !== iSl ? "Initial SL" : "SL",
      color: OVERLAY_COLORS.sl,
      lineStyle: fSl != null && fSl !== iSl ? "dotted" : "dashed",
      width: 1,
    });
  }
  if (iTp != null && Number.isFinite(iTp)) {
    lines.push({
      price: iTp,
      title: fTp != null && fTp !== iTp ? "Initial TP" : "TP",
      color: OVERLAY_COLORS.tp,
      lineStyle: fTp != null && fTp !== iTp ? "dotted" : "dashed",
      width: 1,
    });
  }
  if (fSl != null && Number.isFinite(fSl) && fSl !== iSl) {
    lines.push({
      price: fSl,
      title: "SL (final)",
      color: OVERLAY_COLORS.sl,
      lineStyle: "dashed",
      width: 2,
    });
  }
  if (fTp != null && Number.isFinite(fTp) && fTp !== iTp) {
    lines.push({
      price: fTp,
      title: "TP (final)",
      color: OVERLAY_COLORS.tp,
      lineStyle: "dashed",
      width: 2,
    });
  }

  // Moved-SL steps (STOP_LOSS modifications) — markers on the timeline used
  // by the replay "moving SL line" and shown as stepped price lines.
  for (const m of trade.modifications ?? []) {
    if (m.field !== "STOP_LOSS" || m.newValue == null) continue;
    const price = Number(m.newValue);
    if (!Number.isFinite(price)) continue;
    slSteps.push({ time: toSec(m.time), price });
    markers.push({
      time: toSec(m.time),
      position: long ? "belowBar" : "aboveBar",
      color: OVERLAY_COLORS.sl,
      shape: "circle",
      text: `SL → ${m.newValue}`,
    });
  }

  return { markers, lines, slSteps };
}

/** SL effective at a given time (initial → moved steps), for the replay. */
export function slAt(
  trade: OverlayTrade,
  atSec: number
): number | null {
  const initial = trade.initialStopLoss ?? trade.stopLoss;
  let current = initial != null ? Number(initial) : null;
  for (const m of (trade.modifications ?? [])
    .filter((m) => m.field === "STOP_LOSS" && m.newValue != null)
    .sort((a, b) => toSec(a.time) - toSec(b.time))) {
    if (toSec(m.time) <= atSec) {
      current = Number(m.newValue);
    }
  }
  return current;
}

// ── CSV parsing (shared by the server import and client preview) ────────────

export interface ParsedCsvCandle {
  timeSec: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string | null;
}

/**
 * Parse one CSV row into a candle. Accepted time formats: unix seconds, unix
 * milliseconds, "YYYY-MM-DD[ HH:mm[:SS]]", ISO 8601. `tzOffsetMin` shifts
 * wall-clock times (declared timezone) to UTC — 0 for already-UTC/epoch input.
 * Returns null on unparseable rows.
 */
export function parseCandleRow(
  row: Record<string, string | undefined>,
  tzOffsetMin: number
): ParsedCsvCandle | null {
  const rawTime =
    row.time ?? row.Time ?? row.datetime ?? row.DateTime ?? row.date ??
    row.Date ?? row.timestamp ?? row.Timestamp ?? row["Date time"] ?? row["Gmt time"];
  const open = row.open ?? row.Open ?? row.o;
  const high = row.high ?? row.High ?? row.h;
  const low = row.low ?? row.Low ?? row.l;
  const close = row.close ?? row.Close ?? row.c;
  const volumeRaw = row.volume ?? row.Volume ?? row.v ?? row.vol;
  if (rawTime == null || !open || !high || !low || !close) return null;

  let timeSec: number | null = null;
  const t = rawTime.trim();
  if (/^\d{10}$/.test(t)) {
    timeSec = Number(t); // unix seconds
  } else if (/^\d{13}$/.test(t)) {
    timeSec = Math.floor(Number(t) / 1000); // unix ms
  } else {
    // ISO or "YYYY-MM-DD HH:mm[:ss]" (optionally with T and offset)
    const m = t.match(
      /^(\d{4})-(\d{2})-(\d{2})([T ](\d{2}):(\d{2})(:(\d{2})(\.\d+)?)?)?/
    );
    if (m) {
      const [, y, mo, d, , h = "00", mi = "00", , s = "00"] = m;
      // Wall time in the DECLARED timezone → UTC (subtract the offset).
      const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
      timeSec = Math.floor((utcMs - tzOffsetMin * 60 * 1000) / 1000);
      // ISO with explicit offset (Z or ±HH:MM): the offset is already UTC.
      const tzSuffix = t.match(/(Z|[+-]\d{2}:?\d{2})$/);
      if (tzSuffix) {
        timeSec = Math.floor(new Date(t).getTime() / 1000);
      }
    } else {
      const asDate = new Date(t).getTime();
      if (Number.isFinite(asDate)) timeSec = Math.floor(asDate / 1000);
    }
  }
  if (timeSec == null || !Number.isFinite(timeSec)) return null;

  const num = (v: string): string | null => {
    const n = Number(v);
    return Number.isFinite(n) ? v.trim() : null;
  };
  const o = num(open);
  const h = num(high);
  const l = num(low);
  const c = num(close);
  if (o == null || h == null || l == null || c == null) return null;

  return {
    timeSec,
    open: o,
    high: h,
    low: l,
    close: c,
    volume: volumeRaw != null && volumeRaw !== "" ? num(volumeRaw) : null,
  };
}

/**
 * Offset (minutes) of an IANA timezone at a given wall-clock instant — for
 * converting declared-timezone CSV timestamps to UTC. Pure (Intl-based).
 */
export function tzOffsetMinutes(timezone: string, atMs: number): number | null {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const parts: Record<string, string> = {};
    for (const p of dtf.formatToParts(new Date(atMs))) {
      if (p.type !== "literal") parts[p.type] = p.value;
    }
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    return Math.round((asUtc - atMs) / 60000);
  } catch {
    return null;
  }
}

/** Validate a timezone string (IANA name or fixed +HH:MM offset). */
export function isValidTimezone(tz: string): boolean {
  if (/^[+-]\d{2}:\d{2}$/.test(tz)) return true;
  return tzOffsetMinutes(tz, Date.now()) != null;
}
