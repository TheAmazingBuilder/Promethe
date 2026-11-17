"use client";

/**
 * v2.5 Module 2 — chart data hooks (TanStack Query over /api/charts/*).
 * The heavy payload (builder trades) is cached per period/account; the pure
 * builder then recomputes charts client-side with zero extra requests.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { BuilderTrade } from "@/lib/charts/builder";
import type {
  ChartConfig,
  SavedChartInput,
  SavedChartPatch,
} from "@/lib/validations/charts";

export interface BuilderDataPayload {
  currency: string;
  timezone: string;
  trades: BuilderTrade[];
  truncated: boolean;
}

export interface SavedChartDTO {
  id: string;
  name: string;
  config: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface BuilderFilters {
  period: "30d" | "90d" | "ytd" | "all";
  account: string | null;
}

export function useBuilderData(filters: BuilderFilters) {
  const params = new URLSearchParams({ period: filters.period });
  if (filters.account) params.set("account", filters.account);
  const qs = params.toString();
  return useQuery({
    queryKey: ["charts", "data", filters.period, filters.account ?? "all"],
    queryFn: async () => apiFetch<BuilderDataPayload>(`/api/charts/data?${qs}`),
    staleTime: 60 * 1000,
  });
}

export function useSavedCharts() {
  return useQuery({
    queryKey: ["charts", "saved"],
    queryFn: async () =>
      (await apiFetch<{ charts: SavedChartDTO[] }>("/api/charts/saved")).charts,
    staleTime: 60 * 1000,
  });
}

function useInvalidateSavedCharts() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["charts", "saved"] });
  };
}

export function useCreateSavedChart() {
  const invalidate = useInvalidateSavedCharts();
  return useMutation({
    mutationFn: async (input: SavedChartInput) =>
      (
        await apiFetch<{ chart: SavedChartDTO }>("/api/charts/saved", {
          method: "POST",
          body: JSON.stringify(input),
        })
      ).chart,
    onSuccess: invalidate,
  });
}

export function useUpdateSavedChart() {
  const invalidate = useInvalidateSavedCharts();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: SavedChartPatch }) =>
      (
        await apiFetch<{ chart: SavedChartDTO }>(`/api/charts/saved/${id}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        })
      ).chart,
    onSuccess: invalidate,
  });
}

export function useDeleteSavedChart() {
  const invalidate = useInvalidateSavedCharts();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`/api/charts/saved/${id}`, { method: "DELETE" });
    },
    onSuccess: invalidate,
  });
}

/** Parse a saved chart's stored config (defensive - old/broken rows → null). */
export function parseSavedConfig(config: unknown): ChartConfig | null {
  if (config == null || typeof config !== "object") return null;
  return config as ChartConfig;
}
