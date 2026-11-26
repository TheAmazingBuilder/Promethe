import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import {
  EconomicCalendarError,
  linkEventToTrade,
  unlinkEventFromTrade,
} from "@/server/economic-calendar";
import { eventTradeLinkInputSchema } from "@/lib/validations/economic-calendar";
import { zodFieldErrors } from "@/lib/auth/validators";

/** POST link an event to a trade ; DELETE unlink it. */
export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = eventTradeLinkInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Link data is invalid.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 },
      );
    }
    const link = await linkEventToTrade(session.user.id, parsed.data.tradeId, parsed.data.eventId);
    return NextResponse.json({ link }, { status: 201 });
  } catch (error) {
    if (error instanceof EconomicCalendarError) {
      const message =
        error.code === "TRADE_NOT_FOUND"
          ? "Trade not found."
          : "Event not found.";
      return NextResponse.json({ error: error.code, message }, { status: 404 });
    }
    return apiError(error, "economic-calendar");
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await requireUser();
    const params = new URL(req.url).searchParams;
    const tradeId = params.get("tradeId") ?? "";
    const eventId = params.get("eventId") ?? "";
    const unlinked = await unlinkEventFromTrade(session.user.id, tradeId, eventId);
    if (!unlinked) {
      return NextResponse.json({ error: "LINK_NOT_FOUND", message: "Link not found." }, { status: 404 });
    }
    return NextResponse.json({ unlinked: true });
  } catch (error) {
    return apiError(error, "economic-calendar");
  }
}
