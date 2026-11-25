/**
 * POST|GET /api/cron/economic-calendar - refresh the provider sources,
 * then check pre-event alerts. Same Bearer <redacted> auth as
 * /api/cron/daily and /api/cron/integrations (>= 16 chars, 503 when
 * unset). Idempotent - safe to re-run (per-source throttle + deduped
 * alerts). No external scheduler is wired yet (roadmap B7): call this
 * URL from an external scheduler, or refresh from the calendar page.
 * 200 { report } · 401 BAD_TOKEN · 503 CRON_SECRET_UNSET
 */
import { NextResponse } from "next/server";
import { constantTimeEqual } from "@/lib/tokens";
import { runEconomicCalendarSync } from "@/server/economic-calendar";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return constantTimeEqual(token, secret);
}

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) {
    console.error(
      "[cron/economic-calendar] CRON_SECRET is missing or too short - refusing to run.",
    );
    return NextResponse.json(
      { error: "CRON_SECRET_UNSET", message: "CRON_SECRET missing or too short." },
      { status: 503 },
    );
  }
  if (!authorized(req)) {
    return NextResponse.json(
      { error: "BAD_TOKEN", message: "Invalid cron token." },
      { status: 401 },
    );
  }
  const report = await runEconomicCalendarSync({ force: true });
  return NextResponse.json({ report });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
