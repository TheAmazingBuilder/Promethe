/**
 * Lot 1 Phase D (MD §3.7) — Market Hours DST / session status.
 *
 * This module had zero tests: all local-time math goes through
 * Intl.DateTimeFormat, so DST transitions are only correct if the
 * helpers are pinned against known transitions (London springs
 * forward 2026-03-29, falls back 2026-10-25; New York falls back
 * 2026-11-01; Sydney is on DST in January, off it in June).
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DISPLAY_SESSIONS,
  DEFAULT_DETECTION_SETTINGS,
  detectSessionFromSettings,
  displaySessions,
  formatCountdown,
  isMarketWeekend,
  mergeSessionSettings,
  openSessionNames,
  sessionStatus,
  tzOffsetMinutes,
  zonedParts,
  zonedTimeToUtc,
  type MarketSessionSettingEntry,
} from "@/lib/tools/market-hours";

const london = DEFAULT_DISPLAY_SESSIONS.find((s) => s.name === "London")!;
const newYork = DEFAULT_DISPLAY_SESSIONS.find(
  (s) => s.name === "New York"
)!;

describe("zonedParts / tzOffsetMinutes — DST", () => {
  it("London is GMT in January, BST (+60) in June", () => {
    expect(zonedParts(new Date("2026-01-15T12:00:00.000Z"), "Europe/London").hour).toBe(12);
    expect(tzOffsetMinutes(new Date("2026-01-15T12:00:00.000Z"), "Europe/London")).toBe(0);
    expect(zonedParts(new Date("2026-06-15T12:00:00.000Z"), "Europe/London").hour).toBe(13);
    expect(tzOffsetMinutes(new Date("2026-06-15T12:00:00.000Z"), "Europe/London")).toBe(60);
  });

  it("London springs forward on 2026-03-29 (01:00 UTC -> 02:00 BST)", () => {
    // 00:30 UTC is still GMT; 02:30 UTC is already 03:30 BST.
    const before = zonedParts(new Date("2026-03-29T00:30:00.000Z"), "Europe/London");
    expect(before.hour).toBe(0);
    expect(tzOffsetMinutes(new Date("2026-03-29T00:30:00.000Z"), "Europe/London")).toBe(0);
    const after = zonedParts(new Date("2026-03-29T02:30:00.000Z"), "Europe/London");
    expect(after.hour).toBe(3);
    expect(after.minute).toBe(30);
    expect(tzOffsetMinutes(new Date("2026-03-29T02:30:00.000Z"), "Europe/London")).toBe(60);
  });

  it("London falls back on 2026-10-25 (still BST at 00:30 UTC)", () => {
    const p = zonedParts(new Date("2026-10-25T00:30:00.000Z"), "Europe/London");
    expect(p.hour).toBe(1);
    expect(tzOffsetMinutes(new Date("2026-10-25T00:30:00.000Z"), "Europe/London")).toBe(60);
  });

  it("New York falls back on 2026-11-01 (EDT -240 -> EST -300)", () => {
    const before = zonedParts(new Date("2026-11-01T05:30:00.000Z"), "America/New_York");
    expect(before.hour).toBe(1);
    expect(tzOffsetMinutes(new Date("2026-11-01T05:30:00.000Z"), "America/New_York")).toBe(-240);
    const after = zonedParts(new Date("2026-11-01T07:30:00.000Z"), "America/New_York");
    expect(after.hour).toBe(2);
    expect(tzOffsetMinutes(new Date("2026-11-01T07:30:00.000Z"), "America/New_York")).toBe(-300);
  });

  it("New York is EDT in April after the spring forward", () => {
    const p = zonedParts(new Date("2026-04-05T06:30:00.000Z"), "America/New_York");
    expect(p.hour).toBe(2);
    expect(tzOffsetMinutes(new Date("2026-04-05T06:30:00.000Z"), "America/New_York")).toBe(-240);
  });

  it("Sydney is on DST (+660) in January, off it (+600) in June", () => {
    expect(tzOffsetMinutes(new Date("2026-01-15T12:00:00.000Z"), "Australia/Sydney")).toBe(660);
    expect(tzOffsetMinutes(new Date("2026-06-15T12:00:00.000Z"), "Australia/Sydney")).toBe(600);
  });

  it("reports ISO weekdays (Mon 2026-06-15 = 1, Sat 2026-06-13 = 6)", () => {
    expect(zonedParts(new Date("2026-06-15T12:00:00.000Z"), "Europe/London").weekday).toBe(1);
    expect(zonedParts(new Date("2026-06-13T12:00:00.000Z"), "Europe/London").weekday).toBe(6);
  });
});

describe("zonedTimeToUtc", () => {
  it("converts a London wall-clock time across the BST offset", () => {
    // 08:00 BST on Mon 2026-06-15 is 07:00 UTC.
    expect(
      zonedTimeToUtc(new Date("2026-06-15T12:00:00.000Z"), "Europe/London", "08:00")
    ).toBe(Date.UTC(2026, 5, 15, 7, 0));
    // 08:00 GMT on Thu 2026-01-15 is 08:00 UTC.
    expect(
      zonedTimeToUtc(new Date("2026-01-15T12:00:00.000Z"), "Europe/London", "08:00")
    ).toBe(Date.UTC(2026, 0, 15, 8, 0));
  });

  it("shifts by dayOffset in the session zone", () => {
    expect(
      zonedTimeToUtc(new Date("2026-06-15T12:00:00.000Z"), "Europe/London", "08:00", 1)
    ).toBe(Date.UTC(2026, 5, 16, 7, 0));
  });
});

describe("sessionStatus", () => {
  it("London is open Monday 13:00 BST, closing in 3.5h", () => {
    const s = sessionStatus(london, new Date("2026-06-15T12:00:00.000Z"));
    expect(s.open).toBe(true);
    expect(s.weekend).toBe(false);
    expect(s.localTime).toBe("13:00");
    expect(s.nextChangeLabel).toBe("closes");
    expect(s.nextChangeMs).toBe(3.5 * 60 * 60 * 1000);
  });

  it("London is closed at night and opens next morning (11h)", () => {
    const s = sessionStatus(london, new Date("2026-06-15T20:00:00.000Z"));
    expect(s.open).toBe(false);
    expect(s.weekend).toBe(false);
    expect(s.localTime).toBe("21:00");
    expect(s.nextChangeLabel).toBe("opens");
    expect(s.nextChangeMs).toBe(11 * 60 * 60 * 1000);
  });

  it("London is a weekend on Saturday and opens Monday 08:00 BST (43h)", () => {
    const s = sessionStatus(london, new Date("2026-06-13T12:00:00.000Z"));
    expect(s.open).toBe(false);
    expect(s.weekend).toBe(true);
    expect(s.nextChangeLabel).toBe("opens");
    expect(s.nextChangeMs).toBe(43 * 60 * 60 * 1000);
  });

  it("New York is open Monday 10:00 EDT, closing in 7h", () => {
    const s = sessionStatus(newYork, new Date("2026-06-15T14:00:00.000Z"));
    expect(s.open).toBe(true);
    expect(s.localTime).toBe("10:00");
    expect(s.nextChangeLabel).toBe("closes");
    expect(s.nextChangeMs).toBe(7 * 60 * 60 * 1000);
  });

  it("a session is open at its open time and closed at its close time", () => {
    const atOpen = sessionStatus(london, new Date("2026-06-15T07:00:00.000Z"));
    expect(atOpen.open).toBe(true);
    expect(atOpen.localTime).toBe("08:00");
    const atClose = sessionStatus(london, new Date("2026-06-15T15:30:00.000Z"));
    expect(atClose.open).toBe(false);
    expect(atClose.localTime).toBe("16:30");
  });
});

describe("openSessionNames / isMarketWeekend / formatCountdown", () => {
  it("names the sessions open at a Monday midday instant", () => {
    const statuses = displaySessions(mergeSessionSettings([])).map((s) =>
      sessionStatus(s, new Date("2026-06-15T12:00:00.000Z"))
    );
    // 12:00 UTC: Sydney closed (22:00 local), Tokyo closed (21:00),
    // London open (13:00 BST), New York open (08:00 EDT).
    expect(openSessionNames(statuses)).toEqual(["London", "New York"]);
    expect(isMarketWeekend(statuses)).toBe(false);
  });

  it("the market is on weekend when every session reports a non-active day", () => {
    const statuses = displaySessions(mergeSessionSettings([])).map((s) =>
      sessionStatus(s, new Date("2026-06-13T12:00:00.000Z"))
    );
    expect(statuses.every((s) => s.weekend)).toBe(true);
    expect(isMarketWeekend(statuses)).toBe(true);
    expect(isMarketWeekend([])).toBe(false);
  });

  it("formats countdowns as HH:MM:SS", () => {
    expect(formatCountdown(2 * 3600 * 1000 + 14 * 60 * 1000 + 33 * 1000)).toBe("02:14:33");
    expect(formatCountdown(90 * 1000)).toBe("00:01:30");
    expect(formatCountdown(0)).toBe("00:00:00");
    expect(formatCountdown(-5000)).toBe("00:00:00");
  });
});

describe("detectSessionFromSettings", () => {
  const settings = mergeSessionSettings([]);

  it("detects the legacy UTC ranges (OVERLAP has priority)", () => {
    expect(detectSessionFromSettings(new Date("2026-06-15T13:00:00.000Z"), settings)).toBe("OVERLAP");
    expect(detectSessionFromSettings(new Date("2026-06-15T08:00:00.000Z"), settings)).toBe("LONDON");
    expect(detectSessionFromSettings(new Date("2026-06-15T02:00:00.000Z"), settings)).toBe("ASIAN");
    expect(detectSessionFromSettings(new Date("2026-06-15T18:00:00.000Z"), settings)).toBe("NEW_YORK");
    expect(detectSessionFromSettings(new Date("2026-06-15T22:00:00.000Z"), settings)).toBe("OTHER");
  });

  it("keeps the built-in defaults when no user rows exist", () => {
    expect(mergeSessionSettings([])).toHaveLength(
      DEFAULT_DISPLAY_SESSIONS.length + DEFAULT_DETECTION_SETTINGS.length
    );
    expect(displaySessions(mergeSessionSettings([])).map((s) => s.name)).toEqual([
      "Sydney",
      "Tokyo",
      "London",
      "New York",
    ]);
  });

  it("a user row replaces its default by (kind, name)", () => {
    const override: MarketSessionSettingEntry = {
      ...london,
      openTime: "07:00",
      closeTime: "15:00",
    };
    const merged = mergeSessionSettings([override]);
    const replaced = merged.find((s) => s.kind === "DISPLAY" && s.name === "London")!;
    expect(replaced.openTime).toBe("07:00");
    expect(replaced.closeTime).toBe("15:00");
    expect(merged).toHaveLength(
      DEFAULT_DISPLAY_SESSIONS.length + DEFAULT_DETECTION_SETTINGS.length
    );
  });
});
