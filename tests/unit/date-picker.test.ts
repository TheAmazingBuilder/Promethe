import { describe, expect, it } from "vitest";
import {
  addMonths,
  buildPickerGrid,
  clampDateToRange,
  daysInMonth,
  formatLocalDate,
  formatLocalDateTime,
  isDayDisabled,
  monthLabel,
  moveFocus,
  nowLocalDateTime,
  parseLocalDate,
  parseLocalTime,
  todayLocalDate,
  WEEKDAY_LABELS,
} from "../../src/lib/date-picker";

// ── Parsing / formatting ────────────────────────────────────────────────────

describe("parseLocalDate / formatLocalDate", () => {
  it("parses a plain date and a datetime-local value", () => {
    expect(parseLocalDate("2026-11-02")).toEqual({
      year: 2026,
      month: 11,
      day: 2,
    });
    expect(parseLocalDate("2026-11-02T09:30")).toEqual({
      year: 2026,
      month: 11,
      day: 2,
    });
  });

  it("rejects impossible dates and garbage", () => {
    expect(parseLocalDate("")).toBeNull();
    expect(parseLocalDate("2026-02-30")).toBeNull();
    expect(parseLocalDate("2026-13-01")).toBeNull();
    expect(parseLocalDate("not a date")).toBeNull();
    expect(parseLocalDate("2026-11-2")).toBeNull();
  });

  it("round-trips through formatLocalDate", () => {
    const parsed = parseLocalDate("2024-02-29");
    expect(parsed).not.toBeNull();
    expect(formatLocalDate(parsed!)).toBe("2024-02-29");
  });

  it("parses times from HH:mm and from a datetime-local value", () => {
    expect(parseLocalTime("09:30")).toEqual({ hours: 9, minutes: 30 });
    expect(parseLocalTime("2026-11-02T09:30")).toEqual({
      hours: 9,
      minutes: 30,
    });
    expect(parseLocalTime("24:00")).toBeNull();
    expect(parseLocalTime("")).toBeNull();
  });

  it("formats a datetime-local value", () => {
    expect(
      formatLocalDateTime(
        { year: 2026, month: 11, day: 2 },
        { hours: 9, minutes: 5 },
      ),
    ).toBe("2026-11-02T09:05");
  });
});

// ── Month grid (matches the reference image: November 2026) ────────────────

describe("buildPickerGrid", () => {
  it("weeks start on Monday", () => {
    expect(WEEKDAY_LABELS).toEqual([
      "MON",
      "TUE",
      "WED",
      "THU",
      "FRI",
      "SAT",
      "SUN",
    ]);
  });

  it("November 2026 matches the reference: first row Oct 26 - Nov 1", () => {
    const weeks = buildPickerGrid(2026, 11);
    expect(weeks).toHaveLength(6);
    for (const week of weeks) expect(week).toHaveLength(7);
    expect(weeks[0].map((c) => c.date)).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
    expect(weeks[0][0].inMonth).toBe(false);
    expect(weeks[0][6].inMonth).toBe(true);
    // Selected day 2 in the reference sits in the second row, first cell.
    expect(weeks[1][0].date).toBe("2026-11-02");
    expect(weeks[1][0].day).toBe(2);
    expect(weeks[1][0].inMonth).toBe(true);
    // Last row ends Dec 6, dimmed.
    expect(weeks[5].map((c) => c.date)).toEqual([
      "2026-11-30",
      "2026-12-01",
      "2026-12-02",
      "2026-12-03",
      "2026-12-04",
      "2026-12-05",
      "2026-12-06",
    ]);
    expect(weeks.flat().filter((c) => c.inMonth)).toHaveLength(30);
  });

  it("February 2024 has 29 in-month days (leap year)", () => {
    const weeks = buildPickerGrid(2024, 2);
    expect(weeks.flat().filter((c) => c.inMonth)).toHaveLength(29);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
  });

  it("January 2025 starts on a Wednesday, so 2 leading cells", () => {
    const weeks = buildPickerGrid(2025, 1);
    expect(weeks[0][0].date).toBe("2024-12-30");
    expect(weeks[0][2].date).toBe("2025-01-01");
  });

  it("flags today", () => {
    const today = todayLocalDate();
    const parsed = parseLocalDate(today)!;
    const weeks = buildPickerGrid(parsed.year, parsed.month);
    const flagged = weeks.flat().filter((c) => c.isToday);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].date).toBe(today);
  });
});

// ── Month stepping / labels ─────────────────────────────────────────────────

describe("addMonths / monthLabel", () => {
  it("rolls over the year boundary both ways", () => {
    expect(addMonths(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths(2026, 11, 2)).toEqual({ year: 2027, month: 1 });
  });

  it("labels the month in English", () => {
    expect(monthLabel(2026, 11)).toBe("November 2026");
    expect(monthLabel(2027, 1)).toBe("January 2027");
  });
});

// ── Min / max ──────────────────────────────────────────────────────────────

describe("isDayDisabled / clampDateToRange", () => {
  it("disables days outside the range, date part only", () => {
    expect(isDayDisabled("2026-11-01", "2026-11-02", "2026-11-20")).toBe(true);
    expect(isDayDisabled("2026-11-02", "2026-11-02", "2026-11-20")).toBe(false);
    expect(isDayDisabled("2026-11-20", "2026-11-02", "2026-11-20")).toBe(false);
    expect(isDayDisabled("2026-11-21", "2026-11-02", "2026-11-20")).toBe(true);
    // A datetime-local min still disables whole earlier days only.
    expect(isDayDisabled("2026-11-02", "2026-11-02T09:30")).toBe(false);
    expect(isDayDisabled("2026-11-01", "2026-11-02T09:30")).toBe(true);
  });

  it("clamps into the range", () => {
    expect(clampDateToRange("2026-10-01", "2026-11-02")).toBe("2026-11-02");
    expect(clampDateToRange("2026-12-25", undefined, "2026-11-20")).toBe(
      "2026-11-20",
    );
    expect(clampDateToRange("2026-11-10", "2026-11-02", "2026-11-20")).toBe(
      "2026-11-10",
    );
  });
});

// ── Keyboard focus movement ────────────────────────────────────────────────

describe("moveFocus", () => {
  it("arrows move a day or a week", () => {
    expect(moveFocus("2026-11-02", "ArrowRight")).toBe("2026-11-03");
    expect(moveFocus("2026-11-02", "ArrowLeft")).toBe("2026-11-01");
    expect(moveFocus("2026-11-02", "ArrowDown")).toBe("2026-11-09");
    expect(moveFocus("2026-11-09", "ArrowUp")).toBe("2026-11-02");
  });

  it("Home/End jump to the Monday/Sunday of the week", () => {
    // Nov 2 2026 is a Monday.
    expect(moveFocus("2026-11-04", "Home")).toBe("2026-11-02");
    expect(moveFocus("2026-11-04", "End")).toBe("2026-11-08");
    expect(moveFocus("2026-11-02", "End")).toBe("2026-11-08");
  });

  it("PageUp/PageDown step a month and clamp the day", () => {
    expect(moveFocus("2026-11-15", "PageDown")).toBe("2026-12-15");
    expect(moveFocus("2026-11-15", "PageUp")).toBe("2026-10-15");
    // Jan 31 -> Feb 28 (2026 is not a leap year).
    expect(moveFocus("2026-01-31", "PageDown")).toBe("2026-02-28");
    // Dec 15 -> Jan 15 next year.
    expect(moveFocus("2026-12-15", "PageDown")).toBe("2027-01-15");
  });

  it("unknown keys leave the date alone", () => {
    expect(moveFocus("2026-11-02", "Tab")).toBe("2026-11-02");
  });
});

// ── Now ────────────────────────────────────────────────────────────────────

describe("nowLocalDateTime", () => {
  it("returns a well-formed local datetime-local value", () => {
    expect(nowLocalDateTime()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(parseLocalDate(nowLocalDateTime())).not.toBeNull();
  });
});
