import { describe, expect, it } from "vitest";
import {
  isoDay,
  journalEntrySchema,
  journalExportQuerySchema,
  journalPeriodReviewSchema,
  journalQuerySchema,
} from "@/lib/validations/journal";

describe("Journal calendar-day validation", () => {
  it("accepts real calendar dates, including leap days", () => {
    expect(isoDay.safeParse("2024-02-29").success).toBe(true);
    expect(journalEntrySchema.safeParse({ date: "2026-11-24" }).success).toBe(true);
  });

  it("rejects impossible dates even when they match YYYY-MM-DD", () => {
    for (const date of ["2026-02-29", "2026-02-31", "2026-04-31", "2026-11-31"]) {
      expect(isoDay.safeParse(date).success).toBe(false);
      expect(journalEntrySchema.safeParse({ date }).success).toBe(false);
      expect(journalQuerySchema.safeParse({ date }).success).toBe(false);
    }
  });

  it("applies real-date validation to period reviews and export ranges", () => {
    expect(journalPeriodReviewSchema.safeParse({
      periodType: "WEEKLY",
      periodStart: "2026-02-30",
      periodEnd: "2026-03-08",
    }).success).toBe(false);

    expect(journalExportQuerySchema.safeParse({
      from: "2026-02-01",
      to: "2026-02-31",
    }).success).toBe(false);
  });
});
