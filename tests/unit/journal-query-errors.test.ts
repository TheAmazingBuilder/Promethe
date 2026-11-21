import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../src/components/journal/journal-view.tsx", import.meta.url),
  "utf8"
);

describe("Journal entry query recovery", () => {
  it("keeps the date navigation available while showing a retryable load error", () => {
    expect(source).toContain("isError");
    expect(source).toContain("refetch");
    expect(source).toContain('title="Journal entry could not be loaded"');
    expect(source).toContain("onRetry={() => void refetch()}");
    expect(source.indexOf("{isError ? (")).toBeGreaterThan(source.indexOf("<PageHeader"));
  });
});
