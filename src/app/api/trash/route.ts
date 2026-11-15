import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import {
  deleteTrashItemsPermanently,
  emptyTrash,
  listTrash,
  restoreTrashItems,
  trashCounts,
} from "@/server/trash";
import { trashActionSchema, trashListQuerySchema } from "@/lib/validations/trash";
import { zodFieldErrors } from "@/lib/validations/shared";

/**
 * GET  /api/trash?entity=TRADE&search=… — trashed items (all entities by
 *      default) + per-entity counts.
 * POST /api/trash — { action: "restore" | "delete", items } | { action: "empty" }.
 *      Every id is ownership-checked; nothing outside the current user's
 *      trash is ever touched.
 */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const params = new URL(req.url).searchParams;
    const parsed = trashListQuerySchema.safeParse({
      entity: params.get("entity") || undefined,
      search: params.get("search") || undefined,
      limit: params.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Invalid trash query.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    if (parsed.data.entity == null && parsed.data.search == null && parsed.data.limit == null) {
      // Plain /api/trash — list + counts in one round trip.
      const result = await listTrash(session.user.id);
      return NextResponse.json(result);
    }
    const [result, counts] = await Promise.all([
      listTrash(session.user.id, {
        entity: parsed.data.entity ?? null,
        search: parsed.data.search ?? null,
        limit: parsed.data.limit,
      }),
      parsed.data.entity != null ? trashCounts(session.user.id) : Promise.resolve(null),
    ]);
    return NextResponse.json({ ...result, counts: counts ?? result.counts });
  } catch (error) {
    return apiError(error, "trash");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = trashActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Invalid trash action.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    if (parsed.data.action === "restore") {
      const result = await restoreTrashItems(session.user.id, parsed.data.items);
      return NextResponse.json(result);
    }
    if (parsed.data.action === "delete") {
      const result = await deleteTrashItemsPermanently(session.user.id, parsed.data.items);
      return NextResponse.json(result);
    }
    const result = await emptyTrash(session.user.id);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error, "trash");
  }
}
