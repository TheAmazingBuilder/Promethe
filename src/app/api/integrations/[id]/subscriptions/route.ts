/**
 * POST /api/integrations/[id]/subscriptions - update one subscription of
 * the endpoint. Body: { eventType, privacyLevel?, quietHoursStart?,
 * quietHoursEnd?, isEnabled? }.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { updateSubscription } from "@/server/integrations/endpoints";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => null)) as {
      eventType?: unknown;
      privacyLevel?: unknown;
      quietHoursStart?: unknown;
      quietHoursEnd?: unknown;
      isEnabled?: unknown;
    } | null;
    if (!body || typeof body.eventType !== "string") {
      return NextResponse.json(
        { error: "VALIDATION", message: "Requête invalide." },
        { status: 422 }
      );
    }
    const subscription = await updateSubscription(
      session.user.id,
      id,
      body.eventType,
      body
    );
    return NextResponse.json({ subscription });
  } catch (error) {
    return apiError(error, "integrations/[id]/subscriptions");
  }
}
