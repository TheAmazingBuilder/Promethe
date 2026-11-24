import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../src/components/journal/journal-view.tsx", import.meta.url),
  "utf8"
);

describe("Journal trading activity states", () => {
  it("does not present unavailable execution statistics as zero", () => {
    expect(source).toContain("Execution statistics could not be loaded.");
    expect(source).toContain("tradesLoading ? (");
    expect(source).toContain("dayActivity?.wins ?? 0");
  });

  it("distinguishes loading, errors and empty chart or behavior states", () => {
    expect(source).toContain("Chart screenshots could not be loaded.");
    expect(source).toContain("Behavioral tags could not be loaded.");
    expect(source).toContain("No chart screenshots attached to this day");
    expect(source).toContain("No mistake tags recorded in Trade Review");
  });

  it("provides a retry path for each dependent section", () => {
    expect(source).toContain("onClick={() => void refetchTrades()}");
  });
});
