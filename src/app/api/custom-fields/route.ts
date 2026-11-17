import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import {
  createCustomFieldDefinition,
  listCustomFieldDefinitions,
  CustomFieldValidationError,
} from "@/server/custom-fields";
import {
  customFieldDefinitionInputSchema,
  zodFieldErrors,
} from "@/lib/validations/shared";

/**
 * GET  /api/custom-fields?archived=1 - definitions (active by default).
 * POST /api/custom-fields - create (max 30 active).
 */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const archived = new URL(req.url).searchParams.get("archived") === "1";
    const definitions = await listCustomFieldDefinitions(session.user.id, {
      includeArchived: archived,
    });
    return NextResponse.json({ definitions });
  } catch (error) {
    return apiError(error, "custom-fields");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = customFieldDefinitionInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Some fields are invalid.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const definition = await createCustomFieldDefinition(session.user.id, parsed.data);
    return NextResponse.json({ definition }, { status: 201 });
  } catch (error) {
    if (error instanceof CustomFieldValidationError) {
      return NextResponse.json(
        { error: error.message, message: "Limit of 30 custom fields reached." },
        { status: 422 }
      );
    }
    return apiError(error, "custom-fields");
  }
}
