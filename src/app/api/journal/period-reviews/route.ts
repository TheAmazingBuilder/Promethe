import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import {
  journalPeriodReviewQuerySchema,
  journalPeriodReviewSchema,
} from "@/lib/validations/journal";
import { zodFieldErrors } from "@/lib/validations/shared";
import {
  getJournalPeriodReview,
  upsertJournalPeriodReview,
} from "@/server/journal";

export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const url = new URL(req.url);
    const parsed = journalPeriodReviewQuerySchema.safeParse(
      Object.fromEntries(url.searchParams.entries()),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Invalid Journal review period.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 },
      );
    }
    const review = await getJournalPeriodReview(
      session.user.id,
      parsed.data.periodType,
      parsed.data.periodStart,
    );
    return NextResponse.json({ review });
  } catch (error) {
    return apiError(error, "journal/period-reviews");
  }
}

export async function PUT(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = journalPeriodReviewSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Invalid Journal period review.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 },
      );
    }
    const review = await upsertJournalPeriodReview(session.user.id, parsed.data);
    return NextResponse.json({ review });
  } catch (error) {
    return apiError(error, "journal/period-reviews");
  }
}
