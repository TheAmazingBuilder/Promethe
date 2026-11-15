import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { getAppearance, putAppearance } from "@/server/appearance";
import { appearanceInputSchema, zodFieldErrors } from "@/lib/validations/shared";

/**
 * GET /api/appearance — the user's appearance row (created with defaults on
 *      first read).
 * PUT /api/appearance — upsert; switching the palette away from "custom"
 *      clears the custom color overrides.
 */
export async function GET() {
  try {
    const session = await requireUser();
    const appearance = await getAppearance(session.user.id);
    return NextResponse.json({ appearance });
  } catch (error) {
    return apiError(error, "appearance");
  }
}

export async function PUT(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = appearanceInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: "Certains champs sont invalides.",
          fieldErrors: zodFieldErrors(parsed.error),
        },
        { status: 422 }
      );
    }
    const appearance = await putAppearance(session.user.id, parsed.data);
    return NextResponse.json({ appearance });
  } catch (error) {
    return apiError(error, "appearance");
  }
}
