import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Trade writes affect several derived views. Keep their invalidation in one
 * place so normal edits, closes and bulk imports cannot leave stale analytics.
 */
const TRADE_DERIVED_QUERY_KEYS: QueryKey[] = [
  ["trades"],
  ["dashboard"],
  ["analytics"],
  ["analytics-advanced"],
  ["analytics-when-you-trade"],
  ["weekly-plan"],
  ["performance-report"],
  ["charts", "data"],
  ["risk-reward-summary"],
  ["prop-status"],
  ["goals"],
  ["violations"],
  ["trade-violations"],
  ["strategies", "stats"],
];

export function invalidateTradeDerivedQueries(
  queryClient: QueryClient
): void {
  for (const queryKey of TRADE_DERIVED_QUERY_KEYS) {
    void queryClient.invalidateQueries({ queryKey });
  }
}
