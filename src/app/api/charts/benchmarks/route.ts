import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { createBenchmark, listBenchmarks } from "@/server/charts";
import { benchmarkInputSchema } from "@/lib/validations/charts";
import { zodFieldErrors } from "@/lib/auth/validators";

/**
 * GET  /api/charts/benchmarks — the user's benchmark profiles.
 * POST /api/charts/benchmarks — create (fixed %/period, fixed R/period, custom CSV series).
 */
export async function GET() {
  try {
    const session = await requireUser();
    const benchmarks = await listBenchmarks(session.user.id);
    return NextResponse.json({ benchmarks });
  } catch (error) {
    return apiError(error, "charts/benchmarks");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = benchmarkInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: "Invalid benchmark.",
          fieldErrors: zodFieldErrors(parsed.error),
        },
        { status: 422 }
      );
    }
    const benchmark = await createBenchmark(session.user.id, parsed.data);
    return NextResponse.json({ benchmark }, { status: 201 });
  } catch (error) {
    return apiError(error, "charts/benchmarks");
  }
}
