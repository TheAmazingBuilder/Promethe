import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { listUserTemplates } from "@/server/dashboards";

/** GET /api/user-templates - the user's saved dashboard blueprints. */
export async function GET() {
  try {
    const session = await requireUser();
    const templates = await listUserTemplates(session.user.id);
    return NextResponse.json({ templates });
  } catch (error) {
    return apiError(error, "user-templates");
  }
}
