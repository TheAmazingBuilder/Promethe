import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";
import {
  instrumentInputSchema,
  zodFieldErrors,
} from "@/lib/validations/shared";
import { createInstrument, listInstruments } from "@/server/instruments";

/**
 * GET  /api/instruments — global presets + the caller's customs
 *                         (presets only when unauthenticated).
 * POST /api/instruments — create a custom instrument (per-user symbol key).
 */
export async function GET() {
  try {
    // Optional auth: the trade form calls this both logged in and during
    // bootstrap — presets stay public, customs are additive.
    let userId: string | null = null;
    try {
      const session = await requireUser();
      userId = session.user.id;
    } catch {
      userId = null;
    }
    const instruments = await listInstruments(userId);
    return NextResponse.json({ instruments });
  } catch (error) {
    return apiError(error, "instruments");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    sweepRateLimits();
    if (!rateLimit(`instruments-post:${session.user.id}`, 20, 60 * 1000)) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Trop de requêtes, patientez." },
        { status: 429 }
      );
    }
    const body = await req.json().catch(() => null);
    const parsed = instrumentInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: "Certains champs sont invalides.",
          fieldErrors: zodFieldErrors(parsed.error),
        },
        { status: 422 }
      );
    }
    const instrument = await createInstrument(session.user.id, parsed.data);
    return NextResponse.json({ instrument }, { status: 201 });
  } catch (error) {
    return apiError(error, "instruments");
  }
}
