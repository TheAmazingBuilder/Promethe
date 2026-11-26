/**
 * POST|GET /api/cron/integrations - drain the Discord / Telegram outbox,
 * then queue (and send) the daily summaries that are due, then drain again,
 * then drain the Web Push outbox. Same Bearer CRON_SECRET auth as
 * /api/cron/daily (>= 16 chars, 503 when unset). Idempotent - safe to re-run.
 *
 * NOTE - free Vercel plan: crons run at most once a day, so alerts are NOT
 * real time: they leave at the next cron pass. The settings page says so.
 * To send more often, add a second Vercel Cron entry pointing here (paid
 * plan) or call this URL from an external scheduler.
 * 200 { report } · 401 BAD_TOKEN · 503 CRON_SECRET_UNSET
 */
import { NextResponse } from "next/server";
import { constantTimeEqual } from "@/lib/tokens";
import {
  processOutbox,
  sendDailySummariesDue,
} from "@/server/integrations/delivery";
import { processPushOutbox } from "@/server/push/delivery";

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
      "[cron/integrations] CRON_SECRET is missing or too short - refusing to run."
    );
    return NextResponse.json(
      { error: "CRON_SECRET_UNSET", message: "CRON_SECRET missing or too short." },
      { status: 503 }
    );
  }
  if (!authorized(req)) {
    return NextResponse.json(
      { error: "BAD_TOKEN", message: "Invalid cron token." },
      { status: 401 }
    );
  }
  const firstPass = await processOutbox();
  const summaries = await sendDailySummariesDue();
  const secondPass = await processOutbox();
  const pushOutbox = await processPushOutbox();
  return NextResponse.json({
    report: {
      outboxFirstPass: firstPass,
      summaries,
      outboxSecondPass: secondPass,
      pushOutbox,
    },
  });
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}
