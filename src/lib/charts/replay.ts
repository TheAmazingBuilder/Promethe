/**
 * TradeJournal — trade replay engine (v2.5 Module 2, spec §4.3).
 *
 * PURE and client-safe state machine over the trade's candles:
 *  - step / seek / play controls with NO LOOK-AHEAD (only candles ≤ cursor
 *    are ever exposed to the chart);
 *  - live position panel at the cursor: floating pips / R, running MFE/MAE,
 *    distance to SL/TP, time in trade, events reached;
 *  - the SL follows TradeModification steps (slAt) as bars advance;
 *  - INTRABAR ORDERING IS UNKNOWN from OHLC candles — documented conservative
 *    assumptions: (1) running MFE/MAE use the extremes of every bar seen so
 *    far (exact for cumulative extremes); (2) when a bar touches BOTH SL and
 *    TP the outcome is ambiguous — we flag it (`slTpBothTouched`) and assume
 *    the WORST case (SL first) for the running P&L; (3) the position opens on
 *    the bar containing the entry time and is marked closed from the bar
 *    containing the exit time (realized result from the trade record).
 */
import type { Candle, OverlayTrade } from "@/lib/charts/price";
import { slAt } from "@/lib/charts/price";

// ── State ────────────────────────────────────────────────────────────────────

export interface ReplayState {
  /** Index of the last VISIBLE candle (−1 = nothing visible yet). */
  cursor: number;
  playing: boolean;
  /** Bars per second (0.5 → 10). */
  speed: number;
}

export interface ReplayEvent {
  kind: "ENTRY" | "ADD" | "PARTIAL_EXIT" | "FINAL_EXIT" | "SL_MOVE" | "NEWS";
  label: string;
  time: number;
}

export interface ReplaySnapshot {
  state: ReplayState;
  /** Candles [0..cursor] - strictly no look-ahead. */
  visible: Candle[];
  /** Cursor bar (null before the first step). */
  candle: Candle | null;
  /** True while the entry bar has been reached but not the exit bar. */
  inTrade: boolean;
  /** True once the exit bar has been reached. */
  closed: boolean;
  /** True before the entry bar (pre-entry judgement mode). */
  preEntry: boolean;
  position: {
    entryPrice: number;
    price: number;
    pips: number;
    rMultiple: number;
    mfeR: number;
    maeR: number;
    currentSl: number | null;
    distanceToSlPips: number | null;
    distanceToTpPips: number | null;
  } | null;
  /** Events at or before the cursor (partials, SL moves, news). */
  events: ReplayEvent[];
  /** A visible bar touched both SL and TP - intrabar ambiguity (see header). */
  slTpBothTouched: boolean;
  /** Seconds between entry and the cursor bar close (0 before entry). */
  timeInTradeSec: number;
}

// ── Engine ───────────────────────────────────────────────────────────────────

export interface ReplayOptions {
  /** Pip size of the instrument (pips = price distance / pipSize). */
  pipSize: number;
  /** Start the replay N bars before the entry bar (pre-entry judgement). */
  preEntryBars?: number;
}

const toSec = (iso: string): number => Math.floor(new Date(iso).getTime() / 1000);

export function createReplayEngine(
  candles: Candle[],
  trade: OverlayTrade,
  options: ReplayOptions
) {
  if (candles.length === 0) {
    throw new Error("NO_CANDLES");
  }
  const { pipSize } = options;

  // Sorted candles (defensive).
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const tfSec =
    sorted.length > 1
      ? Math.min(
          ...sorted.slice(1).map((c, i) => c.time - sorted[i].time)
        )
      : 300;

  const entrySec = toSec(trade.entryTime);
  const exitSec = trade.exitTime != null ? toSec(trade.exitTime) : null;

  /** First bar whose [time, time+tf) window contains t. */
  const barIndexAt = (t: number): number => {
    for (let i = 0; i < sorted.length; i += 1) {
      if (sorted[i].time <= t && t < sorted[i].time + tfSec) return i;
      if (sorted[i].time > t) return i; // first bar after t
    }
    return sorted.length - 1;
  };
  const entryIdx = barIndexAt(entrySec);
  const exitIdx = exitSec != null ? barIndexAt(exitSec) : null;

  // MFE/MAE extremes of the TRADE (prices) — from the trade record when
  // present, else tracked from bar extremes.
  const long = trade.direction === "LONG";
  const entryPrice = Number(trade.entryPrice);
  const initialSl = trade.initialStopLoss != null ? Number(trade.initialStopLoss) : null;
  const fallbackSl = trade.stopLoss != null ? Number(trade.stopLoss) : null;
  const tp = trade.takeProfit != null ? Number(trade.takeProfit) : null;
  const riskPerUnit =
    initialSl != null
      ? Math.abs(entryPrice - initialSl)
      : fallbackSl != null
        ? Math.abs(entryPrice - fallbackSl)
        : null;

  // Events (partial closes, SL moves, news).
  const events: ReplayEvent[] = [];
  for (const e of trade.executions ?? []) {
    if (e.type === "ENTRY") events.push({ kind: "ENTRY", label: `Entry ${e.price}`, time: toSec(e.time) });
    else if (e.type === "ADD") events.push({ kind: "ADD", label: `Add ${e.lots} @ ${e.price}`, time: toSec(e.time) });
    else if (e.type === "PARTIAL_EXIT") events.push({ kind: "PARTIAL_EXIT", label: `Partial ${e.lots} @ ${e.price}`, time: toSec(e.time) });
    else if (e.type === "FINAL_EXIT") events.push({ kind: "FINAL_EXIT", label: `Exit ${e.price}`, time: toSec(e.time) });
  }
  for (const m of trade.modifications ?? []) {
    if (m.field === "STOP_LOSS" && m.newValue != null) {
      events.push({ kind: "SL_MOVE", label: `SL → ${m.newValue}`, time: toSec(m.time) });
    }
  }
  for (const n of trade.newsEvents ?? []) {
    events.push({ kind: "NEWS", label: n.title, time: toSec(n.time) });
  }
  events.sort((a, b) => a.time - b.time);

  /** Running MFE/MAE from bar extremes up to the cursor (R units). */
  const extremesUpTo = (idx: number): { mfeR: number; maeR: number } => {
    if (riskPerUnit == null || riskPerUnit === 0) return { mfeR: 0, maeR: 0 };
    let best = -Infinity;
    let worst = Infinity;
    for (let i = entryIdx; i <= idx; i += 1) {
      const h = Number(sorted[i].high);
      const l = Number(sorted[i].low);
      if (long) {
        best = Math.max(best, h);
        worst = Math.min(worst, l);
      } else {
        best = Math.max(best, entryPrice - (l - entryPrice)); // mirrored: favorable = entry − low
        worst = Math.min(worst, entryPrice - (h - entryPrice));
      }
    }
    // LONG: favorable = high − entry ; adverse = entry − low
    const fav = long ? best - entryPrice : best - entryPrice;
    const adv = long ? entryPrice - worst : worst - entryPrice;
    return {
      mfeR: Number((fav / riskPerUnit).toFixed(4)),
      maeR: Number((adv / riskPerUnit).toFixed(4)),
    };
  };

  /** Does bar idx touch both SL and TP (intrabar ambiguity)? */
  const touchesBoth = (idx: number, sl: number | null): boolean => {
    if (sl == null || tp == null) return false;
    const h = Number(sorted[idx].high);
    const l = Number(sorted[idx].low);
    if (long) return l <= sl && h >= tp;
    return h >= sl && l <= tp;
  };

  const initialCursor = Math.max(
    0,
    entryIdx - (options.preEntryBars ?? 0)
  );

  const snapshot = (state: ReplayState): ReplaySnapshot => {
    const cursor = Math.min(state.cursor, sorted.length - 1);
    const visible = sorted.slice(0, cursor + 1);
    const candle = cursor >= 0 ? sorted[cursor] : null;
    const nowSec = candle != null ? candle.time + tfSec : 0;

    const reachedEntry = cursor >= entryIdx;
    const reachedExit = exitIdx != null && cursor >= exitIdx;
    const inTrade = reachedEntry && !reachedExit;
    const preEntry = !reachedEntry;

    // Position panel.
    let position: ReplaySnapshot["position"] = null;
    if (reachedEntry && riskPerUnit != null && riskPerUnit > 0) {
      const currentSl = slAt(trade, nowSec);
      const price = candle != null ? Number(candle.close) : entryPrice;
      const signed = long ? price - entryPrice : entryPrice - price;
      const pips = signed / pipSize;
      const r = signed / riskPerUnit;
      const { mfeR, maeR } = extremesUpTo(cursor);
      const distSl =
        currentSl != null
          ? Math.abs(price - currentSl) / pipSize
          : null;
      const distTp =
        tp != null
          ? Math.abs(tp - price) / pipSize
          : null;
      position = {
        entryPrice,
        price,
        pips: Number(pips.toFixed(1)),
        rMultiple: Number(r.toFixed(3)),
        mfeR,
        maeR,
        currentSl,
        distanceToSlPips: distSl != null ? Number(distSl.toFixed(1)) : null,
        distanceToTpPips: distTp != null ? Number(distTp.toFixed(1)) : null,
      };
    }

    // Events reached.
    const eventsReached = events.filter((e) => e.time <= nowSec);

    // Ambiguity flag over all visible bars since entry.
    let ambiguous = false;
    if (reachedEntry) {
      for (let i = entryIdx; i <= cursor && !ambiguous; i += 1) {
        const sl = slAt(trade, sorted[i].time + tfSec);
        if (touchesBoth(i, sl)) ambiguous = true;
      }
    }

    return {
      state: { ...state, cursor },
      visible,
      candle,
      inTrade,
      closed: reachedExit,
      preEntry,
      position,
      events: eventsReached,
      slTpBothTouched: ambiguous,
      timeInTradeSec: reachedEntry ? Math.max(0, nowSec - (sorted[entryIdx].time + tfSec) + tfSec) : 0,
    };
  };

  return {
    candles: sorted,
    entryIdx,
    exitIdx,
    /** MFE/MAE bar indices (for the jump buttons). */
    mfeIdx: (() => {
      if (riskPerUnit == null || riskPerUnit === 0) return null;
      let best = -Infinity;
      let bestIdx: number | null = null;
      for (let i = entryIdx; exitIdx != null ? i <= exitIdx : i < sorted.length; i += 1) {
        const v = long ? Number(sorted[i].high) : entryPrice - (Number(sorted[i].low) - entryPrice);
        if (v > best) {
          best = v;
          bestIdx = i;
        }
      }
      return bestIdx;
    })(),
    maeIdx: (() => {
      if (riskPerUnit == null || riskPerUnit === 0) return null;
      let worst = Infinity;
      let worstIdx: number | null = null;
      for (let i = entryIdx; exitIdx != null ? i <= exitIdx : i < sorted.length; i += 1) {
        const v = long ? Number(sorted[i].low) : entryPrice + (entryPrice - Number(sorted[i].high));
        if (v < worst) {
          worst = v;
          worstIdx = i;
        }
      }
      return worstIdx;
    })(),
    initialState: (): ReplayState => ({
      cursor: initialCursor,
      playing: false,
      speed: 1,
    }),
    step: (state: ReplayState, delta: 1 | -1): ReplayState => ({
      ...state,
      playing: false,
      cursor: Math.min(sorted.length - 1, Math.max(0, state.cursor + delta)),
    }),
    seek: (state: ReplayState, idx: number): ReplayState => ({
      ...state,
      playing: false,
      cursor: Math.min(sorted.length - 1, Math.max(0, idx)),
    }),
    setPlaying: (state: ReplayState, playing: boolean): ReplayState => ({
      ...state,
      playing,
    }),
    setSpeed: (state: ReplayState, speed: number): ReplayState => ({
      ...state,
      speed,
    }),
    snapshot,
  };
}

export type ReplayEngine = ReturnType<typeof createReplayEngine>;
