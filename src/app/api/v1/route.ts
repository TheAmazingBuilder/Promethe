import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1 — version index for the Promethe API.
 *
 * Static JSON, no auth and no database: clients use it to discover
 * the current version and its resources. See docs/API.md for the
 * auth schemes and the versioning rules.
 */
export async function GET() {
  return NextResponse.json({
    name: "Promethe API",
    version: "v1",
    status: "current",
    auth: {
      session: "Session cookie (browser clients)",
      cron: "Bearer CRON_SECRET (cron endpoints)",
      ingest: "Bearer broker token (ingest endpoints)",
    },
    resources: [
      "account",
      "accounts",
      "analytics",
      "appearance",
      "auth",
      "broker-sync",
      "calendar",
      "charts",
      "comments",
      "cron",
      "custom-fields",
      "custom-metrics",
      "dashboard",
      "dashboards",
      "display-preferences",
      "exit-plans",
      "exposure-settings",
      "fx-rates",
      "gaia",
      "goals",
      "history",
      "import",
      "ingest",
      "instruments",
      "integrations",
      "journal",
      "legal",
      "market-sessions",
      "notifications",
      "playbook",
      "profile",
      "prop-status",
      "public",
      "reconciliation",
      "reports",
      "risk-reward",
      "rules",
      "saved-views",
      "search",
      "setups",
      "share-links",
      "shortcuts",
      "strategies",
      "table-columns",
      "tags",
      "templates",
      "tool-scenarios",
      "trades",
      "trash",
      "uploads",
      "user-templates",
    ],
    docs: "docs/API.md",
    note:
      "Unversioned /api/... paths stay available as aliases during the transition. "
      + "The Google OAuth flow (/api/auth/google and /api/auth/google/callback) is unversioned by design.",
  });
}
