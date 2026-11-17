import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { createNote, gaiaErrorResponse, listNotes } from "@/server/gaia";

/**
 * GET  /api/gaia/notes?view=&folderId=&tagId=&q=&sort= (+ refKind/refId)
 * POST /api/gaia/notes : créer une note (201).
 */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const url = new URL(req.url);
    const result = await listNotes(session.user.id, {
      view: url.searchParams.get("view") ?? undefined,
      folderId: url.searchParams.get("folderId") ?? undefined,
      tagId: url.searchParams.get("tagId") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
      refKind: url.searchParams.get("refKind") ?? undefined,
      refId: url.searchParams.get("refId") ?? undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return gaiaErrorResponse(error) ?? apiError(error, "gaia/notes");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const result = await createNote(session.user.id, body);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return gaiaErrorResponse(error) ?? apiError(error, "gaia/notes");
  }
}
