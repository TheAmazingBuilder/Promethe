import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";
import { tagPatchSchema, zodFieldErrors } from "@/lib/validations/shared";
import { deleteTag, updateTag } from "@/server/reference";

/**
 * PATCH  /api/tags/[id] — rename / recolor / rekind a USER-OWNED tag
 *                        (presets return 404 — they are not the user's rows).
 * DELETE /api/tags/[id] — associations cascade with the tag.
 */
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    sweepRateLimits();
    if (!rateLimit(`tags-patch:${session.user.id}`, 30, 60 * 1000)) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many requests, please wait." },
        { status: 429 }
      );
    }
    const body = await req.json().catch(() => null);
    const parsed = tagPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: "Some fields are invalid.",
          fieldErrors: zodFieldErrors(parsed.error),
        },
        { status: 422 }
      );
    }
    const tag = await updateTag(session.user.id, id, parsed.data);
    if (!tag) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Tag not found." },
        { status: 404 }
      );
    }
    return NextResponse.json({ tag });
  } catch (error) {
    return apiError(error, "tags/[id]");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    sweepRateLimits();
    if (!rateLimit(`tags-delete:${session.user.id}`, 30, 60 * 1000)) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many requests, please wait." },
        { status: 429 }
      );
    }
    const ok = await deleteTag(session.user.id, id);
    if (!ok) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Tag not found." },
        { status: 404 }
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "tags/[id]");
  }
}
