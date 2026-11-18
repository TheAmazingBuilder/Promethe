import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { deleteAnnotation, updateAnnotation } from "@/server/charts";
import { annotationPatchSchema } from "@/lib/validations/charts";

/**
 * PATCH  /api/charts/annotations/[id] — edit (merged + revalidated).
 * DELETE /api/charts/annotations/[id] — remove (404 when not owned).
 */
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = annotationPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Invalid annotation." },
        { status: 422 }
      );
    }
    const annotation = await updateAnnotation(session.user.id, id, parsed.data);
    if (!annotation) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Annotation not found." },
        { status: 404 }
      );
    }
    return NextResponse.json({ annotation });
  } catch (error) {
    if (error instanceof Error && error.message === "ANNOTATION_INVALID") {
      return NextResponse.json(
        { error: "VALIDATION", message: "Invalid annotation." },
        { status: 422 }
      );
    }
    return apiError(error, "charts/annotations/[id]");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const deleted = await deleteAnnotation(session.user.id, id);
    if (!deleted) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Annotation not found." },
        { status: 404 }
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "charts/annotations/[id]");
  }
}
