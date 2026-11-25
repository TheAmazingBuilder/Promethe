import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { getWatchlistPrefs, updateWatchlistPrefs } from "@/server/economic-calendar";
import { watchlistPrefsInputSchema } from "@/lib/validations/economic-calendar";
import { zodFieldErrors } from "@/lib/auth/validators";

/** GET / PUT the user's event watchlist preferences. */
export async function GET() {
  try {
    const session = await requireUser();
    const prefs = await getWatchlistPrefs(session.user.id);
    return NextResponse.json({ prefs });
  } catch (error) {
    return apiError(error, "economic-calendar");
  }
}

export async function PUT(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = watchlistPrefsInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Watchlist preferences are invalid.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 },
      );
    }
    const prefs = await updateWatchlistPrefs(session.user.id, parsed.data);
    return NextResponse.json({ prefs });
  } catch (error) {
    return apiError(error, "economic-calendar");
  }
}
