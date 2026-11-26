import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { duplicateTemplate } from "@/server/templates";

/**
 * POST /api/templates/[id]/duplicate - copy a template. The copy starts
 * unused, with " (copy)" appended to the name.
 */
type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const template = await duplicateTemplate(session.user.id, id);
    if (!template) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Template not found." },
        { status: 404 }
      );
    }
    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    return apiError(error, "templates/[id]/duplicate");
  }
}
