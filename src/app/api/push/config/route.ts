/**
 * GET /api/push/config - Web Push availability for this device.
 *
 * Returns whether the server VAPID keys are configured. The browser
 * toggle shows an honest "not available" state when this is false, and
 * never offers a subscribe button that would fail. The public key itself
 * is a build-time env var (NEXT_PUBLIC_VAPID_PUBLIC_KEY) on the client,
 * so availability also requires it to be set.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { isPushConfigured } from "@/lib/push/vapid";

export async function GET() {
  try {
    await requireUser();
    const available =
      isPushConfigured() &&
      Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
    return NextResponse.json({ available });
  } catch (error) {
    return apiError(error, "push/config");
  }
}
