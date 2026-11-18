/**
 * POST /api/import/batches/[id]/rows — import ONE chunk (≤ 200 rows) of
 * normalized trades + cash. Returns per-chunk counters and row errors.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { ImportError, importChunk } from "@/server/import";
import { importChunkSchema } from "@/lib/validations/import";
import { zodFieldErrors } from "@/lib/validations/shared";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = importChunkSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Invalid chunk.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const result = await importChunk(session.user.id, id, parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ImportError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    return apiError(error, "import/batches/rows");
  }
}
