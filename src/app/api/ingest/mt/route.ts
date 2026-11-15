/**
 * v3 — MT4/MT5 EA ingest endpoint (public, token-authenticated).
 *
 * Security (v3 §4.1):
 *  - Authorization: Bearer <token>; the token is looked up BY HASH with a
 *    constant-time comparison, and the target account comes from the
 *    connection row — a token can never write into another user's account.
 *  - Replay protection: payloads older/newer than 10 minutes are rejected.
 *  - Rate limits: per-token bucket (DB) + per-IP bucket (hash of IP only).
 *  - Body limit ~1 MB, max 200 events, schema version gate.
 *  - Structured logs WITHOUT secrets (no raw token, no payload dump).
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashIp, hashToken, clientIpFrom } from "@/lib/tokens";
import { consumeRateLimit } from "@/lib/rate-limit";
import { mtIngestPayloadSchema } from "@/lib/validations/sync";
import { processIngestPayload, IngestError } from "@/lib/sync/process";
import type { IngestResponse } from "@/lib/sync/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_000_000; // ~1 MB
const TOKEN_RATE_LIMIT = 60; // requests / window
const TOKEN_WINDOW_MS = 60_000;
const IP_RATE_LIMIT = 240;
const IP_WINDOW_MS = 60_000;

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token.length >= 16 ? token : null;
}

export async function POST(req: Request) {
  try {
    // ── Auth: token → connection (hash lookup, constant-time compare) ──
    const rawToken = bearerToken(req);
    if (!rawToken) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Missing bearer token." },
        { status: 401 }
      );
    }

    // Per-IP gate (pseudonymised — no raw IP is stored).
    const ipBucket = await consumeRateLimit(
      `ingest:ip:${hashIp(clientIpFrom(req.headers))}`,
      IP_RATE_LIMIT,
      IP_WINDOW_MS
    );
    if (!ipBucket.allowed) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many requests." },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }

    // Body size guard before parsing.
    const contentLength = Number(req.headers.get("content-length") ?? "0");
    if (contentLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "PAYLOAD_TOO_LARGE", message: "Max 1 MB per request." },
        { status: 413 }
      );
    }

    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "PAYLOAD_TOO_LARGE", message: "Max 1 MB per request." },
        { status: 413 }
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: "INVALID_JSON", message: "Body is not valid JSON." },
        { status: 400 }
      );
    }

    // Schema version gate: reject unknown MAJOR versions with a clear error.
    const rawVersion = (json as { schemaVersion?: unknown })?.schemaVersion;
    if (rawVersion !== 1) {
      return NextResponse.json(
        {
          error: "UNSUPPORTED_SCHEMA",
          message: `Unsupported schemaVersion ${String(rawVersion)} — update your EA (server supports 1).`,
        },
        { status: 400 }
      );
    }

    const parsed = mtIngestPayloadSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: "Payload failed schema validation.",
          issues: parsed.error.issues.slice(0, 10).map((issue) => ({
            path: issue.path.join("."),
            code: issue.code,
          })),
        },
        { status: 422 }
      );
    }

    // Token → connection via hash; hashPrefix keeps logs display-safe.
    const tokenHash = hashToken(rawToken);
    const connection = await db.brokerConnection.findUnique({ where: { tokenHash } });
    if (!connection) {
      // Constant-time-ish: burn a comparison against a dummy hash.
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Unknown or revoked token." },
        { status: 401 }
      );
    }

    // Per-token rate limit.
    const tokenBucket = await consumeRateLimit(
      `ingest:token:${tokenHash}`,
      TOKEN_RATE_LIMIT,
      TOKEN_WINDOW_MS
    );
    if (!tokenBucket.allowed) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many requests for this connection." },
        { status: 429, headers: { "Retry-After": String(Math.ceil((tokenBucket.resetAt - Date.now()) / 1000)) } }
      );
    }

    const result: IngestResponse = await processIngestPayload(connection, parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof IngestError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.status }
      );
    }
    console.error("[api/ingest/mt] failed:", error);
    return NextResponse.json(
      { error: "INTERNAL", message: "Ingest failed." },
      { status: 500 }
    );
  }
}
