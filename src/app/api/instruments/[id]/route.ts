import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";
import {
  instrumentPatchSchema,
  zodFieldErrors,
} from "@/lib/validations/shared";
import {
  deleteInstrument,
  updateInstrument,
} from "@/server/instruments";

/**
 * PATCH  /api/instruments/[id] — edit a CUSTOM instrument (pipSize included —
 *                               XAUUSD 0.10 vs broker 0.01 convention).
 * DELETE /api/instruments/[id] — 409 INSTRUMENT_HAS_TRADES while trades
 *                                reference it (history stays intact).
 */
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    sweepRateLimits();
    if (!rateLimit(`instruments-patch:${session.user.id}`, 30, 60 * 1000)) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Trop de requêtes, patientez." },
        { status: 429 }
      );
    }
    const body = await req.json().catch(() => null);
    const parsed = instrumentPatchSchema.safeParse(body);
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
    const instrument = await updateInstrument(session.user.id, id, parsed.data);
    if (!instrument) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Instrument introuvable." },
        { status: 404 }
      );
    }
    return NextResponse.json({ instrument });
  } catch (error) {
    return apiError(error, "instruments/[id]");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    sweepRateLimits();
    if (!rateLimit(`instruments-delete:${session.user.id}`, 20, 60 * 1000)) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Trop de requêtes, patientez." },
        { status: 429 }
      );
    }
    const result = await deleteInstrument(session.user.id, id);
    if (result === "HAS_TRADES") {
      return NextResponse.json(
        {
          error: "INSTRUMENT_HAS_TRADES",
          message:
            "Des trades référencent cet instrument - suppression impossible.",
        },
        { status: 409 }
      );
    }
    if (!result) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Instrument introuvable." },
        { status: 404 }
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "instruments/[id]");
  }
}
