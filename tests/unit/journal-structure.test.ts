import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../src/components/journal/journal-view.tsx", import.meta.url),
  "utf8"
);
const messages = readFileSync(
  new URL("../../messages/en.json", import.meta.url),
  "utf8"
);

describe("Journal preparation structure", () => {
  it("keeps broad session context separate from structured execution planning", () => {
    expect(messages).toContain('"preMarketPlan": "Session context"');
    expect(source).toContain("Keep directional bias, key levels and scenarios in Execution plan.");
    expect(source).toContain("rather than repeating your levels or setup scenarios");
  });

  it("describes the Journal as a complete trading-day record", () => {
    expect(messages).toContain("A structured record of your preparation, execution, mindset and lessons");
  });
});
