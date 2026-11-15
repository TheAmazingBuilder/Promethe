import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { saveAsTemplate } from "@/server/dashboards";
import { templateSaveSchema, zodFieldErrors } from "@/lib/validations/shared";

/**
 * POST /api/dashboards/[id]/save-template — snapshot the dashboard into the
 * user's template library (definitionJson = export shape, no personal data).
 */
type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = templateSaveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: "Certains champs sont invalides.",
          fieldErrors: zodFieldErrors(parsed.error),
        },
        { status: 422 }
      );
    }
    const template = await saveAsTemplate(session.user.id, id, {
      name: parsed.data.name,
      description: parsed.data.description ?? undefined,
    });
    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    return apiError(error, "dashboards/[id]/save-template");
  }
}
