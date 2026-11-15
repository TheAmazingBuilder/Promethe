/**
 * Unit tests — UTC session detection boundaries (documented ranges,
 * DST intentionally not applied).
 */
import { describe, expect, it } from "vitest";
import { detectSession, detectSessionSafe } from "@/lib/trading/session";

function utc(hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 0, 15, hour, minute, 0));
}

describe("detectSession", () => {
  it("boundaries: [0,7) ASIAN", () => {
    expect(detectSession(utc(0))).toBe("ASIAN");
    expect(detectSession(utc(6, 59))).toBe("ASIAN");
  });
  it("boundaries: [7,12) LONDON", () => {
    expect(detectSession(utc(7))).toBe("LONDON");
    expect(detectSession(utc(11, 59))).toBe("LONDON");
  });
  it("boundaries: [12,16) OVERLAP (priority)", () => {
    expect(detectSession(utc(12))).toBe("OVERLAP");
    expect(detectSession(utc(15, 59))).toBe("OVERLAP");
  });
  it("boundaries: [16,21) NEW_YORK", () => {
    expect(detectSession(utc(16))).toBe("NEW_YORK");
    expect(detectSession(utc(20, 59))).toBe("NEW_YORK");
  });
  it("boundaries: [21,24) OTHER", () => {
    expect(detectSession(utc(21))).toBe("OTHER");
    expect(detectSession(utc(23, 59))).toBe("OTHER");
  });
});

describe("detectSessionSafe", () => {
  it("accepts ISO strings and epochs", () => {
    expect(detectSessionSafe("2026-01-15T13:00:00Z")).toBe("OVERLAP");
    expect(detectSessionSafe(Date.UTC(2026, 0, 15, 8))).toBe("LONDON");
  });
  it("returns null on invalid input", () => {
    expect(detectSessionSafe("not-a-date")).toBeNull();
    expect(detectSessionSafe(null)).toBeNull();
    expect(detectSessionSafe(undefined)).toBeNull();
  });
});
