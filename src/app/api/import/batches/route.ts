/**
 * POST /api/import/batches — open an import batch (after client-side parse
 * and preview). Warns when the same file hash was already imported.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { ImportError, createImportBatch } from "@/server/import";
import { importBatchCreateSchema } from "@/lib/validations/import";
import { zodFieldErrors } from "@/lib/validations/shared";

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = importBatchCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Some fields are invalid.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const result = await createImportBatch(session.user.id, parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ImportError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    return apiError(error, "import/batches");
  }
}
