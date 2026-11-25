"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { MonteCarloInputDTO } from "@/lib/validations/monte-carlo";
import type { MonteCarloResult } from "@/lib/analytics/monte-carlo";

export interface MonteCarloRunParams {
  accountId: string;
  accountName: string;
  currency: string;
  source: "HISTORICAL" | "HYPOTHETICAL";
  riskPercent: number;
  iterations: number;
  tradesPerPath: number;
  targetPercent: number;
  ruinThresholdPercent: number;
  ruinBehavior: "STOP" | "CONTINUE";
  hypotheticalWinRate?: number;
  hypotheticalAvgWinR?: number;
  hypotheticalAvgLossR?: number;
  seed: number;
  historicalSampleSize: number;
}

export interface MonteCarloRunSummary {
  probabilityOfRuin: number;
  probabilityOfReachingTarget: number;
  medianEndingBalance: number;
  p5EndingBalance: number | null;
  p95EndingBalance: number | null;
  medianMaxDrawdown: number;
  iterations: number | null;
  tradesPerPath: number | null;
  sampleSize: number | null;
  source: string | null;
  ruinBehavior: string | null;
}

export interface MonteCarloRunListItem {
  id: string;
  name: string;
  params: MonteCarloRunParams;
  summary: MonteCarloRunSummary | null;
  createdAt: string;
}

export interface MonteCarloRunDetail {
  id: string;
  name: string;
  params: MonteCarloRunParams;
  result: MonteCarloResult;
  createdAt: string;
}

export interface MonteCarloRunPayload {
  run: { id: string; name: string; createdAt: string };
  account: { id: string; name: string; currency: string };
  params: MonteCarloRunParams;
  result: MonteCarloResult;
}

export function useMonteCarloRuns() {
  return useQuery({
    queryKey: ["monte-carlo-runs"],
    queryFn: async () =>
      (await apiFetch<{ runs: MonteCarloRunListItem[] }>("/api/v1/monte-carlo")).runs,
  });
}

export function useMonteCarloRun(id: string | null) {
  return useQuery({
    queryKey: ["monte-carlo-run", id],
    enabled: id != null,
    queryFn: async () =>
      (await apiFetch<{ run: MonteCarloRunDetail }>(`/api/v1/monte-carlo/${id}`)).run,
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

export function useDeleteMonteCarloRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`/api/v1/monte-carlo/${id}`, { method: "DELETE" });
      return id;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["monte-carlo-runs"] });
    },
  });
}
