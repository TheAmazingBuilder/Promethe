/**
 * PATCH  /api/integrations/[id] - rename, enable/disable, change chat id,
 *          rotate the secret. Body: { label?, isEnabled?, chatId?, secret? }.
 * DELETE /api/integrations/[id] - remove the endpoint (subscriptions and
 *          outbox rows cascade).
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import {
  deleteEndpoint,
  updateEndpoint,
} from "@/server/integrations/endpoints";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => null)) as {
      label?: unknown;
      isEnabled?: unknown;
      chatId?: unknown;
      secret?: unknown;
    } | null;
    if (!body) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Requête invalide." },
        { status: 422 }
      );
    }
    const endpoint = await updateEndpoint(session.user.id, id, body);
    return NextResponse.json({ endpoint });
  } catch (error) {
    return apiError(error, "integrations/[id]");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const deleted = await deleteEndpoint(session.user.id, id);
    if (!deleted) {
      return NextResponse.json(
        { error: "ENDPOINT_NOT_FOUND", message: "Intégration introuvable." },
        { status: 404 }
      );
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return apiError(error, "integrations/[id]");
  }
}
