/**
 * Lot 11 (roadmap §15) - Gaïa version text diff.
 *
 * The version dialog used to offer only a blind Restore. diffGaiaText
 * compares the plain-text lines of a version against the current note so
 * the dialog can show what restoring would change.
 */
import { describe, expect, it } from "vitest";
import { diffGaiaText } from "@/lib/gaia/version-diff";

describe("diffGaiaText", () => {
  it("reports added and removed lines, counts shared lines", () => {
    const diff = diffGaiaText(
      "Line one\nLine two\nLine three",
      "Line one\nLine two changed\nLine four",
    );
    expect(diff.added).toEqual(["Line two changed", "Line four"]);
    expect(diff.removed).toEqual(["Line two", "Line three"]);
    expect(diff.unchanged).toBe(1);
  });

  it("reports no change for identical text", () => {
    const diff = diffGaiaText("A\nB", "A\nB");
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.unchanged).toBe(2);
  });

  it("ignores blank lines and surrounding whitespace", () => {
    const diff = diffGaiaText("A\n\n  B  \n", "A\nB");
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.unchanged).toBe(2);
  });

  it("does not report a line that only moved", () => {
    const diff = diffGaiaText("A\nB\nC", "C\nA\nB");
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.unchanged).toBe(3);
  });

  it("counts duplicate lines with multiplicity", () => {
    const diff = diffGaiaText("A\nA\nB", "A\nB");
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual(["A"]);
    expect(diff.unchanged).toBe(2);
  });

  it("handles an empty version (everything removed)", () => {
    const diff = diffGaiaText("A\nB", "");
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual(["A", "B"]);
    expect(diff.unchanged).toBe(0);
  });
});
