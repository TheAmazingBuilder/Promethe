import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../src/components/journal/journal-period-review.tsx", import.meta.url),
  "utf8"
);

describe("Journal period-review draft protection", () => {
  it("tracks unsaved drafts independently for each week or month", () => {
    expect(source).toContain("dirtyPeriods");
    expect(source).toContain("setDirtyPeriods((current) => ({ ...current, [periodKey]: nextIsDirty }))");
    expect(source).toContain("Object.values(dirtyPeriods).some(Boolean)");
  });

  it("keeps the global unsaved-change warning active when switching periods", () => {
    expect(source).toContain("onDirtyChange(dirty || hasUnsavedDrafts)");
    expect(source).not.toContain("return () => onDirtyChange(false)");
  });


  it("shows a retryable state when a period review fails to load", () => {
    expect(source).toContain("isError, refetch");
    expect(source).toContain('title="Period review could not be loaded"');
    expect(source).toContain("onRetry={() => void refetch()}");
  });

  it("does not compare the previous period's form against a newly selected period before hydration", () => {
    expect(source).toContain("const [hydratedPeriodKey, setHydratedPeriodKey]");
    expect(source).toContain("setHydratedPeriodKey(periodKey)");
    expect(source).toContain("hydratedPeriodKey === periodKey && (");
  });

  it("clears the period draft marker only after a successful save", () => {
    expect(source).toContain("delete drafts.current[periodKey]");
    expect(source).toContain("setDirtyPeriods((current) => ({ ...current, [periodKey]: false }))");
  });
});
