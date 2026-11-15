import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { createCustomMetric, listCustomMetrics } from "@/server/custom-metrics";
import { customMetricInputSchema, zodFieldErrors } from "@/lib/validations/shared";

/**
 * GET  /api/custom-metrics — saved metrics (definition JSON parsed).
 * POST /api/custom-metrics — create (formula parsed/validated, limit 50).
 */
export async function GET() {
  try {
    const session = await requireUser();
    const metrics = await listCustomMetrics(session.user.id);
    return NextResponse.json({ metrics });
  } catch (error) {
    return apiError(error, "custom-metrics");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = customMetricInputSchema.safeParse(body);
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
    const metric = await createCustomMetric(session.user.id, parsed.data);
    return NextResponse.json({ metric }, { status: 201 });
  } catch (error) {
    return apiError(error, "custom-metrics");
  }
}
