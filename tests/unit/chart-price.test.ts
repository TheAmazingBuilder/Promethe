/**
 * v2.5 Module 2 — price chart helpers unit tests (spec §4.2, §7).
 *
 * Covers: resample (UTC bucketing, OHLCV merge, gaps/weekends, DST-safe by
 * construction), coverage boundaries, trade overlay building (markers, price
 * lines, moved-SL steps, slAt), CSV row parsing (unix s/ms, wall time with
 * declared TZ offset, ISO with explicit offset, JPY/XAUUSD digits), timezone
 * offset computation across DST.
 */
import { describe, expect, it } from "vitest";
import {
  buildTradeOverlay,
  coverage,
  finestFor,
  parseCandleRow,
  resample,
  slAt,
  tzOffsetMinutes,
  isValidTimezone,
  type Candle,
} from "@/lib/charts/price";

const c = (time: number, o: number, h: number, l: number, cl: number, v?: number): Candle => ({
  time,
  open: String(o),
  high: String(h),
  low: String(l),
  close: String(cl),
  volume: v != null ? String(v) : null,
});

describe("price — resample", () => {
  it("M1 → M5 merges OHLCV over absolute UTC buckets", () => {
    // 4 M1 bars in the same M5 bucket starting at 12:00, 1 in the next (12:05).
    const base = Math.floor(Date.UTC(2025, 0, 15, 12) / 1000); // 12:00:00
    const candles = [
      c(base, 100, 102, 99, 101, 10),
      c(base + 60, 101, 103, 100, 102, 20),
      c(base + 120, 102, 104, 101, 103, 30),
      c(base + 180, 103, 105, 102, 104, 40),
      c(base + 300, 104, 106, 103, 105, 50), // next M5 bucket (12:05)
    ];
    const m5 = resample(candles, "M5");
    expect(m5).toHaveLength(2);
    expect(m5[0].time).toBe(base);
    expect(m5[0].open).toBe("100");
    expect(m5[0].high).toBe("105");
    expect(m5[0].low).toBe("99");
    expect(m5[0].close).toBe("104");
    expect(m5[0].volume).toBe("100");
    expect(m5[1].time).toBe(base + 300);
    expect(m5[1].open).toBe("104");
  });

  it("M5 → H1 with a gap (weekend): missing buckets stay missing", () => {
    // Friday 20:55 and Monday 09:05 — no merging across the weekend.
    const fri = Math.floor(Date.UTC(2025, 0, 10, 20, 55) / 1000);
    const mon = Math.floor(Date.UTC(2025, 0, 13, 9, 5) / 1000);
    const h1 = resample([c(fri, 1, 2, 0.5, 1.5), c(mon, 3, 4, 2.5, 3.5)], "H1");
    expect(h1).toHaveLength(2);
    expect(h1[0].close).toBe("1.5");
    expect(h1[1].close).toBe("3.5");
  });

  it("resampling to the same timeframe is a stable dedupe/sort", () => {
    const base = Math.floor(Date.UTC(2025, 0, 15, 12) / 1000);
    const out = resample([c(base + 60, 1, 1, 1, 1), c(base, 2, 2, 2, 2)], "M1");
    expect(out).toHaveLength(2);
    expect(out[0].time).toBe(base);
    expect(out[1].time).toBe(base + 60);
  });

  it("volume null handling: missing volumes stay null, mixed keep the present one", () => {
    const base = Math.floor(Date.UTC(2025, 0, 15, 12) / 1000);
    const a = resample(
      [c(base, 1, 1, 1, 1, undefined), c(base + 60, 1, 1, 1, 1, 5)],
      "M5"
    );
    expect(a[0].volume).toBe("5");
    const b = resample(
      [c(base, 1, 1, 1, 1), c(base + 60, 1, 1, 1, 1)],
      "M5"
    );
    expect(b[0].volume).toBeNull();
  });

  it("finestFor picks the finest stored timeframe ≤ target", () => {
    expect(finestFor(["M5", "H1"], "M15")).toBe("M5");
    expect(finestFor(["H1", "D1"], "M15")).toBeNull();
    expect(finestFor(["M1", "M15"], "M15")).toBe("M1");
    expect(finestFor([], "H1")).toBeNull();
  });
});

describe("price — coverage", () => {
  const base = Math.floor(Date.UTC(2025, 0, 15, 12) / 1000);

  it("empty candle list has no coverage", () => {
    const cov = coverage([], base, base + 3600, "M15");
    expect(cov.count).toBe(0);
    expect(cov.first).toBeNull();
    expect(cov.coversFrom).toBe(false);
    expect(cov.coversTo).toBe(false);
  });

  it("boundaries are covered within one timeframe step", () => {
    // Window 12:00 → 13:00, candles 12:05 → 12:55 (M15 tolerance = 900s).
    const cov = coverage(
      [c(base + 300, 1, 1, 1, 1), c(base + 3300, 1, 1, 1, 1)],
      base,
      base + 3600,
      "M15"
    );
    expect(cov.coversFrom).toBe(true); // 12:05 ≤ 12:00 + 15min
    expect(cov.coversTo).toBe(true); // 12:55 ≥ 13:00 − 15min
    expect(cov.count).toBe(2);
  });

  it("detects missing boundaries and reports the max gap", () => {
    const cov = coverage(
      [c(base + 2000, 1, 1, 1, 1), c(base + 2600, 1, 1, 1, 1)],
      base,
      base + 3600,
      "M15"
    );
    expect(cov.coversFrom).toBe(false);
    expect(cov.coversTo).toBe(false);
    expect(cov.maxGapSec).toBe(600);
  });
});

describe("price — trade overlay", () => {
  const entryIso = "2025-01-15T12:00:00.000Z";
  const exitIso = "2025-01-15T14:30:00.000Z";

  it("aggregate trade: entry below (LONG), exit above, SL/TP lines", () => {
    const { markers, lines } = buildTradeOverlay({
      direction: "LONG",
      entryTime: entryIso,
      exitTime: exitIso,
      entryPrice: "2350.50",
      exitPrice: "2365.00",
      stopLoss: "2345.50",
      takeProfit: "2370.00",
      initialStopLoss: "2344.00",
      initialTakeProfit: "2370.00",
    });
    expect(markers).toHaveLength(2);
    expect(markers[0]).toMatchObject({ position: "belowBar", shape: "arrowUp" });
    expect(markers[1]).toMatchObject({ position: "aboveBar", shape: "arrowDown" });
    const titles = lines.map((l) => l.title);
    expect(titles).toContain("Entry");
    expect(titles).toContain("Initial SL");
    expect(titles).toContain("TP"); // final TP === initial TP → plain "TP"
    const slLine = lines.find((l) => l.title === "SL (final)");
    expect(slLine?.price).toBe(2345.5);
  });

  it("SHORT flips marker positions", () => {
    const { markers } = buildTradeOverlay({
      direction: "SHORT",
      entryTime: entryIso,
      exitTime: exitIso,
      entryPrice: "150.000",
      exitPrice: "149.500",
      stopLoss: "150.500",
      takeProfit: null,
      initialStopLoss: null,
      initialTakeProfit: null,
    });
    expect(markers[0].position).toBe("aboveBar");
    expect(markers[1].position).toBe("belowBar");
  });

  it("executions produce entry/add/partial/final-exit markers", () => {
    const { markers } = buildTradeOverlay({
      direction: "LONG",
      entryTime: entryIso,
      exitTime: exitIso,
      entryPrice: "100",
      exitPrice: "110",
      stopLoss: "95",
      takeProfit: null,
      initialStopLoss: null,
      initialTakeProfit: null,
      executions: [
        { type: "ENTRY", time: entryIso, price: "100", lots: "1" },
        { type: "ADD", time: "2025-01-15T12:30:00.000Z", price: "101", lots: "0.5" },
        { type: "PARTIAL_EXIT", time: "2025-01-15T13:00:00.000Z", price: "105", lots: "0.75" },
        { type: "FINAL_EXIT", time: exitIso, price: "110", lots: "0.75" },
      ],
    });
    const texts = markers.map((m) => m.text);
    expect(texts.some((t) => t.startsWith("Entry"))).toBe(true);
    expect(texts.some((t) => t.startsWith("Add"))).toBe(true);
    expect(texts.some((t) => t.startsWith("Partial"))).toBe(true);
    expect(texts.some((t) => t.startsWith("Exit"))).toBe(true);
    expect(markers).toHaveLength(4);
  });

  it("moved-SL steps become markers + slSteps, slAt walks them chronologically", () => {
    const trade = {
      direction: "LONG",
      entryTime: entryIso,
      exitTime: exitIso,
      entryPrice: "100",
      exitPrice: "110",
      stopLoss: "102",
      takeProfit: null,
      initialStopLoss: "95",
      initialTakeProfit: null,
      modifications: [
        {
          time: "2025-01-15T13:00:00.000Z",
          field: "STOP_LOSS",
          oldValue: "95",
          newValue: "99",
        },
        {
          time: "2025-01-15T14:00:00.000Z",
          field: "STOP_LOSS",
          oldValue: "99",
          newValue: "102",
        },
        {
          time: "2025-01-15T14:10:00.000Z",
          field: "TAKE_PROFIT",
          oldValue: null,
          newValue: "115",
        },
      ],
    };
    const { markers, slSteps } = buildTradeOverlay(trade);
    expect(slSteps).toEqual([
      { time: Math.floor(Date.parse("2025-01-15T13:00:00.000Z") / 1000), price: 99 },
      { time: Math.floor(Date.parse("2025-01-15T14:00:00.000Z") / 1000), price: 102 },
    ]);
    const slMarkers = markers.filter((m) => m.text.startsWith("SL →"));
    expect(slMarkers).toHaveLength(2);

    const t0 = Math.floor(Date.parse(entryIso) / 1000);
    expect(slAt(trade, t0)).toBe(95);
    expect(slAt(trade, t0 + 3700)).toBe(99); // 13:01
    expect(slAt(trade, t0 + 7300)).toBe(102); // 14:01
    expect(slAt(trade, t0 + 100000)).toBe(102);
  });

  it("news events become square markers", () => {
    const { markers } = buildTradeOverlay({
      direction: "LONG",
      entryTime: entryIso,
      exitTime: exitIso,
      entryPrice: "100",
      exitPrice: "110",
      stopLoss: "95",
      takeProfit: null,
      initialStopLoss: null,
      initialTakeProfit: null,
      newsEvents: [
        { title: "CPI", time: "2025-01-15T13:30:00.000Z", importance: "HIGH" },
      ],
    });
    expect(markers.some((m) => m.text.includes("CPI"))).toBe(true);
  });
});

describe("price — CSV row parsing", () => {
  it("unix seconds and milliseconds", () => {
    const sec = parseCandleRow(
      { time: "1736942400", open: "1", high: "2", low: "0.5", close: "1.5" },
      0
    );
    expect(sec?.timeSec).toBe(1736942400);
    const ms = parseCandleRow(
      { time: "1736942400000", open: "1", high: "2", low: "0.5", close: "1.5" },
      0
    );
    expect(ms?.timeSec).toBe(1736942400);
  });

  it("wall time with declared timezone offset (UTC−5 → UTC)", () => {
    // 2025-01-15 14:30 in America/Toronto (EST, UTC−5) = 19:30 UTC.
    const row = parseCandleRow(
      { time: "2025-01-15 14:30", open: "1", high: "2", low: "0.5", close: "1.5" },
      -300
    );
    expect(row?.timeSec).toBe(Math.floor(Date.UTC(2025, 0, 15, 19, 30) / 1000));
  });

  it("ISO with explicit Z ignores the declared offset", () => {
    const row = parseCandleRow(
      { time: "2025-01-15T14:30:00Z", open: "1", high: "2", low: "0.5", close: "1.5" },
      -300
    );
    expect(row?.timeSec).toBe(Math.floor(Date.UTC(2025, 0, 15, 14, 30) / 1000));
  });

  it("JPY-style 3-digit and XAUUSD 2-digit decimals pass through as strings", () => {
    const jpy = parseCandleRow(
      { time: "1736942400", open: "150.123", high: "150.456", low: "149.987", close: "150.234", volume: "12" },
      0
    );
    expect(jpy?.open).toBe("150.123");
    const xau = parseCandleRow(
      { time: "1736942400", open: "2350.50", high: "2360.25", low: "2345.10", close: "2355.75" },
      0
    );
    expect(xau?.high).toBe("2360.25");
    expect(xau?.volume).toBeNull();
  });

  it("invalid rows return null", () => {
    expect(parseCandleRow({ time: "not a date", open: "1", high: "2", low: "0.5", close: "1.5" }, 0)).toBeNull();
    expect(parseCandleRow({ time: "1736942400", open: "x", high: "2", low: "0.5", close: "1.5" }, 0)).toBeNull();
    expect(parseCandleRow({ open: "1", high: "2", low: "0.5", close: "1.5" }, 0)).toBeNull();
  });
});

describe("price — timezone offsets", () => {
  it("America/Toronto offset flips across DST (EST −300 → EDT −240)", () => {
    const jan = tzOffsetMinutes("America/Toronto", Date.UTC(2025, 0, 15));
    const jul = tzOffsetMinutes("America/Toronto", Date.UTC(2025, 6, 15));
    expect(jan).toBe(-300);
    expect(jul).toBe(-240);
  });

  it("Europe/Paris (CET +60 → CEST +120)", () => {
    expect(tzOffsetMinutes("Europe/Paris", Date.UTC(2025, 0, 15))).toBe(60);
    expect(tzOffsetMinutes("Europe/Paris", Date.UTC(2025, 6, 15))).toBe(120);
  });

  it("validates timezone strings", () => {
    expect(isValidTimezone("America/Toronto")).toBe(true);
    expect(isValidTimezone("+02:00")).toBe(true);
    expect(isValidTimezone("Not/AZone")).toBe(false);
  });
});
