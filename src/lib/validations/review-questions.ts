import { z } from "zod";

export const REVIEW_QUESTION_TYPES = ["SCALE", "BOOLEAN", "TEXT"] as const;

export const reviewQuestionInputSchema = z.object({
  question: z.string().trim().min(1, "required").max(180),
  type: z.enum(REVIEW_QUESTION_TYPES).default("SCALE"),
  order: z.number().int().min(0).max(999).optional(),
});

export const reviewQuestionPatchSchema = z.object({
  question: z.string().trim().min(1).max(180).optional(),
  type: z.enum(REVIEW_QUESTION_TYPES).optional(),
  order: z.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
});

export type ReviewQuestionInput = z.infer<typeof reviewQuestionInputSchema>;
export type ReviewQuestionPatch = z.infer<typeof reviewQuestionPatchSchema>;
