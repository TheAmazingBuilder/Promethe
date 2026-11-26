import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";
import { screenshotAnnotationsInputSchema } from "@/lib/validations/screenshot-annotations";
import { readScreenshotAnnotations, saveScreenshotAnnotations } from "@/server/uploads";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    sweepRateLimits();
    if (!rateLimit(`screenshot-annotations-read:${session.user.id}`, 60, 60 * 1000)) {
      return NextResponse.json({ error: "RATE_LIMITED", message: "Too many requests, please wait." }, { status: 429 });
    }
    const annotations = await readScreenshotAnnotations(session.user.id, id);
    if (!annotations) {
      return NextResponse.json({ error: "NOT_FOUND", message: "Screenshot not found." }, { status: 404 });
    }
    return NextResponse.json({ annotations });
  } catch (error) {
    return apiError(error, "uploads/[id]/annotations");
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    sweepRateLimits();
    if (!rateLimit(`screenshot-annotations-write:${session.user.id}`, 30, 60 * 1000)) {
      return NextResponse.json({ error: "RATE_LIMITED", message: "Too many requests, please wait." }, { status: 429 });
    }
    const body = await req.json().catch(() => null);
    const parsed = screenshotAnnotationsInputSchema.safeParse(body && typeof body === "object" && "annotations" in body
      ? body.annotations
      : body);
    if (!parsed.success) {
      return NextResponse.json({
        error: "VALIDATION",
        message: "Invalid screenshot annotations.",
      }, { status: 422 });
    }
    const annotations = await saveScreenshotAnnotations(session.user.id, id, parsed.data);
    if (!annotations) {
      return NextResponse.json({ error: "NOT_FOUND", message: "Screenshot not found." }, { status: 404 });
    }
    return NextResponse.json({ annotations });
  } catch (error) {
    return apiError(error, "uploads/[id]/annotations");
  }
}
