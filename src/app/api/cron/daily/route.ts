/**
 * POST|GET /api/cron/daily — daily maintenance (sandbox equivalent of Vercel
 * Cron; call it with any scheduler: `curl -X POST -H "Authorization: Bearer
 * $CRON_SECRET" $APP_URL/api/cron/daily`).
 *
 * Steps: due account deletions (RGPD grace elapsed), rate-limit pruning,
 * sync payload purge (14 d), merge undo cleanup (30 d), invitation expiry,
 * share-link cleanup, notification pruning. Idempotent — safe to re-run.
 * 200 { report } · 401 BAD_TOKEN · 503 CRON_SECRET_UNSET
 */
import { NextResponse } from "next/server";
import { runDailyMaintenance } from "@/server/maintenance";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return token.length === secret.length && token === secret;
}

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) {
    console.error("[cron/daily] CRON_SECRET is missing or too short - refusing to run.");
    return NextResponse.json(
      { error: "CRON_SECRET_UNSET", message: "CRON_SECRET manquant ou trop court." },
      { status: 503 }
    );
  }
  if (!authorized(req)) {
    return NextResponse.json(
      { error: "BAD_TOKEN", message: "Jeton cron invalide." },
      { status: 401 }
    );
  }
  const report = await runDailyMaintenance();
  return NextResponse.json({ report });
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}
