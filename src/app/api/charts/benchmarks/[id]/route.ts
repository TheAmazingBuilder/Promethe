import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { deleteBenchmark } from "@/server/charts";

/** DELETE /api/charts/benchmarks/[id] — remove (404 when not owned). */
type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const deleted = await deleteBenchmark(session.user.id, id);
    if (!deleted) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Benchmark introuvable." },
        { status: 404 }
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "charts/benchmarks/[id]");
  }
}
