/**
 * Dashboard module — period resolution unit tests (v2.5 Module 1, spec §4.7).
 *
 * Pure function coverage: preset semantics in the user's timezone (Monday
 * weeks, local calendar days), per-widget overrides (PRESET / ROLLING_DAYS /
 * ROLLING_TRADES / CUSTOM), comparison windows, DST boundaries and trade
 * filtering. All dates are fixed and explicit; no DB, no timers.
 */
import { describe, expect, it } from "vitest";
import {
  applyComparePeriod,
  applyPeriod,
  resolvePeriod,
} from "@/lib/dashboard/period";
import type {
  GlobalFilter,
  PeriodOverride,
  PeriodPreset,
  ResolvedPeriod,
} from "@/lib/dashboard/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Local calendar day (YYYY-MM-DD) of an ISO instant in `timezone`. */
function localDayOf(instant: string, timezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(instant))) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Whole days between two YYYY-MM-DD strings (b − a). */
function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000
  );
}

const globalFilter = (preset: PeriodPreset): GlobalFilter => ({
  preset,
  accountId: null,
});

const period = (over: Partial<ResolvedPeriod>): ResolvedPeriod => ({
  from: null,
  lastTrades: null,
  compareFrom: null,
  labelKey: "today",
  ...over,
});

// Fixed reference instants — America/Toronto sprang forward on 2025-03-09.
/** Wednesday 12 March 2025, 14:30 UTC (10:30 EDT in Toronto). */
const NOW_WED = new Date("2025-03-12T14:30:00Z");
/** 02:30 UTC — still March 11 in Toronto (EDT). */
const NOW_EARLY = new Date("2025-03-12T02:30:00Z");
/** Monday 02:30 UTC — still Sunday March 9 in Toronto. */
const NOW_MONDAY_UTC = new Date("2025-03-10T02:30:00Z");
/** March 1st 02:30 UTC — still February 28 in Toronto. */
const NOW_MONTH_EDGE = new Date("2025-03-01T02:30:00Z");

// ── resolvePeriod — INHERIT ──────────────────────────────────────────────────

describe("resolvePeriod — INHERIT (global preset)", () => {
  it("uses the global preset: from is the preset's local day, labelKey matches", () => {
    const cases: Array<[PeriodPreset, string]> = [
      ["today", "2025-03-12"],
      ["week", "2025-03-10"], // Monday of the Wednesday's week
      ["month", "2025-03-01"],
      ["last30", "2025-02-11"], // today − 29 → 30 days inclusive
      ["last90", "2024-12-13"], // today − 89 → 90 days inclusive
      ["ytd", "2025-01-01"],
    ];
    for (const timezone of ["UTC", "America/Toronto"]) {
      for (const [preset, expectedDay] of cases) {
        const r = resolvePeriod(globalFilter(preset), null, timezone, NOW_WED);
        expect(r.from, `${timezone}/${preset}`).not.toBeNull();
        expect(localDayOf(r.from!, timezone), `${timezone}/${preset}`).toBe(
          expectedDay
        );
        expect(r.labelKey).toBe(preset);
        expect(r.lastTrades).toBeNull();
        expect(r.compareFrom).toBeNull();
      }
    }
  });

  it("'all' resolves to no lower bound", () => {
    const r = resolvePeriod(globalFilter("all"), null, "UTC", NOW_WED);
    expect(r.from).toBeNull();
    expect(r.lastTrades).toBeNull();
    expect(r.compareFrom).toBeNull();
    expect(r.labelKey).toBe("all");
  });

  it("'week' starts Monday — a known Wednesday resolves to its Monday", () => {
    expect(new Date("2025-03-12T00:00:00Z").getUTCDay()).toBe(3); // sanity: Wednesday
    expect(new Date("2025-03-10T00:00:00Z").getUTCDay()).toBe(1); // sanity: Monday
    const r = resolvePeriod(globalFilter("week"), null, "America/Toronto", NOW_WED);
    expect(localDayOf(r.from!, "America/Toronto")).toBe("2025-03-10");
  });

  it("'month' starts on day 1 of the local month", () => {
    const r = resolvePeriod(globalFilter("month"), null, "UTC", NOW_WED);
    expect(localDayOf(r.from!, "UTC")).toBe("2025-03-01");
  });

  it("'today' resolves in the user's timezone, not UTC", () => {
    const utc = resolvePeriod(globalFilter("today"), null, "UTC", NOW_EARLY);
    const toronto = resolvePeriod(
      globalFilter("today"),
      null,
      "America/Toronto",
      NOW_EARLY
    );
    expect(localDayOf(utc.from!, "UTC")).toBe("2025-03-12");
    expect(localDayOf(toronto.from!, "America/Toronto")).toBe("2025-03-11");
  });

  it("'week' honours the timezone when UTC and local weeks differ", () => {
    // Monday 02:30 UTC = Sunday 21:30 in Toronto → Toronto is on the previous week.
    const utc = resolvePeriod(globalFilter("week"), null, "UTC", NOW_MONDAY_UTC);
    const toronto = resolvePeriod(
      globalFilter("week"),
      null,
      "America/Toronto",
      NOW_MONDAY_UTC
    );
    expect(localDayOf(utc.from!, "UTC")).toBe("2025-03-10");
    expect(localDayOf(toronto.from!, "America/Toronto")).toBe("2025-03-03");
  });

  it("'month' honours the timezone at month boundaries", () => {
    const utc = resolvePeriod(globalFilter("month"), null, "UTC", NOW_MONTH_EDGE);
    const toronto = resolvePeriod(
      globalFilter("month"),
      null,
      "America/Toronto",
      NOW_MONTH_EDGE
    );
    expect(localDayOf(utc.from!, "UTC")).toBe("2025-03-01");
    expect(localDayOf(toronto.from!, "America/Toronto")).toBe("2025-02-01");
  });

  it("compareToPrevious spans the identical duration before the period (week → previous Monday)", () => {
    const r = resolvePeriod(
      globalFilter("week"),
      { mode: "INHERIT", compareToPrevious: true },
      "UTC",
      NOW_WED
    );
    expect(localDayOf(r.from!, "UTC")).toBe("2025-03-10");
    expect(localDayOf(r.compareFrom!, "UTC")).toBe("2025-03-03");
  });

  it("compareToPrevious of 'today' compares against yesterday", () => {
    const r = resolvePeriod(
      globalFilter("today"),
      { mode: "INHERIT", compareToPrevious: true },
      "America/Toronto",
      NOW_WED
    );
    expect(localDayOf(r.compareFrom!, "America/Toronto")).toBe("2025-03-11");
  });

  it("compareToPrevious of 'month' mirrors the elapsed days of the month", () => {
    // March 1 → March 13 (today + 1) = 12 elapsed days → comparison starts 12 days before Mar 1.
    const r = resolvePeriod(
      globalFilter("month"),
      { mode: "INHERIT", compareToPrevious: true },
      "UTC",
      NOW_WED
    );
    expect(localDayOf(r.compareFrom!, "UTC")).toBe("2025-02-17");
    expect(daysBetween("2025-02-17", "2025-03-01")).toBe(12);
  });

  it("compareToPrevious of 'all' has no comparison window", () => {
    const r = resolvePeriod(
      globalFilter("all"),
      { mode: "INHERIT", compareToPrevious: true },
      "UTC",
      NOW_WED
    );
    expect(r.from).toBeNull();
    expect(r.compareFrom).toBeNull();
  });

  it("'today' lower bound must be local MIDNIGHT, not local noon", () => {
    // src/lib/dashboard/period.ts:42-55 — localDayToUtcInstant() anchors its
    // two-pass zone-offset correction at 12:00 UTC NOON instead of 00:00
    // midnight, so every resolved `from` is local noon (2025-03-12T16:00:00.000Z
    // in America/Toronto/EDT, 2025-03-12T12:00:00.000Z in UTC). This contradicts
    // the function's own doc "(year, month, day) → UTC midnight Date of that
    // LOCAL day" and the module header "'today' is the local calendar day".
    // Consequences: applyPeriod(exitTime >= from) drops trades closed between
    // local midnight and noon on the first day of every period, and `from` can
    // even lie in the future (16:00Z > now 14:30Z for Toronto at NOW_WED).
    const utc = resolvePeriod(globalFilter("today"), null, "UTC", NOW_WED);
    expect(utc.from).toBe("2025-03-12T00:00:00.000Z");
    const toronto = resolvePeriod(
      globalFilter("today"),
      null,
      "America/Toronto",
      NOW_WED
    );
    expect(toronto.from).toBe("2025-03-12T04:00:00.000Z"); // EDT (UTC−4) midnight
  });
});

// ── resolvePeriod — PRESET override ──────────────────────────────────────────

describe("resolvePeriod — PRESET override", () => {
  it("the widget preset overrides the global preset", () => {
    const override: PeriodOverride = { mode: "PRESET", preset: "month" };
    const r = resolvePeriod(globalFilter("today"), override, "UTC", NOW_WED);
    expect(r.labelKey).toBe("month");
    expect(localDayOf(r.from!, "UTC")).toBe("2025-03-01");
  });

  it("PRESET without a preset key falls back to the global preset", () => {
    const r = resolvePeriod(globalFilter("last30"), { mode: "PRESET" }, "UTC", NOW_WED);
    expect(r.labelKey).toBe("last30");
    expect(localDayOf(r.from!, "UTC")).toBe("2025-02-11");
  });
});

// ── resolvePeriod — ROLLING_DAYS ─────────────────────────────────────────────

describe("resolvePeriod — ROLLING_DAYS", () => {
  it("7 rolling days end today, inclusive (from = today − 6)", () => {
    const r = resolvePeriod(
      globalFilter("last30"),
      { mode: "ROLLING_DAYS", rollingDays: 7 },
      "UTC",
      NOW_WED
    );
    expect(r.labelKey).toBe("rollingDays");
    expect(r.lastTrades).toBeNull();
    expect(localDayOf(r.from!, "UTC")).toBe("2025-03-06");
    expect(daysBetween("2025-03-06", "2025-03-12")).toBe(6); // 7 calendar days
  });

  it("compareToPrevious covers exactly the preceding 7 days", () => {
    const r = resolvePeriod(
      globalFilter("last30"),
      { mode: "ROLLING_DAYS", rollingDays: 7, compareToPrevious: true },
      "UTC",
      NOW_WED
    );
    const fromDay = localDayOf(r.from!, "UTC");
    const compareDay = localDayOf(r.compareFrom!, "UTC");
    expect(fromDay).toBe("2025-03-06");
    expect(compareDay).toBe("2025-02-27");
    expect(daysBetween(compareDay, fromDay)).toBe(7); // [compareFrom, from) = 7 days
  });

  it("clamps rollingDays into [1, 365]", () => {
    const zero = resolvePeriod(
      globalFilter("all"),
      { mode: "ROLLING_DAYS", rollingDays: 0 },
      "UTC",
      NOW_WED
    );
    expect(localDayOf(zero.from!, "UTC")).toBe("2025-03-12"); // 1 day = today
    const huge = resolvePeriod(
      globalFilter("all"),
      { mode: "ROLLING_DAYS", rollingDays: 9999 },
      "UTC",
      NOW_WED
    );
    expect(daysBetween(localDayOf(huge.from!, "UTC"), "2025-03-12")).toBe(364); // 365 days
  });
});

// ── resolvePeriod — ROLLING_TRADES ───────────────────────────────────────────

describe("resolvePeriod — ROLLING_TRADES", () => {
  it("keeps the N most recent trades, still bounded by the global preset", () => {
    const r = resolvePeriod(
      globalFilter("today"),
      { mode: "ROLLING_TRADES", rollingTrades: 12 },
      "UTC",
      NOW_WED
    );
    expect(r.labelKey).toBe("rollingTrades");
    expect(r.lastTrades).toBe(12);
    expect(r.compareFrom).toBeNull();
    expect(localDayOf(r.from!, "UTC")).toBe("2025-03-12");
  });

  it("ROLLING_TRADES with global 'all' has no date bound", () => {
    const r = resolvePeriod(
      globalFilter("all"),
      { mode: "ROLLING_TRADES", rollingTrades: 5 },
      "UTC",
      NOW_WED
    );
    expect(r.from).toBeNull();
    expect(r.lastTrades).toBe(5);
  });
});

// ── resolvePeriod — CUSTOM ───────────────────────────────────────────────────

describe("resolvePeriod — CUSTOM", () => {
  it("respects customFrom / customTo and reports the custom label", () => {
    const r = resolvePeriod(
      globalFilter("last30"),
      { mode: "CUSTOM", customFrom: "2025-03-01", customTo: "2025-03-07" },
      "America/Toronto",
      NOW_WED
    );
    expect(r.labelKey).toBe("custom");
    expect(localDayOf(r.from!, "America/Toronto")).toBe("2025-03-01");
    expect(r.lastTrades).toBeNull();
    expect(r.compareFrom).toBeNull();
  });

  it("CUSTOM without a valid customFrom has no lower bound", () => {
    const missing = resolvePeriod(globalFilter("last30"), { mode: "CUSTOM" }, "UTC", NOW_WED);
    expect(missing.from).toBeNull();
    expect(missing.compareFrom).toBeNull();
    expect(missing.labelKey).toBe("custom");

    // Not zero-padded → rejected by the ISO day regex.
    const malformed = resolvePeriod(
      globalFilter("last30"),
      { mode: "CUSTOM", customFrom: "2025-3-1", customTo: "2025-03-07" },
      "UTC",
      NOW_WED
    );
    expect(malformed.from).toBeNull();
  });

  it("compareToPrevious mirrors the custom range immediately before it", () => {
    const r = resolvePeriod(
      globalFilter("last30"),
      {
        mode: "CUSTOM",
        customFrom: "2025-03-01",
        customTo: "2025-03-07",
        compareToPrevious: true,
      },
      "UTC",
      NOW_WED
    );
    // Range = 7 days (Mar 1 … Mar 7 inclusive) → comparison starts 7 days earlier.
    expect(localDayOf(r.compareFrom!, "UTC")).toBe("2025-02-22");
    expect(daysBetween("2025-02-22", "2025-03-01")).toBe(7);
  });

  it("compareToPrevious needs both custom bounds", () => {
    const r = resolvePeriod(
      globalFilter("last30"),
      { mode: "CUSTOM", customFrom: "2025-03-01", compareToPrevious: true },
      "UTC",
      NOW_WED
    );
    expect(r.compareFrom).toBeNull();
  });
});

// ── resolvePeriod — DST ──────────────────────────────────────────────────────

describe("resolvePeriod — DST (America/Toronto, spring forward 2025-03-09)", () => {
  it("rolling 7 days across the DST boundary still spans 7 local calendar days", () => {
    const r = resolvePeriod(
      globalFilter("last30"),
      { mode: "ROLLING_DAYS", rollingDays: 7 },
      "America/Toronto",
      NOW_WED
    );
    const todayLocal = localDayOf(NOW_WED.toISOString(), "America/Toronto");
    expect(todayLocal).toBe("2025-03-12");
    // Key invariant: the local calendar day of `from` is exactly N−1 days
    // before the local today of `now` (7 days inclusive of today).
    expect(daysBetween(localDayOf(r.from!, "America/Toronto"), todayLocal)).toBe(6);
    expect(localDayOf(r.from!, "America/Toronto")).toBe("2025-03-06");
    // The ISO date portion carries the same local day.
    expect(r.from!.slice(0, 10)).toBe("2025-03-06");
  });

  it("rolling 7 days ending on the DST day itself keeps the 7-day span", () => {
    const now = new Date("2025-03-09T12:00:00Z"); // 08:00 EDT — switch already happened
    const r = resolvePeriod(
      globalFilter("last30"),
      { mode: "ROLLING_DAYS", rollingDays: 7, compareToPrevious: true },
      "America/Toronto",
      now
    );
    expect(localDayOf(now.toISOString(), "America/Toronto")).toBe("2025-03-09");
    expect(daysBetween(localDayOf(r.from!, "America/Toronto"), "2025-03-09")).toBe(6);
    expect(localDayOf(r.from!, "America/Toronto")).toBe("2025-03-03");
    // Comparison window still covers exactly the preceding 7 days.
    expect(daysBetween(localDayOf(r.compareFrom!, "America/Toronto"), "2025-03-03")).toBe(7);
    expect(localDayOf(r.compareFrom!, "America/Toronto")).toBe("2025-02-24");
  });
});

// ── applyPeriod ──────────────────────────────────────────────────────────────

describe("applyPeriod", () => {
  const trades = [
    { id: "t1", exitTime: "2025-03-05T10:00:00.000Z" },
    { id: "t2", exitTime: "2025-03-08T22:00:00.000Z" },
    { id: "t3", exitTime: "2025-03-09T12:00:00.000Z" },
    { id: "t4", exitTime: "2025-03-10T01:00:00.000Z" },
    { id: "t5", exitTime: "2025-03-12T09:00:00.000Z" },
  ];
  const ids = (list: Array<{ id: string }>) => list.map((t) => t.id);

  it("keeps only trades closed at or after `from` (inclusive bound)", () => {
    const p = period({ from: "2025-03-09T12:00:00.000Z" });
    expect(ids(applyPeriod(trades, p))).toEqual(["t3", "t4", "t5"]); // t3 exactly at from
  });

  it("null from keeps everything", () => {
    expect(applyPeriod(trades, period({}))).toHaveLength(5);
  });

  it("lastTrades keeps the N most recent by exitTime, preserving input order", () => {
    const p = period({ lastTrades: 2 });
    expect(ids(applyPeriod(trades, p))).toEqual(["t4", "t5"]);
  });

  it("lastTrades counts from the trades remaining after the date bound", () => {
    const p = period({ from: "2025-03-06T00:00:00.000Z", lastTrades: 2 });
    expect(ids(applyPeriod(trades, p))).toEqual(["t4", "t5"]);
  });

  it("lastTrades larger than the sample is a no-op", () => {
    expect(applyPeriod(trades, period({ lastTrades: 10 }))).toHaveLength(5);
  });

  it("handles an empty trade list", () => {
    expect(applyPeriod([], period({ from: "2025-03-01T00:00:00.000Z", lastTrades: 3 }))).toEqual([]);
  });
});

// ── applyComparePeriod ───────────────────────────────────────────────────────

describe("applyComparePeriod", () => {
  const trades = [
    { id: "t1", exitTime: "2025-03-05T10:00:00.000Z" },
    { id: "t2", exitTime: "2025-03-08T22:00:00.000Z" },
    { id: "t3", exitTime: "2025-03-09T12:00:00.000Z" },
  ];
  const ids = (list: Array<{ id: string }>) => list.map((t) => t.id);
  const window = period({
    from: "2025-03-08T00:00:00.000Z",
    compareFrom: "2025-03-05T00:00:00.000Z",
  });

  it("keeps only trades inside [compareFrom, from)", () => {
    expect(ids(applyComparePeriod(trades, window))).toEqual(["t1"]);
  });

  it("the compareFrom bound is inclusive, the from bound exclusive", () => {
    const edge = [
      { id: "e1", exitTime: "2025-03-05T00:00:00.000Z" }, // exactly at compareFrom
      { id: "e2", exitTime: "2025-03-08T00:00:00.000Z" }, // exactly at from
    ];
    expect(ids(applyComparePeriod(edge, window))).toEqual(["e1"]);
  });

  it("returns [] without a comparison window or a lower bound", () => {
    expect(applyComparePeriod(trades, period({ from: "2025-03-08T00:00:00.000Z" }))).toEqual([]);
    expect(
      applyComparePeriod(trades, period({ compareFrom: "2025-03-01T00:00:00.000Z" }))
    ).toEqual([]);
  });
});
