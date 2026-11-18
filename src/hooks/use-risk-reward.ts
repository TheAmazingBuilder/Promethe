"use client";

/**
 * React Query hooks for the Risk / Reward summary API: real win-rate /
 * R:R stats and the daily risk budget gauge, plus the budget setter.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { RiskRewardSummaryDTO } from "@/lib/trading/dto";

export const RISK_REWARD_QUERY_KEY = ["risk-reward-summary"] as const;

export function useRiskRewardSummary() {
  return useQuery({
    queryKey: RISK_REWARD_QUERY_KEY,
    queryFn: async () =>
      apiFetch<RiskRewardSummaryDTO>("/api/v1/risk-reward/summary"),
    staleTime: 60 * 1000,
  });
}

export function useSetDailyRiskBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dailyRiskBudgetPercent: string | null) =>
      apiFetch<{ dailyRiskBudgetPercent: string | null }>(
        "/api/v1/risk-reward/summary",
        {
          method: "PATCH",
          body: JSON.stringify({ dailyRiskBudgetPercent }),
        }
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: RISK_REWARD_QUERY_KEY });
    },
  });
}
