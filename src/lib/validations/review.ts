import { z } from "zod";

export const tradeReviewSchema = z.object({
  playbookMatch: z.enum(["MATCHED", "PARTIAL", "OFF_PLAYBOOK"]).nullish(),
  followedPlan: z.boolean().nullish(),
  planAdherenceScore: z.number().int().min(1).max(5).nullish(),
  executionQuality: z.number().int().min(1).max(5).nullish(),
  entryQuality: z.number().int().min(1).max(5).nullish(),
  exitQuality: z.number().int().min(1).max(5).nullish(),
  riskManagementScore: z.number().int().min(1).max(5).nullish(),
  emotionalControlScore: z.number().int().min(1).max(5).nullish(),
  wouldTakeAgain: z.enum(["YES", "NO", "MAYBE"]).nullish(),
  mainLesson: z.string().trim().max(2000).nullish(),
  whatWentWell: z.string().trim().max(4000).nullish(),
  whatToImprove: z.string().trim().max(4000).nullish(),
  mistakeTagIds: z.array(z.string().min(1).max(64)).max(20).optional(),
  customAnswers: z.array(z.object({ questionId: z.string().min(1).max(64), answer: z.union([z.string().trim().min(1).max(2000), z.number().int().min(1).max(5), z.boolean()]) })).max(20).optional(),
}).superRefine((value, ctx) => {
  const answerIds = value.customAnswers?.map((answer) => answer.questionId) ?? [];
  if (new Set(answerIds).size !== answerIds.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["customAnswers"], message: "A question can only be answered once." });
  const hasStructuredAnswer = [
    value.followedPlan,
    value.planAdherenceScore,
    value.executionQuality,
    value.entryQuality,
    value.exitQuality,
    value.riskManagementScore,
    value.emotionalControlScore,
    value.wouldTakeAgain,
    value.mainLesson,
    value.whatWentWell,
    value.whatToImprove,
  ].some((answer) => answer !== undefined && answer !== null && answer !== "") || (value.customAnswers?.length ?? 0) > 0;
  if (!hasStructuredAnswer) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "At least one structured review answer is required.",
    });
  }
});

export type TradeReviewInput = z.infer<typeof tradeReviewSchema>;
