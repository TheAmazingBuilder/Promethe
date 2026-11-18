import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { getAccountsHealth } from "@/server/account-health";

/**
 * GET /api/accounts/health — health badge inputs for every account of the
 * user, computed from real closed trades (see src/server/account-health.ts
 * and the pure rules in src/lib/accounts/health.ts). Scoped by session user.
 */
export async function GET() {
  try {
    const session = await requireUser();
    const health = await getAccountsHealth(session.user.id);
    return NextResponse.json({ health });
  } catch (error) {
    return apiError(error, "accounts-health");
  }
}
