import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { duplicateStrategy } from "@/server/playbook";
import { duplicateStrategySchema, zodFieldErrors } from "@/lib/validations/shared";

/**
 * POST /api/strategies/[id]/duplicate — copy as DRAFT, name + " (copy)",
 * grade reset, setups and scoped checklists cloned, history excluded.
 */
type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = duplicateStrategySchema.safeParse(body ?? {});
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Some fields are invalid.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 },
      );
    }
    const strategy = await duplicateStrategy(
      session.user.id,
      id,
      parsed.data.name ?? null,
    );
    if (!strategy) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Strategy not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({ strategy }, { status: 201 });
  } catch (error) {
    return apiError(error, "strategies/[id]/duplicate");
  }
}
