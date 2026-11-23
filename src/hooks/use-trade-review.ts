"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { ReviewQuestionTemplateDTO, TradeReviewDTO } from "@/lib/trading/dto";
import type { ReviewQuestionInput, ReviewQuestionPatch } from "@/lib/validations/review-questions";
import type { TradeReviewInput } from "@/lib/validations/review";

export function useSaveTradeReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { tradeId: string; review: TradeReviewInput }) =>
      (await apiFetch<{ review: TradeReviewDTO }>(
        `/api/v1/trades/${args.tradeId}/review`,
        { method: "POST", body: JSON.stringify(args.review) },
      )).review,
    onSuccess: (_review, args) => {
      void qc.invalidateQueries({ queryKey: ["trade", args.tradeId] });
      void qc.invalidateQueries({ queryKey: ["trades"] });
      void qc.invalidateQueries({ queryKey: ["playbook"] });
    },
  });
}

export function useReviewQuestions(includeInactive = false) {
  return useQuery({
    queryKey: ["review-questions", includeInactive],
    queryFn: async () =>
      (await apiFetch<{ questions: ReviewQuestionTemplateDTO[] }>(
        `/api/v1/review-questions${includeInactive ? "?inactive=1" : ""}`,
      )).questions,
  });
}
export function useCreateReviewQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ReviewQuestionInput) =>
      (await apiFetch<{ question: ReviewQuestionTemplateDTO }>("/api/v1/review-questions", { method: "POST", body: JSON.stringify(input) })).question,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["review-questions"] }),
  });
}
export function useUpdateReviewQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: ReviewQuestionPatch }) =>
      (await apiFetch<{ question: ReviewQuestionTemplateDTO }>(`/api/v1/review-questions/${id}`, { method: "PATCH", body: JSON.stringify(patch) })).question,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["review-questions"] }),
  });
}
