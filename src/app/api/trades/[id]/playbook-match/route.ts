import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { setPlaybookMatch } from "@/server/playbook";
import { playbookMatchSchema, zodFieldErrors } from "@/lib/validations/shared";

/**
 * POST /api/trades/[id]/playbook-match — declare how a trade matched the
 * playbook, at review time. Declared by the user, never derived from
 * followedPlan. Creates the review row when none exists (scored fields
 * stay null — no invented scores).
 */
type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = playbookMatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Some fields are invalid.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 },
      );
    }
    const playbookMatch = await setPlaybookMatch(
      session.user.id,
      id,
      parsed.data.playbookMatch,
    );
    if (!playbookMatch) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Trade not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({ playbookMatch });
  } catch (error) {
    return apiError(error, "trades/[id]/playbook-match");
  }
}
