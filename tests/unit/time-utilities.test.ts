/**
 * v2.5 Module 8 — time utilities tests (§3.4).
 *
 * Covers: DST transition days in both hemispheres, the US/EU mismatch
 * weeks, "New York close" server-convention offset flips, fixed offsets
 * (half/quarter-hour zones), midnight vs NY-close trading-day assignment
 * for trades near the boundary, custom rollover, 12H/24H formatting and
 * week-start variations.
 */
import { describe, expect, it } from "vitest";
import {
  formatClock,
  formatOffsetLabel,
  nyCloseBrokerOffsetMinutes,
  offsetMinutesOfTz,
  weekdayIndexWithWeekStart,
  zonedClock,
  zonedDate,
  zonedParts,
} from "@/lib/time/zones";
import {
  addDaysToDayKey,
  getTradingDay,
  tradingDayStartUtc,
} from "@/lib/time/trading-day";
import {
  brokerClock,
  brokerDate,
  brokerOffsetMinutes,
  brokerWallClockToUtc,
  brokerZoneLabel,
} from "@/lib/time/broker-time";

/** 2024 reference dates: US DST starts Mar 10 (02:00 local), ends Nov 3.
 *  EU: Mar 31 / Oct 27. Australia (southern): ends Apr 7, starts Oct 6. */

describe("offsetMinutesOfTz — DST transitions", () => {
  it("America/New_York flips −300 ↔ −240 across 2024-03-10 02:00", () => {
    const before = new Date("2024-03-10T06:59:59Z"); // 01:59 EST
    const after = new Date("2024-03-10T07:00:00Z"); // 03:00 EDT
    expect(offsetMinutesOfTz(before, "America/New_York")).toBe(-300);
    expect(offsetMinutesOfTz(after, "America/New_York")).toBe(-240);
  });

  it("America/New_York flips back across 2024-11-03 06:00 UTC", () => {
    const before = new Date("2024-11-03T05:59:59Z"); // 01:59 EDT
    const after = new Date("2024-11-03T06:00:00Z"); // 01:00 EST (fall back)
    expect(offsetMinutesOfTz(before, "America/New_York")).toBe(-240);
    expect(offsetMinutesOfTz(after, "America/New_York")).toBe(-300);
  });

  it("Europe/Paris flips +60 ↔ +120 across 2024-03-31 (EU date, not US)", () => {
    // Mar 30 23:00 UTC = Mar 31 00:00 CET (before flip at 01:00 UTC)
    const before = new Date("2024-03-31T00:59:59Z");
    const after = new Date("2024-03-31T01:00:00Z");
    expect(offsetMinutesOfTz(before, "Europe/Paris")).toBe(60);
    expect(offsetMinutesOfTz(after, "Europe/Paris")).toBe(120);
  });

  it("US/EU mismatch week: US already on DST while Paris still on CET", () => {
    const mismatch = new Date("2024-03-24T12:00:00Z"); // between Mar 10 and Mar 31
    expect(offsetMinutesOfTz(mismatch, "Europe/Paris")).toBe(60);
    expect(offsetMinutesOfTz(mismatch, "America/New_York")).toBe(-240);
    // After the EU flip both are on summer time again.
    const april = new Date("2024-04-24T12:00:00Z");
    expect(offsetMinutesOfTz(april, "Europe/Paris")).toBe(120);
  });

  it("Southern hemisphere: Sydney +1100 ↔ +1000 (Apr 7 / Oct 6, 2024)", () => {
    const before = new Date("2024-04-06T15:59:59Z");
    const after = new Date("2024-04-06T16:00:00Z");
    expect(offsetMinutesOfTz(before, "Australia/Sydney")).toBe(660);
    expect(offsetMinutesOfTz(after, "Australia/Sydney")).toBe(600);
    const spring = new Date("2024-10-05T16:00:00Z");
    expect(offsetMinutesOfTz(spring, "Australia/Sydney")).toBe(660);
  });

  it("half/quarter-hour fixed-offset zones", () => {
    expect(offsetMinutesOfTz(new Date("2024-06-01T12:00:00Z"), "Asia/Kolkata")).toBe(330);
    expect(offsetMinutesOfTz(new Date("2024-06-01T12:00:00Z"), "Asia/Kathmandu")).toBe(345);
    expect(offsetMinutesOfTz(new Date("2024-06-01T12:00:00Z"), "Pacific/Chatham")).toBe(765);
  });

  it("formatOffsetLabel renders compact labels", () => {
    expect(formatOffsetLabel(120)).toBe("GMT+2");
    expect(formatOffsetLabel(-300)).toBe("GMT−5");
    expect(formatOffsetLabel(330)).toBe("GMT+5:30");
    expect(formatOffsetLabel(0)).toBe("GMT+0");
  });
});

describe("New York close broker convention", () => {
  it("server offset = NY offset + 7h (GMT+2 winter, GMT+3 summer)", () => {
    const winter = new Date("2024-01-15T12:00:00Z"); // NY on EST
    const summer = new Date("2024-07-15T12:00:00Z"); // NY on EDT
    expect(nyCloseBrokerOffsetMinutes(winter)).toBe(120); // GMT+2
    expect(nyCloseBrokerOffsetMinutes(summer)).toBe(180); // GMT+3
  });

  it("flips exactly at the US DST transition (not the EU one)", () => {
    // 2024-03-10: US enters EDT — server jumps GMT+2 → GMT+3.
    const before = new Date("2024-03-10T06:59:59Z");
    const after = new Date("2024-03-10T07:00:00Z");
    expect(nyCloseBrokerOffsetMinutes(before)).toBe(120);
    expect(nyCloseBrokerOffsetMinutes(after)).toBe(180);
    // EU transition week does NOT move the server (already +3 since Mar 10).
    const euFlip = new Date("2024-03-31T01:00:00Z");
    expect(nyCloseBrokerOffsetMinutes(euFlip)).toBe(180);
  });

  it("server midnight = 17:00 New York every day of the year", () => {
    // For each wall date D, find the instant where the NY-close server shows
    // 00:00 (minute solver around Date.UTC(D)), then assert NY shows 17:00.
    const config = { mode: "NY_CLOSE" } as const;
    for (const iso of [
      "2024-01-15",
      "2024-03-09", // day before US spring-forward
      "2024-03-10", // day of US spring-forward
      "2024-06-21",
      "2024-11-02", // day before US fall-back
      "2024-11-03", // day of US fall-back
      "2024-12-25",
    ]) {
      const noon = new Date(`${iso}T12:00:00Z`).getTime();
      let serverMidnight = noon;
      for (let t = noon - 26 * 3600 * 1000; t <= noon; t += 60 * 1000) {
        if (brokerClock(config, new Date(t)) === "00:00") {
          serverMidnight = t;
          break;
        }
      }
      const ny = zonedClock(new Date(serverMidnight), "America/New_York");
      expect(ny, `${iso} server midnight → NY ${ny}`).toBe("17:00");
    }
  });
});

describe("zoned parts & formatting", () => {
  it("zonedParts/zonedDate/zonedClock are consistent in a given zone", () => {
    const t = new Date("2024-05-15T14:32:00Z");
    const p = zonedParts(t, "Europe/Paris");
    expect([p.year, p.month, p.day]).toEqual([2024, 5, 15]);
    expect(p.hour).toBe(16);
    expect(p.minute).toBe(32);
    expect(zonedDate(t, "Europe/Paris")).toBe("2024-05-15");
    expect(zonedClock(t, "Europe/Paris")).toBe("16:32");
    expect(zonedClock(t, "America/New_York")).toBe("10:32");
  });

  it("formatClock honors 12H/24H/LOCALE", () => {
    expect(formatClock(14, 32, "24H", "en")).toBe("14:32");
    expect(formatClock(14, 32, "12H", "en")).toBe("2:32 PM");
    expect(formatClock(0, 5, "12H", "en")).toBe("12:05 AM");
    expect(formatClock(0, 5, "24H", "en")).toBe("00:05");
    expect(formatClock(13, 0, "LOCALE", "en-CA")).toBe("1:00 PM");
    expect(formatClock(13, 0, "LOCALE", "en")).toBe("1:00 PM");
  });

  it("weekdayIndexWithWeekStart supports Monday/Sunday/Saturday starts", () => {
    // 2024-05-15 is a Wednesday.
    expect(weekdayIndexWithWeekStart("2024-05-15", 1)).toBe(2); // Mon start
    expect(weekdayIndexWithWeekStart("2024-05-15", 0)).toBe(3); // Sun start
    expect(weekdayIndexWithWeekStart("2024-05-15", 6)).toBe(4); // Sat start
  });
});

describe("getTradingDay — rollover modes", () => {
  const USER_TZ = "Europe/Paris";

  it("MIDNIGHT_LOCAL = calendar date in the user zone (legacy behaviour)", () => {
    expect(
      getTradingDay(new Date("2024-05-15T22:30:00Z"), USER_TZ, {
        mode: "MIDNIGHT_LOCAL",
      })
    ).toBe("2024-05-16"); // 00:30 Paris
    expect(
      getTradingDay(new Date("2024-05-15T21:59:59Z"), USER_TZ, {
        mode: "MIDNIGHT_LOCAL",
      })
    ).toBe("2024-05-15"); // 23:59 Paris
  });

  it("NEW_YORK_CLOSE: trades at/after 17:00 NY belong to the NEXT day", () => {
    const justBefore = new Date("2024-05-15T20:59:59Z"); // 16:59 NY
    const atClose = new Date("2024-05-15T21:00:00Z"); // 17:00 NY
    const lateNight = new Date("2024-05-15T23:30:00Z"); // 19:30 NY
    const earlyMorning = new Date("2024-05-15T13:00:00Z"); // 09:00 NY
    const settings = { mode: "NEW_YORK_CLOSE" } as const;
    expect(getTradingDay(justBefore, USER_TZ, settings)).toBe("2024-05-15");
    expect(getTradingDay(atClose, USER_TZ, settings)).toBe("2024-05-16");
    expect(getTradingDay(lateNight, USER_TZ, settings)).toBe("2024-05-16");
    expect(getTradingDay(earlyMorning, USER_TZ, settings)).toBe("2024-05-15");
  });

  it("NEW_YORK_CLOSE across the US DST flip stays consistent", () => {
    // 2024-11-03: 17:00 EST = 22:00 UTC (the week before it was 21:00 UTC).
    const atClose = new Date("2024-11-03T22:00:00Z"); // exactly 17:00 EST
    expect(getTradingDay(atClose, USER_TZ, { mode: "NEW_YORK_CLOSE" })).toBe(
      "2024-11-04"
    );
    const before = new Date("2024-11-03T21:59:59Z"); // 16:59 EDT (still)
    expect(getTradingDay(before, USER_TZ, { mode: "NEW_YORK_CLOSE" })).toBe(
      "2024-11-03"
    );
  });

  it("CUSTOM rollover at a chosen time and zone", () => {
    const settings = {
      mode: "CUSTOM",
      rolloverTime: "06:00",
      rolloverTimezone: "Asia/Tokyo",
    };
    // Trading day D = (06:00 Tokyo on D−1, 06:00 Tokyo on D].
    // 2024-05-14T20:30Z = Tokyo May 15 05:30 → day 2024-05-15.
    expect(getTradingDay(new Date("2024-05-14T20:30:00Z"), "UTC", settings)).toBe(
      "2024-05-15"
    );
    // 2024-05-14T21:00Z = Tokyo May 15 06:00 (at the rollover) → day 16.
    expect(getTradingDay(new Date("2024-05-14T21:00:00Z"), "UTC", settings)).toBe(
      "2024-05-16"
    );
    // 2024-05-13T21:00Z = Tokyo May 14 06:00 → day 15 (start of day 15).
    expect(getTradingDay(new Date("2024-05-13T21:00:00Z"), "UTC", settings)).toBe(
      "2024-05-15"
    );
  });

  it("incomplete CUSTOM config falls back to midnight local (never throws)", () => {
    expect(
      getTradingDay(new Date("2024-05-15T22:30:00Z"), USER_TZ, {
        mode: "CUSTOM",
        rolloverTime: null,
        rolloverTimezone: null,
      })
    ).toBe("2024-05-16");
  });

  it("addDaysToDayKey crosses month/year boundaries", () => {
    expect(addDaysToDayKey("2024-01-31", 1)).toBe("2024-02-01");
    expect(addDaysToDayKey("2024-12-31", 1)).toBe("2025-01-01");
    expect(addDaysToDayKey("2024-03-01", -1)).toBe("2024-02-29"); // leap year
  });

  it("tradingDayStartUtc inverts getTradingDay at day boundaries", () => {
    for (const settings of [
      { mode: "MIDNIGHT_LOCAL" },
      { mode: "NEW_YORK_CLOSE" },
      { mode: "CUSTOM", rolloverTime: "06:00", rolloverTimezone: "Asia/Tokyo" },
    ] as const) {
      const day = "2024-05-15";
      const start = tradingDayStartUtc(day, USER_TZ, settings);
      // One millisecond before the start belongs to the previous day.
      expect(getTradingDay(new Date(start.getTime() - 1), USER_TZ, settings)).toBe(
        "2024-05-14"
      );
      // The start instant itself belongs to the day.
      expect(getTradingDay(start, USER_TZ, settings)).toBe(day);
    }
  });
});

describe("broker server time", () => {
  it("FIXED_OFFSET and IANA modes compute offsets and clocks", () => {
    const t = new Date("2024-07-15T12:00:00Z");
    expect(
      brokerOffsetMinutes({ mode: "FIXED_OFFSET", fixedOffsetMinutes: 180 }, t)
    ).toBe(180);
    expect(brokerClock({ mode: "FIXED_OFFSET", fixedOffsetMinutes: 180 }, t)).toBe(
      "15:00"
    );
    expect(
      brokerZoneLabel({ mode: "FIXED_OFFSET", fixedOffsetMinutes: 180 })
    ).toBe("GMT+3 (fixed)");
    expect(brokerClock({ mode: "IANA", timezone: "Europe/Riga" }, t)).toBe("15:00");
    expect(brokerZoneLabel({ mode: "IANA", timezone: "Europe/Riga" })).toBe(
      "Europe/Riga"
    );
    expect(brokerZoneLabel({ mode: "NY_CLOSE" })).toBe(
      "GMT+2 / GMT+3 (New York close)"
    );
  });

  it("NY_CLOSE broker clock shows GMT+3 during US summer", () => {
    const t = new Date("2024-07-15T12:00:00Z"); // UTC noon
    expect(brokerOffsetMinutes({ mode: "NY_CLOSE" }, t)).toBe(180);
    expect(brokerClock({ mode: "NY_CLOSE" }, t)).toBe("15:00");
  });

  it("brokerWallClockToUtc round-trips brokerClock", () => {
    const config = { mode: "NY_CLOSE" } as const;
    for (const iso of [
      "2024-01-15T12:00:00Z",
      "2024-03-10T07:00:00Z", // exact US spring-forward instant
      "2024-07-15T23:45:00Z",
      "2024-11-03T06:00:00Z", // exact US fall-back instant
    ]) {
      const instant = new Date(iso);
      const wall = `${brokerDate(config, instant)} ${brokerClock(config, instant)}`;
      const reconstructed = brokerWallClockToUtc(config, wall);
      expect(reconstructed, iso).not.toBeNull();
      // The reconstructed instant may differ from the original only when the
      // wall clock is ambiguous/non-existent (DST flip) — at most 1h off.
      const drift = Math.abs(
        (reconstructed as Date).getTime() - instant.getTime()
      );
      expect(drift).toBeLessThanOrEqual(60 * 60 * 1000);
    }
  });

  it("brokerWallClockToUtc rejects garbage", () => {
    expect(brokerWallClockToUtc({ mode: "IANA", timezone: "UTC" }, "not a date")).toBeNull();
    expect(brokerWallClockToUtc({ mode: "IANA", timezone: "UTC" }, "")).toBeNull();
  });
});
