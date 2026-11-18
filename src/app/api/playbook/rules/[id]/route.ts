import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { deletePlaybookRule, updatePlaybookRule } from "@/server/playbook";
import { playbookRulePatchSchema, zodFieldErrors } from "@/lib/validations/shared";

/** PATCH /api/playbook/rules/[id] · DELETE /api/playbook/rules/[id]. */
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = playbookRulePatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Some fields are invalid.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 },
      );
    }
    const rule = await updatePlaybookRule(session.user.id, id, parsed.data);
    if (!rule) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Rule not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({ rule });
  } catch (error) {
    return apiError(error, "playbook/rules/[id]");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const ok = await deletePlaybookRule(session.user.id, id);
    if (!ok) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Rule not found." },
        { status: 404 },
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "playbook/rules/[id]");
  }
}
