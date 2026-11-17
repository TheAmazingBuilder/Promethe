import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { createTemplate, gaiaErrorResponse, listTemplates } from "@/server/gaia";

/**
 * GET  /api/gaia/templates : modèles built-in + modèles de l'utilisateur.
 * POST /api/gaia/templates : créer un modèle utilisateur (201).
 */
export async function GET() {
  try {
    const session = await requireUser();
    const result = await listTemplates(session.user.id);
    return NextResponse.json(result);
  } catch (error) {
    return gaiaErrorResponse(error) ?? apiError(error, "gaia/templates");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const result = await createTemplate(session.user.id, body);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return gaiaErrorResponse(error) ?? apiError(error, "gaia/templates");
  }
}
