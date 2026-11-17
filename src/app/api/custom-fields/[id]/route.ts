import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import {
  deleteCustomFieldDefinition,
  updateCustomFieldDefinition,
} from "@/server/custom-fields";
import {
  customFieldDefinitionPatchSchema,
  zodFieldErrors,
} from "@/lib/validations/shared";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH  /api/custom-fields/[id] - edit, or archive via { archived: true }.
 * DELETE /api/custom-fields/[id] - hard delete (trade values are keyed
 * JSON; orphan keys are dropped by the dynamic validator on next write).
 */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = customFieldDefinitionPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Certains champs sont invalides.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const definition = await updateCustomFieldDefinition(session.user.id, id, parsed.data);
    if (!definition) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Champ introuvable." },
        { status: 404 }
      );
    }
    return NextResponse.json({ definition });
  } catch (error) {
    return apiError(error, "custom-fields/[id]");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const ok = await deleteCustomFieldDefinition(session.user.id, id);
    if (!ok) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Champ introuvable." },
        { status: 404 }
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "custom-fields/[id]");
  }
}
