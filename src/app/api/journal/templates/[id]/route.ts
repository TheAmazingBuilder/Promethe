import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { deleteJournalTemplate, updateJournalTemplate } from "@/server/journal";
import { journalTemplateUpdateSchema } from "@/lib/validations/journal";
import { zodFieldErrors } from "@/lib/validations/shared";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = journalTemplateUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Invalid Journal template update.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 },
      );
    }
    const template = await updateJournalTemplate(session.user.id, id, parsed.data);
    if (!template) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Journal template not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({ template });
  } catch (error) {
    return apiError(error, "journal/templates/[id]");
  }
}

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
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return apiError(error, "journal/templates/[id]");
  }
}
