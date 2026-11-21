/**
 * v3 — EA ping endpoint: token validation + remote config.
 *
 * Lets the user change settings (history backfill window, heartbeat cadence)
 * from the web app instead of recompiling the EA. Also used by the setup
 * wizard's "test connection" button.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashIp, hashToken, clientIpFrom } from "@/lib/tokens";
import { consumeRateLimit } from "@/lib/rate-limit";
import { isRevokedConnection } from "@/lib/sync/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IP_RATE_LIMIT = 240;
const IP_WINDOW_MS = 60_000;
export const HEARTBEAT_MINUTES = 5;

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token.length >= 16 ? token : null;
}

export async function GET(req: Request) {
  const rawToken = bearerToken(req);
  if (!rawToken) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Missing bearer token." },
      { status: 401 }
    );
  }

  const ipBucket = await consumeRateLimit(
    `ingest:ping:${hashIp(clientIpFrom(req.headers))}`,
    IP_RATE_LIMIT,
    IP_WINDOW_MS
  );
  if (!ipBucket.allowed) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  const tokenHash = hashToken(rawToken);
  const connection = await db.brokerConnection.findUnique({ where: { tokenHash } });
  if (!connection || isRevokedConnection(connection)) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Unknown or revoked token." },
      { status: 401 }
    );
  }

  return NextResponse.json({
    serverTime: Math.floor(Date.now() / 1000),
    bound: connection.brokerServer !== null,
    status: connection.status,
    historyBackfillFrom: connection.historyBackfillFrom
      ? Math.floor(connection.historyBackfillFrom.getTime() / 1000)
      : null,
    heartbeatMinutes: HEARTBEAT_MINUTES,
  });
}
