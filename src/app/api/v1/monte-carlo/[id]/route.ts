import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { deleteMonteCarloRun, getMonteCarloRun } from "@/server/monte-carlo";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const run = await getMonteCarloRun(session.user.id, id);
    if (!run) return NextResponse.json({ error: "NOT_FOUND", message: "Simulation not found." }, { status: 404 });
    return NextResponse.json({ run });
  } catch (error) {
    return apiError(error, "monte-carlo/[id]");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const deleted = await deleteMonteCarloRun(session.user.id, id);
    if (!deleted) return NextResponse.json({ error: "NOT_FOUND", message: "Simulation not found." }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "monte-carlo/[id]");
  }
}
