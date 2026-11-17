import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { getDashboardData } from "@/server/dashboard-data";
import { dashboardDataQuerySchema, zodFieldErrors } from "@/lib/validations/shared";

/**
 * POST /api/dashboards/[id]/data — batched widget data for the whole
 * dashboard. Body: { preset, accountId? } (global filter); each widget
 * resolves its own period/account scope on top of it.
 */
type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = dashboardDataQuerySchema.safeParse(body ?? {});
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: "Some fields are invalid.",
          fieldErrors: zodFieldErrors(parsed.error),
        },
        { status: 422 }
      );
    }
    const payload = await getDashboardData(session.user.id, id, {
      preset: parsed.data.preset,
      accountId: parsed.data.accountId ?? null,
    });
    return NextResponse.json(payload);
  } catch (error) {
    return apiError(error, "dashboards/[id]/data");
  }
}
