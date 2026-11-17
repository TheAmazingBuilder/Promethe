import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { deleteTemplate, updateTemplate } from "@/server/templates";
import { templatePatchSchema, zodFieldErrors } from "@/lib/validations/shared";

/**
 * PATCH  /api/templates/[id] · DELETE /api/templates/[id]
 */
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = templatePatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Some fields are invalid.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const template = await updateTemplate(session.user.id, id, parsed.data);
    if (!template) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Template not found." },
        { status: 404 }
      );
    }
    return NextResponse.json({ template });
  } catch (error) {
    return apiError(error, "templates/[id]");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const ok = await deleteTemplate(session.user.id, id);
    if (!ok) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Template not found." },
        { status: 404 }
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "templates/[id]");
  }
}
