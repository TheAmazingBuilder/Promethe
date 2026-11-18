/**
 * POST /api/integrations/[id]/test - send a test message straight to the
 * endpoint (no outbox, no cron wait). Rate-limited: 5 tests / minute / user.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { consumeRateLimit, sweepRateLimits } from "@/lib/rate-limit";
import { sendTestMessage } from "@/server/integrations/delivery";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    sweepRateLimits();
    const rl = await consumeRateLimit(
      `integrations-test:${session.user.id}`,
      5,
      60 * 1000
    );
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many tests, please wait a minute." },
        { status: 429 }
      );
    }
    const result = await sendTestMessage(session.user.id, id);
    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error ?? "TEST_FAILED",
          message: "The test message could not be sent.",
        },
        { status: 422 }
      );
    }
    return NextResponse.json({ sent: true });
  } catch (error) {
    return apiError(error, "integrations/[id]/test");
  }
}
