import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import {
  createChecklistTemplate,
  listChecklistTemplates,
} from "@/server/playbook";
import {
  checklistTemplateInputSchema,
  zodFieldErrors,
} from "@/lib/validations/shared";

/** GET /api/playbook/checklists — list. POST — create. */
export async function GET() {
  try {
    const session = await requireUser();
    const checklists = await listChecklistTemplates(session.user.id);
    return NextResponse.json({ checklists });
  } catch (error) {
    return apiError(error, "playbook/checklists");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = checklistTemplateInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Some fields are invalid.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 },
      );
    }
    const checklist = await createChecklistTemplate(
      session.user.id,
      parsed.data,
    );
    if (!checklist) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Strategy not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({ checklist }, { status: 201 });
  } catch (error) {
    return apiError(error, "playbook/checklists");
  }
}
