import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { listPlaybookStrategies } from "@/server/playbook";

/**
 * GET /api/playbook/strategies — every status (including archived), with
 * setups and attached-trade counts for the Playbook page.
 */
export async function GET() {
  try {
    const session = await requireUser();
    const strategies = await listPlaybookStrategies(session.user.id);
    return NextResponse.json({ strategies });
  } catch (error) {
    return apiError(error, "playbook/strategies");
  }
}
