import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const history = readFileSync(
  new URL("../../src/components/history/history-history-section.tsx", import.meta.url),
  "utf8"
);
const templates = readFileSync(
  new URL("../../src/components/history/history-template-controls.tsx", import.meta.url),
  "utf8"
);

describe("Journal input consistency", () => {
  it("uses the shared DateField for history date filters", () => {
    expect(history).toContain('id="history-history-from"');
    expect(history).toContain('id="history-history-to"');
    expect(history).not.toContain('<Input type="date"');
  });

  it("uses the shared Select primitives for history filters", () => {
    expect(history).toContain('aria-label="Filter by mood"');
    expect(history).toContain('aria-label="Filter by discipline"');
    expect(history).toContain("<SelectContent>");
    expect(history).not.toContain("<select");
  });

  it("does not request a Journal history range when its dates are reversed", () => {
    const hook = readFileSync(
      new URL("../../src/hooks/use-history.ts", import.meta.url),
      "utf8"
    );
    expect(hook).toContain("enabled: !filters.from || !filters.to || filters.from <= filters.to");
  });

  it("uses the shared Select primitives for preparation templates", () => {
    expect(templates).toContain('aria-label="Select a Journal preparation template"');
    expect(templates).toContain("<SelectItem");
    expect(templates).not.toContain("<select");
  });
});
