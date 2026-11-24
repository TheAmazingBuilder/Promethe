import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../src/components/journal/journal-view.tsx", import.meta.url),
  "utf8"
);

describe("Journal section navigation", () => {
  it("keeps the sticky section navigation below the global sticky header", () => {
    expect(source).toContain("sticky top-20");
    expect(source).toContain("sm:top-16");
  });

  it("provides a matching anchor for each section in the actual page flow", () => {
    for (const id of [
      "journal-overview",
      "journal-activity",
      "journal-plan",
      "journal-charts",
      "journal-behavior",
      "journal-state",
      "journal-preparation",
      "journal-reflection",
      "journal-reviews",
      "journal-history",
    ]) {
      expect(source).toContain(`["${id}"`);
      expect(source).toContain(`id="${id}"`);
    }
    expect(source.indexOf('["journal-behavior"')).toBeLessThan(source.indexOf('["journal-state"'));
    expect(source.indexOf('["journal-state"')).toBeLessThan(source.indexOf('["journal-preparation"'));
  });

  it("does not report the daily entry as fully saved while a period review is dirty", () => {
    expect(source).toContain("Period review has unsaved changes — save it in Reviews");
    expect(source).toContain(") : periodReviewDirty ? (");
  });
});
