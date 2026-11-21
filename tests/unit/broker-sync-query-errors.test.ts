import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../src/components/broker-sync/broker-sync-view.tsx", import.meta.url),
  "utf8"
);

describe("Broker sync query error recovery", () => {
  it.each([
    "Symbol mappings could not be loaded",
    "Magic mappings could not be loaded",
    "Recent sync activity could not be loaded",
    "Broker connections could not be loaded",
  ])("renders a retry state for %s", (title) => {
    expect(source).toContain(title);
    expect(source).toContain("<QueryErrorState");
  });

  it("retries both magic mappings and strategies when either dependency fails", () => {
    expect(source).toContain("refetchMappings()");
    expect(source).toContain("refetchStrategies()");
  });
});
