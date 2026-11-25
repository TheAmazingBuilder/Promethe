"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type {
  PropChallengeDTO,
  PropChallengeEvaluationDTO,
  PropFirmRuleSetDTO,
  PropFirmWorkspacePayload,
  PropPayoutDTO,
  PropExpenseDTO,
  PropPhaseResultDTO,
} from "@/lib/prop-firms/types";
import type {
  PropChallengeInput,
  PropChallengePatch,
  PropExpenseInput,
  PropExpensePatch,
  PropFirmRuleSetInput,
  PropFirmRuleSetPatch,
  PropPayoutInput,
  PropPayoutPatch,
  PropPhaseResultInput,
} from "@/lib/validations/prop-firms";

function useInvalidatePropFirms() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["prop-firms"] });
    void queryClient.invalidateQueries({ queryKey: ["prop-status"] });
  };
}

export function usePropFirmWorkspace() {
  return useQuery({
    queryKey: ["prop-firms"],
    queryFn: () => apiFetch<PropFirmWorkspacePayload>("/api/v1/prop-firms"),
    staleTime: 30_000,
  });
}

export function useCreatePropChallenge() {
  const invalidate = useInvalidatePropFirms();
  return useMutation({
    mutationFn: async (input: PropChallengeInput) =>
      (await apiFetch<{ challenge: PropChallengeDTO }>("/api/v1/prop-firms", {
        method: "POST",
        body: JSON.stringify(input),
      })).challenge,
    onSuccess: invalidate,
  });
}

export function useUpdatePropChallenge() {
  const invalidate = useInvalidatePropFirms();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: PropChallengePatch }) =>
      (await apiFetch<{ challenge: PropChallengeDTO }>(`/api/v1/prop-firms/challenges/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      })).challenge,
    onSuccess: invalidate,
  });
}

export function useDeletePropChallenge() {
  const invalidate = useInvalidatePropFirms();
  return useMutation({
    mutationFn: async (id: string) =>
      apiFetch(`/api/v1/prop-firms/challenges/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

export function useCreatePropFirmRuleSet() {
  const invalidate = useInvalidatePropFirms();
  return useMutation({
    mutationFn: async (input: PropFirmRuleSetInput) =>
      (await apiFetch<{ ruleSet: PropFirmRuleSetDTO }>("/api/v1/prop-firms/rule-sets", {
        method: "POST",
        body: JSON.stringify(input),
      })).ruleSet,
    onSuccess: invalidate,
  });
}

export function useUpdatePropFirmRuleSet() {
  const invalidate = useInvalidatePropFirms();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: PropFirmRuleSetPatch }) =>
      (await apiFetch<{ ruleSet: PropFirmRuleSetDTO }>(`/api/v1/prop-firms/rule-sets/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      })).ruleSet,
    onSuccess: invalidate,
  });
}

export function useDeletePropFirmRuleSet() {
  const invalidate = useInvalidatePropFirms();
  return useMutation({
    mutationFn: async (id: string) =>
      apiFetch(`/api/v1/prop-firms/rule-sets/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

export function useCreatePropPhaseResult() {
  const invalidate = useInvalidatePropFirms();
  return useMutation({
    mutationFn: async ({ challengeId, input }: { challengeId: string; input: PropPhaseResultInput }) =>
      (await apiFetch<{ phaseResult: PropPhaseResultDTO }>(`/api/v1/prop-firms/challenges/${challengeId}/phases`, {
        method: "POST",
        body: JSON.stringify(input),
      })).phaseResult,
    onSuccess: invalidate,
  });
}

export function useCreatePropPayout() {
  const invalidate = useInvalidatePropFirms();
  return useMutation({
    mutationFn: async ({ challengeId, input }: { challengeId: string; input: PropPayoutInput }) =>
      (await apiFetch<{ payout: PropPayoutDTO }>(`/api/v1/prop-firms/challenges/${challengeId}/payouts`, {
        method: "POST",
        body: JSON.stringify(input),
      })).payout,
    onSuccess: invalidate,
  });
}

export function useCreatePropExpense() {
  const invalidate = useInvalidatePropFirms();
  return useMutation({
    mutationFn: async ({ challengeId, input }: { challengeId: string; input: Omit<PropExpenseInput, "challengeId"> }) =>
      (await apiFetch<{ expense: PropExpenseDTO }>(`/api/v1/prop-firms/challenges/${challengeId}/expenses`, {
        method: "POST",
        body: JSON.stringify(input),
      })).expense,
    onSuccess: invalidate,
  });
}

/** Lot 5 engine evaluation of one challenge (computed on demand). */
export function usePropChallengeEvaluation(challengeId: string | null) {
  return useQuery({
    queryKey: ["prop-firms", "evaluation", challengeId],
    queryFn: () =>
      apiFetch<{ evaluation: PropChallengeEvaluationDTO }>(
        `/api/v1/prop-firms/challenges/${challengeId}/evaluation`,
      ),
    enabled: challengeId != null,
    staleTime: 30_000,
  });
}

export function useUpdatePropPayout() {
  const invalidate = useInvalidatePropFirms();
  return useMutation({
    mutationFn: async ({ challengeId, payoutId, patch }: { challengeId: string; payoutId: string; patch: PropPayoutPatch }) =>
      (await apiFetch<{ payout: PropPayoutDTO }>(`/api/v1/prop-firms/challenges/${challengeId}/payouts/${payoutId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      })).payout,
    onSuccess: invalidate,
  });
}

export function useDeletePropPayout() {
  const invalidate = useInvalidatePropFirms();
  return useMutation({
    mutationFn: async ({ challengeId, payoutId }: { challengeId: string; payoutId: string }) =>
      apiFetch(`/api/v1/prop-firms/challenges/${challengeId}/payouts/${payoutId}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

export function useUpdatePropExpense() {
  const invalidate = useInvalidatePropFirms();
  return useMutation({
    mutationFn: async ({ challengeId, expenseId, patch }: { challengeId: string; expenseId: string; patch: PropExpensePatch }) =>
      (await apiFetch<{ expense: PropExpenseDTO }>(`/api/v1/prop-firms/challenges/${challengeId}/expenses/${expenseId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      })).expense,
    onSuccess: invalidate,
  });
}

export function useDeletePropExpense() {
  const invalidate = useInvalidatePropFirms();
  return useMutation({
    mutationFn: async ({ challengeId, expenseId }: { challengeId: string; expenseId: string }) =>
      apiFetch(`/api/v1/prop-firms/challenges/${challengeId}/expenses/${expenseId}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}
