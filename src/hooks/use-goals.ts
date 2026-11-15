"use client";

/**
 * React Query hooks — goals, trading rules & violations (v1 phase 6).
 * Same conventions as use-trading.ts / use-journal.ts: apiFetch envelope,
 * invalidation groups ["goals"], ["rules"], ["violations"], ["trade-violations"].
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type {
  GoalDTO,
  GoalWithProgressDTO,
  GoalsPayload,
  RuleDTO,
  RuleViolationDTO,
} from "@/lib/trading/dto";
import type { GoalInput, GoalPatch, RuleInput, RulePatch } from "@/lib/validations/goals";

// ── Goals ────────────────────────────────────────────────────────────────────

export function useGoals() {
  return useQuery({
    queryKey: ["goals"],
    queryFn: async () => apiFetch<GoalsPayload>("/api/goals"),
    staleTime: 30 * 1000,
  });
}

export function useCreateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: GoalInput) =>
      (await apiFetch<{ goal: GoalDTO }>("/api/goals", {
        method: "POST",
        body: JSON.stringify(input),
      })).goal,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["goals"] });
    },
  });
}

export function useUpdateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; patch: GoalPatch }) =>
      (await apiFetch<{ goal: GoalDTO }>(`/api/goals/${args.id}`, {
        method: "PATCH",
        body: JSON.stringify(args.patch),
      })).goal,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["goals"] });
    },
  });
}

export function useDeleteGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch<void>(`/api/goals/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["goals"] });
    },
  });
}

// ── Rules ────────────────────────────────────────────────────────────────────

export function useRules() {
  return useQuery({
    queryKey: ["rules"],
    queryFn: async () =>
      (await apiFetch<{ rules: RuleDTO[] }>("/api/rules")).rules,
    staleTime: 30 * 1000,
  });
}

export function useCreateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RuleInput) =>
      (await apiFetch<{ rule: RuleDTO }>("/api/rules", {
        method: "POST",
        body: JSON.stringify(input),
      })).rule,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["rules"] });
      void qc.invalidateQueries({ queryKey: ["violations"] });
      void qc.invalidateQueries({ queryKey: ["trade-violations"] });
    },
  });
}

export function useUpdateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; patch: RulePatch }) =>
      (await apiFetch<{ rule: RuleDTO }>(`/api/rules/${args.id}`, {
        method: "PATCH",
        body: JSON.stringify(args.patch),
      })).rule,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["rules"] });
      void qc.invalidateQueries({ queryKey: ["violations"] });
      void qc.invalidateQueries({ queryKey: ["trade-violations"] });
    },
  });
}

export function useDeleteRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch<void>(`/api/rules/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["rules"] });
      void qc.invalidateQueries({ queryKey: ["violations"] });
      void qc.invalidateQueries({ queryKey: ["trade-violations"] });
    },
  });
}

// ── Violations ───────────────────────────────────────────────────────────────

export function useViolations(days = 30, enabled = true) {
  return useQuery({
    queryKey: ["violations", days],
    queryFn: async () =>
      (
        await apiFetch<{ violations: RuleViolationDTO[] }>(
          `/api/rules/violations?days=${days}`
        )
      ).violations,
    staleTime: 30 * 1000,
    enabled,
  });
}

/** Violations attached to one trade (trade detail view). */
export function useTradeViolations(tradeId: string | null) {
  return useQuery({
    queryKey: ["trade-violations", tradeId],
    queryFn: async () =>
      (
        await apiFetch<{ violations: RuleViolationDTO[] }>(
          `/api/trades/${tradeId}/violations`
        )
      ).violations,
    enabled: tradeId != null && tradeId !== "",
    staleTime: 30 * 1000,
  });
}

/** Convenience selector — goal cards ready for the dashboard. */
export function selectActiveGoals(payload: GoalsPayload | undefined): GoalWithProgressDTO[] {
  return (payload?.goals ?? []).filter((g) => g.status === "ACTIVE");
}
