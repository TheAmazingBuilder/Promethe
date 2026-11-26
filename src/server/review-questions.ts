import { db } from "@/lib/db";
import type { ReviewQuestionInput, ReviewQuestionPatch } from "@/lib/validations/review-questions";

export class ReviewQuestionLimitError extends Error {
  constructor() {
    super("REVIEW_QUESTION_LIMIT");
    this.name = "ReviewQuestionLimitError";
  }
}

const MAX_ACTIVE_REVIEW_QUESTIONS = 20;

export async function listReviewQuestionTemplates(userId: string, includeInactive = false) {
  return db.reviewQuestionTemplate.findMany({
    where: { userId, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, question: true, type: true, order: true, isActive: true, createdAt: true },
  });
}

export async function createReviewQuestionTemplate(userId: string, input: ReviewQuestionInput) {
  return db.$transaction(async (tx) => {
    const activeCount = await tx.reviewQuestionTemplate.count({ where: { userId, isActive: true } });
    if (activeCount >= MAX_ACTIVE_REVIEW_QUESTIONS) throw new ReviewQuestionLimitError();
    const last = await tx.reviewQuestionTemplate.findFirst({ where: { userId }, orderBy: { order: "desc" }, select: { order: true } });
    return tx.reviewQuestionTemplate.create({
      data: { userId, question: input.question, type: input.type, order: input.order ?? (last ? last.order + 1 : 0) },
      select: { id: true, question: true, type: true, order: true, isActive: true, createdAt: true },
    });
  });
}

export async function updateReviewQuestionTemplate(userId: string, id: string, patch: ReviewQuestionPatch) {
  return db.$transaction(async (tx) => {
    const current = await tx.reviewQuestionTemplate.findFirst({ where: { id, userId } });
    if (!current) return null;
    if (patch.isActive === true && !current.isActive) {
      const activeCount = await tx.reviewQuestionTemplate.count({ where: { userId, isActive: true } });
      if (activeCount >= MAX_ACTIVE_REVIEW_QUESTIONS) throw new ReviewQuestionLimitError();
    }
    return tx.reviewQuestionTemplate.update({ where: { id }, data: patch, select: { id: true, question: true, type: true, order: true, isActive: true, createdAt: true } });
  });
}
