import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";
import {
  journalDeleteQuerySchema,
  journalEntrySchema,
  journalQuerySchema,
} from "@/lib/validations/journal";
import { zodFieldErrors } from "@/lib/validations/shared";
import {
  deleteJournalEntry,
  getJournalEntry,
  listRecentJournal,
  upsertJournalEntry,
} from "@/server/journal";

/**
 * GET  /api/journal?date=YYYY-MM-DD — single day (null when absent), or the
 *       paginated recent entries when no date is given.
 * PUT  /api/journal — upsert on (user, local day).
 * DELETE /api/journal?date=YYYY-MM-DD
 */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    sweepRateLimits();
    if (!rateLimit(`journal:${session.user.id}`, 60, 60 * 1000)) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many requests, please wait." },
        { status: 429 }
      );
    }
    const url = new URL(req.url);
    const raw = Object.fromEntries(url.searchParams.entries());
    const parsed = journalQuerySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Invalid Journal history filters.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    if (parsed.data.date) {
      const entry = await getJournalEntry(session.user.id, parsed.data.date);
      return NextResponse.json({ entry });
    }
    const page = await listRecentJournal(
      session.user.id,
      parsed.data.limit,
      parsed.data,
      parsed.data.offset,
    );
    return NextResponse.json(page);
  } catch (error) {
    return apiError(error, "journal");
  }
}

export async function PUT(req: Request) {
  try {
    const session = await requireUser();
    sweepRateLimits();
    if (!rateLimit(`journal-put:${session.user.id}`, 30, 60 * 1000)) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many requests, please wait." },
        { status: 429 }
      );
    }
    const body = await req.json().catch(() => null);
    const parsed = journalEntrySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Invalid journal entry.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const entry = await upsertJournalEntry(session.user.id, parsed.data);
    return NextResponse.json({ entry });
  } catch (error) {
    return apiError(error, "journal");
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await requireUser();
    const url = new URL(req.url);
    const raw = Object.fromEntries(url.searchParams.entries());
    const parsed = journalDeleteQuerySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Invalid date.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const ok = await deleteJournalEntry(session.user.id, parsed.data.date);
    if (!ok) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Entry not found." },
        { status: 404 }
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "journal");
  }
}
