import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { installExampleRules } from "@/server/playbook";

/**
 * POST /api/playbook/rules/install-examples — adds the 6 example rules
 * from code (idempotent by title). Returns how many were added.
 */
export async function POST() {
  try {
    const session = await requireUser();
    const added = await installExampleRules(session.user.id);
    return NextResponse.json({ added });
  } catch (error) {
    return apiError(error, "playbook/rules/install-examples");
  }
}
