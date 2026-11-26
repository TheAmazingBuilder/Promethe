/**
 * POST /api/import/batches/[id]/complete — close the batch, record final
 * counts (status IMPORTED / PARTIAL) and run the reconciliation matcher.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { ImportError, completeImportBatch, recordBatchCounts } from "@/server/import";
import { importBatchCountsSchema } from "@/lib/validations/import";
import { zodFieldErrors } from "@/lib/validations/shared";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = importBatchCountsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Invalid counters.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const batch = await recordBatchCounts(session.user.id, id, parsed.data);
    const result = await completeImportBatch(session.user.id, id);
    return NextResponse.json({ batch, reconciliation: result.reconciliation });
  } catch (error) {
    if (error instanceof ImportError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    return apiError(error, "import/batches/complete");
  }
}
