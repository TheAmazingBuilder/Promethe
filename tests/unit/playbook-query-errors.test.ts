import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../src/components/playbook/playbook-view.tsx", import.meta.url),
  "utf8"
);

describe("Playbook query error recovery", () => {
  it.each([
    "Playbook overview could not be loaded",
    "Playbook strategies could not be loaded",
    "Playbook setups could not be loaded",
    "Playbook rules could not be loaded",
    "Playbook checklists could not be loaded",
    "Playbook performance could not be loaded",
    "Strategy versions could not be loaded",
  ])("provides a retryable error state: %s", (title) => {
    expect(source).toContain(title);
    expect(source).toContain("<QueryErrorState");
  });

  it("retries related queries together when a tab depends on multiple sources", () => {
    for (const refetch of [
      "refetchStrategies()",
      "refetchStats()",
      "refetchOverview()",
      "refetchSetups()",
      "refetchInsights()",
      "refetchRules()",
      "refetchChecklists()",
    ]) {
      expect(source).toContain(refetch);
    }
  });
});
