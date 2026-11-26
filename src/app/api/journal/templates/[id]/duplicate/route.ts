import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { duplicateJournalTemplate } from "@/server/journal";

/**
 * POST /api/journal/templates/[id]/duplicate - copy a journal template.
 * The copy is never the default, and its name gets " (copy)" appended.
 */
type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const template = await duplicateJournalTemplate(session.user.id, id);
    if (!template) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Journal template not found." },
        { status: 404 }
      );
    }
    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    return apiError(error, "journal/templates/[id]/duplicate");
  }
}
