import { describe, expect, it } from "vitest";
import { monthRange } from "@/server/reports";

describe("monthRange", () => {
  it("uses local month boundaries in Toronto", () => {
    expect(monthRange("2026-01", "America/Toronto")).toEqual([
      new Date("2026-01-01T05:00:00.000Z"),
      new Date("2026-02-01T05:00:00.000Z"),
    ]);
  });

  it("accounts for the DST offset change across a Paris month", () => {
    expect(monthRange("2026-03", "Europe/Paris")).toEqual([
      new Date("2026-02-28T23:00:00.000Z"),
      new Date("2026-03-31T22:00:00.000Z"),
    ]);
  });

  it("rejects invalid month keys", () => {
    expect(monthRange("2026-13", "America/Toronto")).toBeNull();
    expect(monthRange("not-a-month", "UTC")).toBeNull();
  });
});
