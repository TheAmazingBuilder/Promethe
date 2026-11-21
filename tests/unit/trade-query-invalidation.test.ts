import { describe, expect, it, vi } from "vitest";
import { invalidateTradeDerivedQueries } from "@/lib/query/invalidation";

describe("invalidateTradeDerivedQueries", () => {
  it("invalidates primary and derived views affected by trade writes", () => {
    const invalidateQueries = vi.fn();
    invalidateTradeDerivedQueries({
      invalidateQueries,
    } as unknown as Parameters<typeof invalidateTradeDerivedQueries>[0]);

    const keys = invalidateQueries.mock.calls.map(([input]) => input.queryKey);
    expect(keys).toContainEqual(["trades"]);
    expect(keys).toContainEqual(["dashboard"]);
    expect(keys).toContainEqual(["analytics"]);
    expect(keys).toContainEqual(["analytics-advanced"]);
    expect(keys).toContainEqual(["analytics-when-you-trade"]);
    expect(keys).toContainEqual(["charts", "data"]);
    expect(keys).toContainEqual(["risk-reward-summary"]);
    expect(keys).toContainEqual(["prop-status"]);
    expect(keys).toContainEqual(["goals"]);
    expect(keys).toContainEqual(["violations"]);
    expect(keys).toContainEqual(["trade-violations"]);
    expect(keys).toContainEqual(["strategies", "stats"]);
  });
});
