import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { createTemplate, listTemplates } from "@/server/templates";
import { templateInputSchema, zodFieldErrors } from "@/lib/validations/shared";

/**
 * GET  /api/templates — sorted by usage (most used first).
 * POST /api/templates — create.
 */
export async function GET() {
  try {
    const session = await requireUser();
    const templates = await listTemplates(session.user.id);
    return NextResponse.json({ templates });
  } catch (error) {
    return apiError(error, "templates");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = templateInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Certains champs sont invalides.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const template = await createTemplate(session.user.id, parsed.data);
    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    return apiError(error, "templates");
  }
}
