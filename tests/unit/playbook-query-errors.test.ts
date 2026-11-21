import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../src/components/playbook/playbook-view.tsx", import.meta.url),
  "utf8"
);

describe("Playbook overview query recovery", () => {
  it("renders a retryable error state before treating missing data as empty", () => {
    expect(source).toContain("const { data, isLoading, isError, refetch } = usePlaybookOverview()");
    expect(source).toContain('title="Playbook overview could not be loaded"');
    expect(source).toContain("onRetry={() => void refetch()}");
    expect(source.indexOf("if (isError)")).toBeLessThan(source.indexOf("if (!data) return null;"));
  });
});
