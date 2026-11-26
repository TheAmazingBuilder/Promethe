import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../src/components/journal/journal-view.tsx", import.meta.url),
  "utf8"
);
const historySource = readFileSync(
  new URL("../../src/components/journal/journal-history-section.tsx", import.meta.url),
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

  it("shows a recoverable error when Journal history cannot load", () => {
    expect(historySource).toContain("isError: recentError");
    expect(historySource).toContain('title="Journal history could not be loaded"');
    expect(historySource).toContain("onRetry={() => void refetchRecent()}");
    expect(historySource).toContain("isFetchNextPageError");
  });

  it("uses safe URL parameters for Journal exports", () => {
    expect(historySource).toContain("new URLSearchParams({ from: historyFrom, to: historyTo })");
  });

  it("does not mark a daily entry dirty before hydration or after a successful save", () => {
    expect(source).toContain("hydratedFor === day && dirty && savedSignature !== JSON.stringify(form)");
    expect(source).toContain("disabled={save.isPending || !dailyUnsavedChanges}");
  });
});
