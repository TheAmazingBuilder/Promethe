import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import {
  getDisplayPreferences,
  putDisplayPreferences,
} from "@/server/display-preferences";
import {
  displayPreferencesInputSchema,
  zodFieldErrors,
} from "@/lib/validations/shared";

/**
 * GET /api/display-preferences — the user's display-preferences row
 *      (privacy / accessibility / time slices, created with defaults).
 * PUT /api/display-preferences — PARTIAL patch; each provider (privacy,
 *      a11y, time settings) syncs its own slice without clobbering the rest.
 */
export async function GET() {
  try {
    const session = await requireUser();
    const preferences = await getDisplayPreferences(session.user.id);
    return NextResponse.json({ preferences });
  } catch (error) {
    return apiError(error, "display-preferences");
  }
}

export async function PUT(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = displayPreferencesInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: "Some fields are invalid.",
          fieldErrors: zodFieldErrors(parsed.error),
        },
        { status: 422 }
      );
    }
    const preferences = await putDisplayPreferences(session.user.id, parsed.data);
    return NextResponse.json({ preferences });
  } catch (error) {
    return apiError(error, "display-preferences");
  }
}
