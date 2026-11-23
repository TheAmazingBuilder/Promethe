"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { TradeReviewDTO } from "@/lib/trading/dto";
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
