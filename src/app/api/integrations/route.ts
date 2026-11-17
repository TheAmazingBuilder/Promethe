/**
 * GET  /api/integrations - overview: endpoints, subscriptions, recent
 *        outbox messages, encryption key status. Secrets are never returned.
 * POST /api/integrations - create an endpoint (Discord webhook or Telegram
 *        bot). Body: { type, label, secret, chatId? }.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import {
  createEndpoint,
  listIntegrations,
} from "@/server/integrations/endpoints";

export async function GET() {
  try {
    const session = await requireUser();
    const overview = await listIntegrations(session.user.id);
    return NextResponse.json(overview);
  } catch (error) {
    return apiError(error, "integrations");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = (await req.json().catch(() => null)) as {
      type?: unknown;
      label?: unknown;
      secret?: unknown;
      chatId?: unknown;
    } | null;
    if (!body) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Requête invalide." },
        { status: 422 }
      );
    }
    const endpoint = await createEndpoint(session.user.id, body);
    return NextResponse.json({ endpoint }, { status: 201 });
  } catch (error) {
    return apiError(error, "integrations");
  }
}
