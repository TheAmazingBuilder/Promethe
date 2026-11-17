import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { createTag, gaiaErrorResponse, listTags } from "@/server/gaia";

/**
 * GET  /api/gaia/tags : tags + noteCount.
 * POST /api/gaia/tags : créer ou retourner (idempotent par nom, 201).
 */
export async function GET() {
  try {
    const session = await requireUser();
    const result = await listTags(session.user.id);
    return NextResponse.json(result);
  } catch (error) {
    return gaiaErrorResponse(error) ?? apiError(error, "gaia/tags");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const result = await createTag(session.user.id, body);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return gaiaErrorResponse(error) ?? apiError(error, "gaia/tags");
  }
}
