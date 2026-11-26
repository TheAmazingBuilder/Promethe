import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import {
  deleteManualEvent,
  EconomicCalendarError,
  getEconomicEvent,
  updateManualEvent,
} from "@/server/economic-calendar";
import { manualEconomicEventInputSchema } from "@/lib/validations/economic-calendar";
import { zodFieldErrors } from "@/lib/auth/validators";

/** GET one event (with its linked trades) ; PATCH / DELETE a manual event. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser();
    const { id } = await params;
    const found = await getEconomicEvent(session.user.id, id);
    if (!found) {
      return NextResponse.json({ error: "EVENT_NOT_FOUND", message: "Event not found." }, { status: 404 });
    }
    return NextResponse.json(found);
  } catch (error) {
    return apiError(error, "economic-calendar");
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser();
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const parsed = manualEconomicEventInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Event data is invalid.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 },
      );
    }
    const event = await updateManualEvent(session.user.id, id, parsed.data);
    return NextResponse.json({ event });
  } catch (error) {
    if (error instanceof EconomicCalendarError) {
      if (error.code === "EVENT_ALREADY_EXISTS") {
        return NextResponse.json(
          {
            error: error.code,
            message: "An event with the same title, day and currency already exists.",
            existingEventId: error.existingEventId,
          },
          { status: 409 },
        );
      }
      if (error.code === "EVENT_NOT_FOUND") {
        return NextResponse.json(
          { error: error.code, message: "Only your own manual events can be edited." },
          { status: 404 },
        );
      }
    }
    return apiError(error, "economic-calendar");
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser();
    const { id } = await params;
    const deleted = await deleteManualEvent(session.user.id, id);
    if (!deleted) {
      return NextResponse.json(
        { error: "EVENT_NOT_FOUND", message: "Only your own manual events can be deleted." },
        { status: 404 },
      );
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return apiError(error, "economic-calendar");
  }
}
