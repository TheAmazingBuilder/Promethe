import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { gaiaErrorResponse, getOverview } from "@/server/gaia";

/** GET /api/gaia/overview : agrégats du workspace. */
export async function GET() {
  try {
    const session = await requireUser();
    const overview = await getOverview(session.user.id);
    return NextResponse.json(overview);
  } catch (error) {
    return gaiaErrorResponse(error) ?? apiError(error, "gaia/overview");
  }
}
