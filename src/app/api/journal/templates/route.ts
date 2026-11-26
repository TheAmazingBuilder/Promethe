import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { journalTemplateSchema } from "@/lib/validations/journal";
import { zodFieldErrors } from "@/lib/validations/shared";
import { createJournalTemplate, listJournalTemplates } from "@/server/journal";

export async function GET() {
  try {
    const session = await requireUser();
    const templates = await listJournalTemplates(session.user.id);
    return NextResponse.json({ templates });
  } catch (error) {
    return apiError(error, "journal/templates");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = journalTemplateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Invalid Journal template.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 },
      );
    }
    const template = await createJournalTemplate(session.user.id, parsed.data);
    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    return apiError(error, "journal/templates");
  }
}
