import { describe, expect, it } from "vitest";
import {
  daysUntilDeletion,
  formatMemberSince,
  formatShortDate,
  initialsFromName,
} from "@/lib/profile-helpers";

/**
 * Profile helpers — pure functions behind the profile header. No test here
 * touches the database.
 */
describe("initialsFromName", () => {
  it("takes the first letters of the first and last names", () => {
    expect(initialsFromName("Rody Bints")).toBe("RB");
    expect(initialsFromName("Rody")).toBe("R");
    expect(initialsFromName("  jean   luc  picard ")).toBe("JP");
  });

  it("falls back to a placeholder for an empty name", () => {
    expect(initialsFromName("")).toBe("?");
    expect(initialsFromName("   ")).toBe("?");
  });
});

describe("formatMemberSince", () => {
  it("renders month and year in English", () => {
    expect(formatMemberSince("2023-03-15T10:00:00.000Z")).toBe("March 2023");
    expect(formatMemberSince("2026-11-05T00:00:00.000Z")).toBe("November 2026");
  });

  it("returns an empty string for missing or invalid dates", () => {
    expect(formatMemberSince(null)).toBe("");
    expect(formatMemberSince(undefined)).toBe("");
    expect(formatMemberSince("not-a-date")).toBe("");
  });
});

describe("formatShortDate", () => {
  it("renders a short English date", () => {
    expect(formatShortDate("2026-11-17T08:11:00.000Z")).toBe("Nov 17, 2026");
  });

  it("returns an empty string for missing or invalid dates", () => {
    expect(formatShortDate(null)).toBe("");
    expect(formatShortDate("garbage")).toBe("");
  });
});

describe("daysUntilDeletion", () => {
  it("counts whole days left, 0 when past or invalid", () => {
    const inThreeDays = new Date(Date.now() + 3 * 86_400_000).toISOString();
    expect(daysUntilDeletion(inThreeDays)).toBe(3);
    expect(daysUntilDeletion(new Date(Date.now() - 1000).toISOString())).toBe(0);
    expect(daysUntilDeletion(null)).toBe(0);
    expect(daysUntilDeletion("garbage")).toBe(0);
  });
});
