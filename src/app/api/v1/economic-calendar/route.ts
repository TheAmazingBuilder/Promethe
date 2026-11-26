import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import {
  createManualEvent,
  EconomicCalendarError,
  listEconomicEvents,
} from "@/server/economic-calendar";
import {
  economicCalendarFiltersSchema,
  manualEconomicEventInputSchema,
} from "@/lib/validations/economic-calendar";
import { zodFieldErrors } from "@/lib/auth/validators";

/** GET list (filters in query) ; POST create a manual event. */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const params = new URL(req.url).searchParams;
    const parsed = economicCalendarFiltersSchema.safeParse({
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      currencies: params.get("currencies") ?? undefined,
      countries: params.get("countries") ?? undefined,
      impacts: params.get("impacts") ?? undefined,
      categories: params.get("categories") ?? undefined,
      sources: params.get("sources") ?? undefined,
      watchlistOnly: params.get("watchlistOnly") ?? undefined,
      limit: params.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Calendar filters are invalid.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 },
      );
    }
    const split = (value: string | undefined): string[] | undefined =>
      value ? value.split(",").map((part) => part.trim()).filter(Boolean) : undefined;
    const events = await listEconomicEvents(session.user.id, {
      from: parsed.data.from,
      to: parsed.data.to,
      currencies: split(parsed.data.currencies),
      countries: split(parsed.data.countries),
      impacts: split(parsed.data.impacts),
      categories: split(parsed.data.categories),
      sources: split(parsed.data.sources),
      watchlistOnly: parsed.data.watchlistOnly === "true",
      limit: parsed.data.limit,
    });
    return NextResponse.json({ events });
  } catch (error) {
    return apiError(error, "economic-calendar");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = manualEconomicEventInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Event data is invalid.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 },
      );
    }
    const event = await createManualEvent(session.user.id, parsed.data);
    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    if (error instanceof EconomicCalendarError && error.code === "EVENT_ALREADY_EXISTS") {
      return NextResponse.json(
        {
          error: error.code,
          message: "An event with the same title, day and currency already exists.",
          existingEventId: error.existingEventId,
        },
        { status: 409 },
      );
    }
    return apiError(error, "economic-calendar");
  }
}
