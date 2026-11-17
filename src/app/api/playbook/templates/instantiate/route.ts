import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { instantiateTemplate } from "@/server/playbook";
import { instantiateTemplateSchema, zodFieldErrors } from "@/lib/validations/shared";

/**
 * POST /api/playbook/templates/instantiate — creates a DRAFT strategy (with
 * its setups) from a code template. No grade, no history.
 */
export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = instantiateTemplateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Some fields are invalid.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 },
      );
    }
    const strategy = await instantiateTemplate(
      session.user.id,
      parsed.data.key,
      parsed.data.name ?? null,
    );
    if (!strategy) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Template not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({ strategy }, { status: 201 });
  } catch (error) {
    return apiError(error, "playbook/templates/instantiate");
  }
}
