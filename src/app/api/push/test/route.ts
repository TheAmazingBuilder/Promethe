/**
 * POST /api/push/test - send one test push to the caller's own
 * subscription (used by the "Send test" button in Notification
 * Preferences). Direct send, not queued: the user clicked and waits for
 * the result. The attempt is logged like any other push attempt.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { pushEndpointSchema } from "@/lib/validations/push";
import { sendPushTest } from "@/server/push/delivery";

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body: unknown = await req.json().catch(() => null);
    const parsed = pushEndpointSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Invalid request." },
        { status: 422 }
      );
    }
    const result = await sendPushTest(session.user.id, parsed.data.endpoint);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error ?? "TEST_FAILED", message: "The test push could not be sent." },
        { status: 422 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "push/test");
  }
}
