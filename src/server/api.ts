/**
 * Shared API error mapping — every route handler wraps its body with the same
 * try/catch so typed errors (unauthorized, validation, not found) map to
 * consistent envelopes and raw Prisma/provider errors NEVER reach the client.
 */
import { NextResponse } from "next/server";
import { UnauthorizedError } from "@/server/session";
import { TradeValidationError } from "@/server/trades";
import { TemplateValidationError } from "@/server/templates";
import { UploadValidationError } from "@/server/uploads";
import { ShareValidationError } from "@/server/sharing";
import { MentorValidationError } from "@/server/mentors";
import { CommentValidationError } from "@/server/comments";
import { UserValidationError } from "@/server/users";
import { InstrumentValidationError } from "@/server/instruments";
import { DashboardValidationError } from "@/server/dashboards";
import { AccessDeniedError } from "@/lib/access";
import {
  ToolsTablesMissingError,
  ToolsValidationError,
} from "@/server/tools";
import { IntegrationValidationError } from "@/server/integrations/endpoints";

type CodedError = {
  code: string;
  status: number;
};

const CODE_MESSAGES: Record<string, string> = {
  ACCOUNT_NOT_FOUND: "Account not found.",
  INSTRUMENT_NOT_FOUND: "Instrument not found.",
  STRATEGY_NOT_FOUND: "Strategy not found.",
  TAG_NOT_FOUND: "Tag not found.",
  CHECKLIST_NOT_FOUND: "Checklist item not found.",
  EXIT_PRICE_REQUIRED: "An exit price is required to close a trade.",
  ALREADY_CLOSED: "This trade is already closed.",
  INVALID_DATE: "Invalid date.",
  TRADES_ON_ACCOUNT: "This account contains trades – archiving only.",
  UNSUPPORTED_TYPE: "Unsupported file type (PNG, JPEG or WebP).",
  INVALID_IMAGE: "The uploaded file is not a valid PNG, JPEG or WebP image.",
  FILE_TOO_LARGE: "File too large (max 5 MB).",
  STORAGE_UNAVAILABLE: "Screenshot storage is not configured or temporarily unavailable.",
  TRADE_NOT_FOUND: "Screenshot attached to a missing trade.",
  INVALID_PERIOD: "Invalid report period.",
  SHARE_TRADE_NOT_FOUND: "Trade not found – cannot share it.",
  // v3 Phase 5 — mentoring & comments
  ACCESS_DENIED: "Access denied.",
  HANDLE_INVALID: "Invalid handle (a-z, 0-9, _, 3–24 characters).",
  HANDLE_TAKEN: "This handle is already taken.",
  HANDLE_REQUIRED: "Choose your handle first.",
  SELF_INVITE: "You cannot invite yourself.",
  INVITE_ALREADY_PENDING: "An invitation is already pending for this email.",
  MENTOR_ALREADY_ACTIVE: "This mentor already has active access.",
  TOO_MANY_PENDING: "Too many pending invitations.",
  INVITE_RATE_LIMITED: "Too many invitations sent today.",
  INVITE_NOT_FOUND: "Invitation not found.",
  INVITE_NOT_PENDING: "This invitation has already been handled.",
  INVITE_EXPIRED: "This invitation has expired.",
  ACCESS_NOT_FOUND: "Mentorship access not found.",
  ACCESS_REVOKED: "This access has been revoked.",
  COMMENT_NOT_FOUND: "Comment not found.",
  COMMENT_DELETED: "This comment has been deleted.",
  COMMENT_RATE_LIMITED: "Too many comments – please wait a moment.",
  PARENT_INVALID: "Invalid parent comment.",
  MENTION_INVALID: "Mention not possible: this person does not have access to this trade.",
  // v1 Phase 7 — instruments personnalisés
  INSTRUMENT_DUPLICATE: "You already have an instrument with this symbol.",
  INSTRUMENT_PIP_INVALID: "Invalid pip size (e.g. 0.0001 or 0.01 for XAUUSD).",
  INSTRUMENT_HAS_TRADES: "Trades reference this instrument – deletion not possible.",
  // v2.5 Module 4 — productivity (custom fields, bulk edits)
  CUSTOM_FIELDS_INVALID: "Some custom fields are invalid.",
  TOO_MANY_CUSTOM_FIELDS: "Limit of 30 custom fields reached.",
  DASHBOARD_NOT_FOUND: "Dashboard not found.",
  WIDGET_NOT_FOUND: "Widget not found.",
  TOO_MANY_DASHBOARDS: "Dashboard limit reached (max 8).",
  LAST_DASHBOARD: "The last dashboard cannot be deleted.",
  TOO_MANY_WIDGETS: "Widget limit reached for this dashboard (max 24).",
  UNKNOWN_WIDGET_TYPE: "Unknown widget type.",
  INVALID_CONFIG: "Invalid widget configuration.",
  TEMPLATE_NOT_FOUND: "Template not found.",
  IMPORT_TOO_LARGE: "Import file too large (max 256 KB).",
  IMPORT_INVALID_JSON: "Import file is not valid JSON.",
  METRIC_NOT_FOUND: "Custom metric not found.",
  TOO_MANY_METRICS: "Custom metric limit reached (max 50).",
  FORMULA_INVALID: "Invalid formula expression.",
  // v2.5 Module 5 — trading tools
  TOOLS_TABLES_MISSING:
    "The tools tables do not exist in the database yet. Run `npx prisma db push` on your PC, then reload the page.",
  FX_RATE_SAME_CURRENCY: "The base currency and the quote currency must differ.",
  FX_RATE_DUPLICATE: "A rate already exists for this pair.",
  EXIT_PLAN_NOT_FOUND: "Exit plan not found.",
  EXIT_PLAN_INVALID: "Tiers must total 100% with positive targets.",
  // v2.5 Module 9 — Discord / Telegram integrations
  ENCRYPTION_KEY_MISSING:
    "The integrations encryption key is not configured. Set INTEGRATION_ENCRYPTION_KEY on the server.",
  ENCRYPTION_KEY_INVALID:
    "INTEGRATION_ENCRYPTION_KEY is invalid (32 bytes, hex or base64).",
  INVALID_ENDPOINT_TYPE: "Invalid integration type.",
  INVALID_LABEL: "Invalid name (1 to 60 characters).",
  TOO_MANY_ENDPOINTS: "Limit of 10 integrations reached.",
  INVALID_WEBHOOK_URL:
    "Invalid Discord webhook URL (expected format: https://discord.com/api/webhooks/<id>/<token>).",
  WEBHOOK_NOT_HTTPS: "The webhook URL must start with https://.",
  WEBHOOK_HOST_NOT_ALLOWED:
    "Unauthorized host: only discord.com and discordapp.com are accepted.",
  INVALID_TELEGRAM_TOKEN:
    "Invalid Telegram bot token (expected format: <id>:<token>).",
  INVALID_CHAT_ID:
    "Invalid chat ID (a number, or @channel name).",
  INVALID_QUIET_HOURS: "Heures calmes invalides (format HH:mm).",
  INVALID_PRIVACY_LEVEL: "Invalid privacy level.",
  INVALID_EVENT_TYPE: "Invalid event type.",
  INVALID_VALUE: "Invalid value.",
  ENDPOINT_NOT_FOUND: "Integration not found.",
  SUBSCRIPTION_NOT_FOUND: "Subscription not found.",
  ENDPOINT_DISABLED: "This integration is disabled.",
  TELEGRAM_API_ERROR:
    "Telegram did not respond or the token is invalid.",
  TEST_FAILED: "The test message could not be sent.",
};

function isCoded(error: unknown): error is CodedError {
  return (
    error instanceof TradeValidationError ||
    error instanceof TemplateValidationError ||
    error instanceof UploadValidationError ||
    error instanceof ShareValidationError ||
    error instanceof MentorValidationError ||
    error instanceof CommentValidationError ||
    error instanceof UserValidationError ||
    error instanceof InstrumentValidationError ||
    error instanceof DashboardValidationError ||
    error instanceof ToolsValidationError ||
    error instanceof ToolsTablesMissingError ||
    error instanceof IntegrationValidationError ||
    error instanceof AccessDeniedError
  );
}

export function apiError(error: unknown, route: string): NextResponse {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Session missing or expired." },
      { status: 401 }
    );
  }
  if (isCoded(error)) {
    return NextResponse.json(
      {
        error: error.code,
        message: CODE_MESSAGES[error.code] ?? "Invalid request.",
      },
      { status: error.status }
    );
  }
  console.error(`[api/${route}] failed:`, error);
  return NextResponse.json(
    { error: "INTERNAL", message: "An error occurred. Please try again." },
    { status: 500 }
  );
}
