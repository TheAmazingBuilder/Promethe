import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { createTag, listTags } from "@/server/reference";
import { tagInputSchema, zodFieldErrors } from "@/lib/validations/shared";

/**
 * GET  /api/tags — global presets + user tags.
 * POST /api/tags — create (upsert-by-name semantics per user).
 */
export async function GET() {
  try {
    const session = await requireUser();
    const tags = await listTags(session.user.id);
    return NextResponse.json({ tags });
  } catch (error) {
    return apiError(error, "tags");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = tagInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Certains champs sont invalides.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const tag = await createTag(session.user.id, parsed.data);
    return NextResponse.json({ tag }, { status: 201 });
  } catch (error) {
    return apiError(error, "tags");
  }
}
