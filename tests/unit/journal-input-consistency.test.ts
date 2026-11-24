import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const journal = readFileSync(
  new URL("../../src/components/journal/journal-view.tsx", import.meta.url),
  "utf8"
);
const templates = readFileSync(
  new URL("../../src/components/journal/journal-template-controls.tsx", import.meta.url),
  "utf8"
);

describe("Journal input consistency", () => {
  it("uses the shared DateField for history date filters", () => {
    expect(journal).toContain('id="journal-history-from"');
    expect(journal).toContain('id="journal-history-to"');
    expect(journal).not.toContain('<Input type="date"');
  });

  it("uses the shared Select primitives for history filters", () => {
    expect(journal).toContain('aria-label="Filter by mood"');
    expect(journal).toContain('aria-label="Filter by discipline"');
    expect(journal).toContain("<SelectContent>");
    expect(journal).not.toContain("<select");
  });

  it("uses the shared Select primitives for preparation templates", () => {
    expect(templates).toContain('aria-label="Select a Journal preparation template"');
    expect(templates).toContain("<SelectItem");
    expect(templates).not.toContain("<select");
  });
});
