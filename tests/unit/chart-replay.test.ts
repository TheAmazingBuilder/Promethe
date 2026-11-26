/**
 * v2.5 Module 2 — trade replay engine unit tests (spec §4.3, §7).
 *
 * Covers: no look-ahead (visible ≤ cursor), pre-entry mode, entry/exit bar
 * detection, floating pips/R at the cursor, running MFE/MAE, moving SL
 * (slAt), events appearing when reached, SL+TP same-bar ambiguity flag,
 * step/seek clamping, play/speed, time in trade.
 */
import { describe, expect, it } from "vitest";
import { createReplayEngine } from "@/lib/charts/replay";
import type { Candle } from "@/lib/charts/price";

const c = (time: number, o: number, h: number, l: number, cl: number): Candle => ({
  time,
  open: String(o),
  high: String(h),
  low: String(l),
  close: String(cl),
  volume: null,
});

// M5 candles from 12:00 to 13:00 (13 bars).
const BASE = Math.floor(Date.UTC(2025, 0, 15, 12) / 1000);
const candles: Candle[] = Array.from({ length: 13 }, (_, i) =>
  c(BASE + i * 300, 100 + i, 100.5 + i, 99.5 + i, 100.2 + i)
);

// Trade: LONG entry at 12:20 bar (idx 4), exit at 12:45 bar (idx 9).
const trade = {
  direction: "LONG",
  entryTime: new Date((BASE + 4 * 300 + 60) * 1000).toISOString(), // 12:21
  exitTime: new Date((BASE + 9 * 300 + 60) * 1000).toISOString(), // 12:46
  entryPrice: "104",
  exitPrice: "109",
  stopLoss: "99",
  takeProfit: "110",
  initialStopLoss: "99",
  initialTakeProfit: "110",
};

const pipSize = 0.1; // XAUUSD-ish

describe("replay — no look-ahead", () => {
  it("visible candles are exactly [0..cursor]", () => {
    const engine = createReplayEngine(candles, trade, { pipSize });
    let state = engine.initialState();
    for (let i = 0; i < 5; i += 1) {
      state = engine.step(state, 1);
      const snap = engine.snapshot(state);
      expect(snap.visible).toHaveLength(state.cursor + 1);
      expect(snap.visible[snap.visible.length - 1].time).toBe(candles[state.cursor].time);
    }
  });

  it("cursor clamps to [0, n-1]", () => {
    const engine = createReplayEngine(candles, trade, { pipSize });
    let state = engine.seek(engine.initialState(), 999);
    expect(state.cursor).toBe(candles.length - 1);
    state = engine.step(state, 1);
    expect(state.cursor).toBe(candles.length - 1);
    state = engine.seek(state, -5);
    expect(state.cursor).toBe(0);
    state = engine.step(state, -1);
    expect(state.cursor).toBe(0);
  });
});

describe("replay — pre-entry mode", () => {
  it("starts N bars before the entry bar and hides the position", () => {
    const engine = createReplayEngine(candles, trade, {
      pipSize,
      preEntryBars: 3,
    });
    const state = engine.initialState();
    expect(state.cursor).toBe(1); // entryIdx 4 − 3
    const snap = engine.snapshot(state);
    expect(snap.preEntry).toBe(true);
    expect(snap.position).toBeNull();
    expect(snap.inTrade).toBe(false);
  });

  it("default start is the entry bar", () => {
    const engine = createReplayEngine(candles, trade, { pipSize });
    expect(engine.initialState().cursor).toBe(4);
    const snap = engine.snapshot(engine.initialState());
    expect(snap.preEntry).toBe(false);
    expect(snap.inTrade).toBe(true);
  });
});

describe("replay — position panel", () => {
  it("floating pips and R at the cursor close", () => {
    const engine = createReplayEngine(candles, trade, { pipSize });
    // Cursor at idx 6: close = 106.2 → +2.2 points = 22 pips; risk = 104−99 = 5 → R = 2.2/5
    const snap = engine.snapshot(engine.seek(engine.initialState(), 6));
    expect(snap.position).not.toBeNull();
    expect(snap.position!.price).toBeCloseTo(106.2, 6);
    expect(snap.position!.pips).toBeCloseTo(22, 1);
    expect(snap.position!.rMultiple).toBeCloseTo(2.2 / 5, 2);
  });

  it("running MFE/MAE in R from bar extremes since entry", () => {
    const engine = createReplayEngine(candles, trade, { pipSize });
    // Fixture: low(i) = 99.5 + i, high(i) = 100.5 + i.
    // Idx 4..6: highs 104.5..106.5 → best 106.5 → MFE = 2.5/5 = 0.5 R;
    // lows 103.5..105.5 → worst 103.5 → MAE = (104−103.5)/5 = 0.1 R.
    const snap = engine.snapshot(engine.seek(engine.initialState(), 6));
    expect(snap.position!.mfeR).toBeCloseTo(0.5, 3);
    expect(snap.position!.maeR).toBeCloseTo(0.1, 3);
  });

  it("distances to SL/TP in pips", () => {
    const engine = createReplayEngine(candles, trade, { pipSize });
    const snap = engine.snapshot(engine.seek(engine.initialState(), 6));
    // price 106.2, SL 99 → 7.2 pts = 72 pips ; TP 110 → 3.8 pts = 38 pips
    expect(snap.position!.distanceToSlPips).toBeCloseTo(72, 1);
    expect(snap.position!.distanceToTpPips).toBeCloseTo(38, 1);
  });

  it("closed once the exit bar is reached; before it, in trade", () => {
    const engine = createReplayEngine(candles, trade, { pipSize });
    const before = engine.snapshot(engine.seek(engine.initialState(), 8));
    expect(before.closed).toBe(false);
    expect(before.inTrade).toBe(true);
    const after = engine.snapshot(engine.seek(engine.initialState(), 9));
    expect(after.closed).toBe(true);
    expect(after.inTrade).toBe(false);
  });

  it("SHORT mirrors pips and MFE/MAE", () => {
    const shortTrade = {
      ...trade,
      direction: "SHORT" as const,
      initialStopLoss: "109",
      stopLoss: "109",
    };
    const engine = createReplayEngine(candles, shortTrade, { pipSize });
    // SHORT entry 104: at idx 6 close 106.2 → adverse → pips = −22; risk 5 → R = −0.44
    const snap = engine.snapshot(engine.seek(engine.initialState(), 6));
    expect(snap.position!.pips).toBeCloseTo(-22, 1);
    expect(snap.position!.rMultiple).toBeCloseTo(-2.2 / 5, 2);
  });
});

describe("replay — moving SL and events", () => {
  it("the current SL follows TradeModification steps", () => {
    const movedTrade = {
      ...trade,
      modifications: [
        {
          time: new Date((BASE + 6 * 300 + 60) * 1000).toISOString(), // 12:31 (idx 6 bar)
          field: "STOP_LOSS",
          oldValue: "99",
          newValue: "102",
        },
      ],
    };
    const engine = createReplayEngine(candles, movedTrade, { pipSize });
    const before = engine.snapshot(engine.seek(engine.initialState(), 5));
    expect(before.position!.currentSl).toBe(99);
    const after = engine.snapshot(engine.seek(engine.initialState(), 6));
    expect(after.position!.currentSl).toBe(102);
    expect(after.position!.distanceToSlPips).toBeCloseTo(42, 1); // 106.2 − 102
  });

  it("events appear when their bar is reached", () => {
    const eventful = {
      ...trade,
      executions: [
        { type: "ENTRY", time: trade.entryTime, price: "104", lots: "1" },
        {
          type: "PARTIAL_EXIT",
          time: new Date((BASE + 7 * 300 + 60) * 1000).toISOString(),
          price: "107",
          lots: "0.5",
        },
      ],
      newsEvents: [
        {
          title: "CPI",
          time: new Date((BASE + 8 * 300 + 60) * 1000).toISOString(),
          importance: "HIGH",
        },
      ],
    };
    const engine = createReplayEngine(candles, eventful, { pipSize });
    const at6 = engine.snapshot(engine.seek(engine.initialState(), 6));
    expect(at6.events.map((e) => e.kind)).toEqual(["ENTRY"]);
    const at7 = engine.snapshot(engine.seek(engine.initialState(), 7));
    expect(at7.events.map((e) => e.kind)).toEqual(["ENTRY", "PARTIAL_EXIT"]);
    const at8 = engine.snapshot(engine.seek(engine.initialState(), 8));
    expect(at8.events.map((e) => e.kind)).toEqual(["ENTRY", "PARTIAL_EXIT", "NEWS"]);
  });
});

describe("replay — intrabar ambiguity", () => {
  it("flags when a visible bar touches both SL and TP", () => {
    // One violent bar: low 98 (≤ SL 99) AND high 111 (≥ TP 110).
    const wild = [...candles];
    wild[6] = c(BASE + 6 * 300, 105, 111, 98, 106);
    const engine = createReplayEngine(wild, trade, { pipSize });
    const before = engine.snapshot(engine.seek(engine.initialState(), 5));
    expect(before.slTpBothTouched).toBe(false);
    const at6 = engine.snapshot(engine.seek(engine.initialState(), 6));
    expect(at6.slTpBothTouched).toBe(true);
  });

  it("no flag when SL/TP are never both touched", () => {
    const engine = createReplayEngine(candles, trade, { pipSize });
    const snap = engine.snapshot(engine.seek(engine.initialState(), 12));
    expect(snap.slTpBothTouched).toBe(false);
  });
});

describe("replay — play / speed / time in trade", () => {
  it("setPlaying and setSpeed are pure state transitions", () => {
    const engine = createReplayEngine(candles, trade, { pipSize });
    let state = engine.initialState();
    expect(state.playing).toBe(false);
    state = engine.setPlaying(state, true);
    expect(state.playing).toBe(true);
    state = engine.setSpeed(state, 10);
    expect(state.speed).toBe(10);
    // step pauses playback.
    state = engine.step(state, 1);
    expect(state.playing).toBe(false);
  });

  it("time in trade counts from the entry bar", () => {
    const engine = createReplayEngine(candles, trade, { pipSize });
    const atEntry = engine.snapshot(engine.initialState());
    expect(atEntry.timeInTradeSec).toBe(300); // one full M5 bar
    const at6 = engine.snapshot(engine.seek(engine.initialState(), 6));
    expect(at6.timeInTradeSec).toBe(3 * 300); // entry idx 4 → idx 6 = 3 bars
    const pre = createReplayEngine(candles, trade, { pipSize, preEntryBars: 2 });
    expect(pre.snapshot(pre.initialState()).timeInTradeSec).toBe(0);
  });

  it("mfeIdx / maeIdx point at the extreme bars (jump buttons)", () => {
    const engine = createReplayEngine(candles, trade, { pipSize });
    expect(engine.mfeIdx).toBe(9); // highest high within the trade
    expect(engine.maeIdx).toBe(4); // lowest low = entry bar (99.5)
    expect(engine.entryIdx).toBe(4);
    expect(engine.exitIdx).toBe(9);
  });

  it("throws on empty candles", () => {
    expect(() => createReplayEngine([], trade, { pipSize })).toThrow("NO_CANDLES");
  });
});

describe("replay — wrong-side stop (Lot 1, MD §3.2)", () => {
  it("a LONG stop above entry yields no risk unit and no position panel", () => {
    // Regression: Math.abs(entry − SL) used to turn a wrong-side stop
    // into a positive risk unit, so R multiples were reported off it.
    const wrongSide = {
      ...trade,
      stopLoss: "110",
      initialStopLoss: "110",
    };
    const engine = createReplayEngine(candles, wrongSide, { pipSize });
    const snap = engine.snapshot(engine.seek(engine.initialState(), 6));
    expect(snap.inTrade).toBe(true);
    expect(snap.position).toBeNull();
    expect(engine.mfeIdx).toBeNull();
    expect(engine.maeIdx).toBeNull();
  });

  it("a SHORT stop below entry yields no risk unit either", () => {
    const wrongSide = {
      ...trade,
      direction: "SHORT" as const,
      stopLoss: "99",
      initialStopLoss: "99",
    };
    const engine = createReplayEngine(candles, wrongSide, { pipSize });
    const snap = engine.snapshot(engine.seek(engine.initialState(), 6));
    expect(snap.position).toBeNull();
  });

  it("a stop equal to entry yields no risk unit", () => {
    const equal = { ...trade, stopLoss: "104", initialStopLoss: "104" };
    const engine = createReplayEngine(candles, equal, { pipSize });
    const snap = engine.snapshot(engine.seek(engine.initialState(), 6));
    expect(snap.position).toBeNull();
  });
});
