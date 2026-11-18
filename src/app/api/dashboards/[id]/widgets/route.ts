import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { addWidget } from "@/server/dashboards";
import { widgetCreateSchema, zodFieldErrors } from "@/lib/validations/shared";

/**
 * POST /api/dashboards/[id]/widgets — add a widget (registry-validated type,
 * schema-validated config, auto-placed layout when none is given).
 */
type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = widgetCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: "Some fields are invalid.",
          fieldErrors: zodFieldErrors(parsed.error),
        },
        { status: 422 }
      );
    }
    const widget = await addWidget(session.user.id, id, parsed.data);
    return NextResponse.json({ widget }, { status: 201 });
  } catch (error) {
    return apiError(error, "dashboards/[id]/widgets");
  }
}
