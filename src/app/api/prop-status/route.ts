import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";
import { getPropStatus } from "@/server/prop-status";

/**
 * GET /api/prop-status?account=… — breach-risk status for the PROP challenge.
 * Falls back to the first PROP account when no account id is given. Returns
 * { account: null } when the user has no PROP account.
 */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    sweepRateLimits();
    if (!rateLimit(`prop-status:${session.user.id}`, 60, 60 * 1000)) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Trop de requêtes, patientez." },
        { status: 429 }
      );
    }
    const url = new URL(req.url);
    const account = url.searchParams.get("account") ?? undefined;
    const payload = await getPropStatus(session.user.id, account);
    return NextResponse.json(
      payload ?? { account: null, status: null },
    );
  } catch (error) {
    return apiError(error, "prop-status");
  }
}
