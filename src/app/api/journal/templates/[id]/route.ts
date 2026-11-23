import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { deleteJournalTemplate } from "@/server/journal";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const deleted = await deleteJournalTemplate(session.user.id, id);
    if (!deleted) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Journal template not found." },
        { status: 404 },
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "journal/templates/[id]");
  }
}
