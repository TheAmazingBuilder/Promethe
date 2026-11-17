import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { listPlaybookTemplates } from "@/server/playbook";

/**
 * GET /api/playbook/templates — the 10 strategy templates (code-only
 * content, never seeded in the database).
 */
export async function GET() {
  try {
    await requireUser();
    const templates = listPlaybookTemplates().map((t) => ({
      key: t.key,
      name: t.name,
      description: t.description,
      tradingStyle: t.tradingStyle,
      marketConditions: t.marketConditions,
      tags: t.tags,
    }));
    return NextResponse.json({ templates });
  } catch (error) {
    return apiError(error, "playbook/templates");
  }
}
