import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { createFolder, gaiaErrorResponse, listFolders } from "@/server/gaia";

/**
 * GET  /api/gaia/folders : dossiers + noteCount.
 * POST /api/gaia/folders : créer un dossier (201).
 */
export async function GET() {
  try {
    const session = await requireUser();
    const result = await listFolders(session.user.id);
    return NextResponse.json(result);
  } catch (error) {
    return gaiaErrorResponse(error) ?? apiError(error, "gaia/folders");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const result = await createFolder(session.user.id, body);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return gaiaErrorResponse(error) ?? apiError(error, "gaia/folders");
  }
}
