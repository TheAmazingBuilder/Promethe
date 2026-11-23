import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { updateReviewQuestionTemplate, ReviewQuestionLimitError } from "@/server/review-questions";
import { reviewQuestionPatchSchema } from "@/lib/validations/review-questions";
import { zodFieldErrors } from "@/lib/auth/validators";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = reviewQuestionPatchSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION", message: "The review question is invalid.", fieldErrors: zodFieldErrors(parsed.error) }, { status: 422 });
    const question = await updateReviewQuestionTemplate(session.user.id, id, parsed.data);
    if (!question) return NextResponse.json({ error: "NOT_FOUND", message: "Review question not found." }, { status: 404 });
    return NextResponse.json({ question });
  } catch (error) {
    if (error instanceof ReviewQuestionLimitError) return NextResponse.json({ error: "REVIEW_QUESTION_LIMIT", message: "You can have up to 20 active review questions." }, { status: 422 });
    return apiError(error, "review-questions/[id]");
  }
}
