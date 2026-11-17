import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { playbookOverview } from "@/server/playbook";

/** GET /api/playbook/overview — counts, compliance (last 20), health. */
export async function GET() {
  try {
    const session = await requireUser();
    const overview = await playbookOverview(session.user.id);
    return NextResponse.json({ overview });
  } catch (error) {
    return apiError(error, "playbook/overview");
  }
}
