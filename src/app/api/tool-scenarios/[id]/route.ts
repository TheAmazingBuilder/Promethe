import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import {
  deleteToolScenario,
  updateToolScenario,
} from "@/server/tools";
import {
  toolScenarioPatchSchema,
  zodFieldErrors,
} from "@/lib/validations/shared";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH  /api/tool-scenarios/[id] - rename / replace the payload.
 * DELETE /api/tool-scenarios/[id]
 */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = toolScenarioPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Some fields are invalid.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const scenario = await updateToolScenario(session.user.id, id, parsed.data);
    if (!scenario) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Scenario not found." },
        { status: 404 }
      );
    }
    return NextResponse.json({ scenario });
  } catch (error) {
    return apiError(error, "tool-scenarios/[id]");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const ok = await deleteToolScenario(session.user.id, id);
    if (!ok) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Scenario not found." },
        { status: 404 }
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "tool-scenarios/[id]");
  }
}
