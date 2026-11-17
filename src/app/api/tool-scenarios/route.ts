import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import {
  createToolScenario,
  listToolScenarios,
} from "@/server/tools";
import {
  toolScenarioInputSchema,
  zodFieldErrors,
} from "@/lib/validations/shared";

/**
 * GET  /api/tool-scenarios?kind=MULTI_TP - saved calculator scenarios.
 * POST /api/tool-scenarios - create (payload is the calculator state).
 */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const kind = new URL(req.url).searchParams.get("kind") ?? undefined;
    const scenarios = await listToolScenarios(session.user.id, kind);
    return NextResponse.json({ scenarios });
  } catch (error) {
    return apiError(error, "tool-scenarios");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = toolScenarioInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Certains champs sont invalides.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const scenario = await createToolScenario(session.user.id, parsed.data);
    return NextResponse.json({ scenario }, { status: 201 });
  } catch (error) {
    return apiError(error, "tool-scenarios");
  }
}
