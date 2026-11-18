import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import {
  deleteChecklistTemplate,
  updateChecklistTemplate,
} from "@/server/playbook";
import {
  checklistTemplatePatchSchema,
  zodFieldErrors,
} from "@/lib/validations/shared";

/** PATCH /api/playbook/checklists/[id] · DELETE /api/playbook/checklists/[id]. */
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = checklistTemplatePatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Some fields are invalid.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 },
      );
    }
    const checklist = await updateChecklistTemplate(
      session.user.id,
      id,
      parsed.data,
    );
    if (!checklist) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Checklist not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({ checklist });
  } catch (error) {
    return apiError(error, "playbook/checklists/[id]");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const ok = await deleteChecklistTemplate(session.user.id, id);
    if (!ok) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Checklist not found." },
        { status: 404 },
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "playbook/checklists/[id]");
  }
}
