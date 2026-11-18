import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { installGlobalChecklist } from "@/server/playbook";

/**
 * POST /api/playbook/checklists/install-global — adds the universal
 * pre-trade checklist as a global template (idempotent by name).
 */
export async function POST() {
  try {
    const session = await requireUser();
    const checklist = await installGlobalChecklist(session.user.id);
    return NextResponse.json({ checklist });
  } catch (error) {
    return apiError(error, "playbook/checklists/install-global");
  }
}
