import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { createNote, gaiaErrorResponse, listNotes } from "@/server/gaia";

/**
 * GET  /api/gaia/notes?view=&folderId=&tagId=&q=&sort=&page=&pageSize=
 *      (+ refKind/refId)
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
      page: url.searchParams.get("page") === null ? undefined : Number(url.searchParams.get("page")),
      pageSize:
        url.searchParams.get("pageSize") === null
          ? undefined
          : Number(url.searchParams.get("pageSize")),
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
    // Offline idempotency (§25.5): a replayed create returns the stored
    // note with 200 instead of creating a duplicate (201).
    return NextResponse.json(result, { status: result.deduplicated ? 200 : 201 });
  } catch (error) {
    return gaiaErrorResponse(error) ?? apiError(error, "gaia/notes");
  }
}
