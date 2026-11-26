import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { createReviewQuestionTemplate, listReviewQuestionTemplates, ReviewQuestionLimitError } from "@/server/review-questions";
import { reviewQuestionInputSchema } from "@/lib/validations/review-questions";
import { zodFieldErrors } from "@/lib/auth/validators";

export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const includeInactive = new URL(req.url).searchParams.get("inactive") === "1";
    const questions = await listReviewQuestionTemplates(session.user.id, includeInactive);
    return NextResponse.json({ questions });
  } catch (error) {
    return apiError(error, "review-questions");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = reviewQuestionInputSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION", message: "The review question is invalid.", fieldErrors: zodFieldErrors(parsed.error) }, { status: 422 });
    const question = await createReviewQuestionTemplate(session.user.id, parsed.data);
    return NextResponse.json({ question }, { status: 201 });
  } catch (error) {
    if (error instanceof ReviewQuestionLimitError) return NextResponse.json({ error: "REVIEW_QUESTION_LIMIT", message: "You can have up to 20 active review questions." }, { status: 422 });
    return apiError(error, "review-questions");
  }
}
