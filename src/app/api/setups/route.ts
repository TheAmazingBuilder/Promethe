import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { createSetup, listSetups } from "@/server/playbook";
import { setupInputSchema, zodFieldErrors } from "@/lib/validations/shared";

/**
 * GET  /api/setups — list (optional ?strategyId=).
 * POST /api/setups — create (invalidation is required).
 */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const url = new URL(req.url);
    const strategyId = url.searchParams.get("strategyId");
    const setups = await listSetups(session.user.id, strategyId);
    return NextResponse.json({ setups });
  } catch (error) {
    return apiError(error, "setups");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = setupInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Some fields are invalid.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 },
      );
    }
    const setup = await createSetup(session.user.id, parsed.data);
    if (!setup) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Strategy not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({ setup }, { status: 201 });
  } catch (error) {
    return apiError(error, "setups");
  }
}
