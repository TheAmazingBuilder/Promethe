import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { gaiaErrorResponse, searchNotes } from "@/server/gaia";

/** GET /api/gaia/search?q= : recherche plein texte en mémoire (max 30). */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const url = new URL(req.url);
    const result = await searchNotes(session.user.id, url.searchParams.get("q") ?? "");
    return NextResponse.json(result);
  } catch (error) {
    return gaiaErrorResponse(error) ?? apiError(error, "gaia/search");
  }
}
