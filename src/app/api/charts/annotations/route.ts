import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { createAnnotation, listAnnotations } from "@/server/charts";
import { annotationInputSchema } from "@/lib/validations/charts";
import { zodFieldErrors } from "@/lib/auth/validators";

/**
 * GET  /api/charts/annotations — the user's chart annotations.
 * POST /api/charts/annotations — create (point or range, scoped).
 */
export async function GET() {
  try {
    const session = await requireUser();
    const annotations = await listAnnotations(session.user.id);
    return NextResponse.json({ annotations });
  } catch (error) {
    return apiError(error, "charts/annotations");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = annotationInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: "Annotation invalide.",
          fieldErrors: zodFieldErrors(parsed.error),
        },
        { status: 422 }
      );
    }
    const annotation = await createAnnotation(session.user.id, parsed.data);
    return NextResponse.json({ annotation }, { status: 201 });
  } catch (error) {
    return apiError(error, "charts/annotations");
  }
}
