import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { gaiaErrorResponse, listGaiaRefs } from "@/server/gaia";

/** GET /api/gaia/refs?q=&kind= : entity picker (max 40). */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const url = new URL(req.url);
    const result = await listGaiaRefs(
      session.user.id,
      url.searchParams.get("q") ?? "",
      url.searchParams.get("kind") ?? undefined,
    );
    return NextResponse.json(result);
  } catch (error) {
    return gaiaErrorResponse(error) ?? apiError(error, "gaia/refs");
  }
}
