import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { createPlaybookRule, listPlaybookRules } from "@/server/playbook";
import { playbookRuleInputSchema, zodFieldErrors } from "@/lib/validations/shared";

/** GET /api/playbook/rules — list. POST — create. */
export async function GET() {
  try {
    const session = await requireUser();
    const rules = await listPlaybookRules(session.user.id);
    return NextResponse.json({ rules });
  } catch (error) {
    return apiError(error, "playbook/rules");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = playbookRuleInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Some fields are invalid.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 },
      );
    }
    const rule = await createPlaybookRule(session.user.id, parsed.data);
    if (!rule) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Strategy not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    return apiError(error, "playbook/rules");
  }
}
