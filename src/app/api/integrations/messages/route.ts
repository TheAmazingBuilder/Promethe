/**
 * GET /api/integrations/messages - recent outbox rows (delivery journal),
 * newest first. ?limit= (default 50, max 100).
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const url = new URL(req.url);
    const rawLimit = Number(url.searchParams.get("limit") ?? "50");
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), 100)
      : 50;
    const rows = await db.outboundMessage.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { endpoint: { select: { label: true, type: true } } },
    });
    return NextResponse.json({
      messages: rows.map((m) => ({
        id: m.id,
        endpointId: m.endpointId,
        endpointLabel: m.endpoint.label,
        endpointType: m.endpoint.type,
        eventType: m.eventType,
        status: m.status,
        attempts: m.attempts,
        lastError: m.lastError,
        createdAt: m.createdAt.toISOString(),
        sentAt: m.sentAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    return apiError(error, "integrations/messages");
  }
}
