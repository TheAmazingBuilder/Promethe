"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { MonteCarloInputDTO } from "@/lib/validations/monte-carlo";
import type { MonteCarloResult } from "@/lib/analytics/monte-carlo";

export interface MonteCarloRunPayload {
  run: { id: string; name: string; createdAt: string };
  account: { id: string; name: string; currency: string };
  params: {
    accountId: string;
    accountName: string;
    currency: string;
    riskPercent: number;
    iterations: number;
    tradesPerPath: number;
    targetPercent: number;
    ruinThresholdPercent: number;
    seed: number;
    historicalSampleSize: number;
  };
  result: MonteCarloResult;
}

export function useMonteCarloRuns() {
  return useQuery({
    queryKey: ["monte-carlo-runs"],
    queryFn: async () => (await apiFetch<{ runs: Array<{ id: string; name: string; params: unknown; result: unknown; createdAt: string }> }>("/api/v1/monte-carlo")).runs,
  });
}

export function useCreateMonteCarloRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MonteCarloInputDTO) =>
      apiFetch<MonteCarloRunPayload>("/api/v1/monte-carlo", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["monte-carlo-runs"] });
    },
  });
}
