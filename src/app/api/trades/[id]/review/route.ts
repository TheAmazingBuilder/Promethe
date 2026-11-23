import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { saveTradeReview, TradeValidationError } from "@/server/trades";
import { tradeReviewSchema } from "@/lib/validations/review";
import { zodFieldErrors } from "@/lib/auth/validators";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/trades/[id]/review — save a structured post-trade review. */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = tradeReviewSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Some review answers are invalid.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 },
      );
    }
    const review = await saveTradeReview(session.user.id, id, parsed.data);
    if (!review) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Trade not found." },
        { status: 404 },
      );
    }
    let mistakeTagIds: string[] = [];
    if (review.mistakeTagIds) {
      try {
        const parsedTags: unknown = JSON.parse(review.mistakeTagIds);
        if (Array.isArray(parsedTags)) {
          mistakeTagIds = parsedTags.filter((tag): tag is string => typeof tag === "string");
        }
      } catch {
        mistakeTagIds = [];
      }
    }
    let customAnswers: Array<{ questionId: string; question: string; type: "SCALE" | "BOOLEAN" | "TEXT"; answer: string | number | boolean }> = [];
    if (review.customAnswers) {
      try { const parsedAnswers: unknown = JSON.parse(review.customAnswers); if (Array.isArray(parsedAnswers)) customAnswers = parsedAnswers as typeof customAnswers; } catch { customAnswers = []; }
    }
    return NextResponse.json({ review: { ...review, mistakeTagIds, customAnswers, reviewedAt: review.reviewedAt.toISOString(), createdAt: review.createdAt.toISOString(), updatedAt: review.updatedAt.toISOString() } });
  } catch (error) {
    if (error instanceof TradeValidationError) return NextResponse.json({ error: error.code, message: "The custom review answers are invalid." }, { status: error.status });
    return apiError(error, "trades/[id]/review");
  }
}
