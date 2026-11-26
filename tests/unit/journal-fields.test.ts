import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../src/components/journal/journal-fields.tsx", import.meta.url),
  "utf8"
);

describe("Journal reusable field controls", () => {
  it("exports the score and section heading controls used by the Journal page", () => {
    expect(source).toContain("export function ScorePicker");
    expect(source).toContain("export function ScalePicker");
    expect(source).toContain("export function SectionHeading");
  });

  it("keeps accessible labels and pressed states on score controls", () => {
    expect(source).toContain('role="group" aria-label={label}');
    expect(source).toContain("aria-pressed={active}");
    expect(source).toContain("aria-pressed={value === score}");
  });
});
