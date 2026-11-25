/**
 * Shared API error mapping — every route handler wraps its body with the same
 * try/catch so typed errors (unauthorized, validation, not found) map to
 * consistent envelopes and raw Prisma/provider errors NEVER reach the client.
 */
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { UnauthorizedError } from "@/server/session";
import { TradeValidationError } from "@/server/trades";
import { TemplateValidationError } from "@/server/templates";
import { UploadValidationError } from "@/server/uploads";
import { ShareValidationError } from "@/server/sharing";
import { CommentValidationError } from "@/server/comments";
import { InstrumentValidationError } from "@/server/instruments";
import { DashboardValidationError } from "@/server/dashboards";
import { AccessDeniedError } from "@/lib/access";
import {
  ToolsTablesMissingError,
  ToolsValidationError,
} from "@/server/tools";
import { IntegrationValidationError } from "@/server/integrations/endpoints";
import { AccountNotFoundError } from "@/server/account-errors";

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
  MANUAL_PNL_REQUIRED:
    "A manual P&L is required: enter the broker's net P&L or switch back to calculated P&L.",
  INVALID_DATE: "Invalid date.",
  TRADES_ON_ACCOUNT: "This account contains trades – archiving only.",
  UNSUPPORTED_TYPE: "Unsupported file type (PNG, JPEG or WebP).",
  INVALID_IMAGE: "The uploaded file is not a valid PNG, JPEG or WebP image.",
  FILE_TOO_LARGE: "File too large (max 5 MB).",
  INVALID_SCREENSHOT_LABEL: "Choose a valid screenshot stage (Before, Entry, Exit or After).",
  SCREENSHOT_CAPTION_TOO_LONG: "Screenshot captions cannot exceed 500 characters.",
  STORAGE_UNAVAILABLE: "Screenshot storage is not configured or temporarily unavailable.",
  TRADE_NOT_FOUND: "Screenshot attached to a missing trade.",
  INVALID_PERIOD: "Invalid report period.",
  SHARE_TRADE_NOT_FOUND: "Trade not found – cannot share it.",
  // Trade comments (owner-only)
  ACCESS_DENIED: "Access denied.",
  COMMENT_NOT_FOUND: "Comment not found.",
  COMMENT_DELETED: "This comment has been deleted.",
  COMMENT_RATE_LIMITED: "Too many comments – please wait a moment.",
  PARENT_INVALID: "Invalid parent comment.",
  // v1 Phase 7 — instruments personnalisés
  INSTRUMENT_DUPLICATE: "You already have an instrument with this symbol.",
  INSTRUMENT_PIP_INVALID: "Invalid pip size (e.g. 0.0001 or 0.01 for XAUUSD).",
  INSTRUMENT_HAS_TRADES: "Trades reference this instrument – deletion not possible.",
  // v2.5 Module 4 — productivity (custom fields, bulk edits)
  CUSTOM_FIELDS_INVALID: "Some custom fields are invalid.",
  TOO_MANY_CUSTOM_FIELDS: "Limit of 30 custom fields reached.",
  DASHBOARD_NOT_FOUND: "Dashboard not found.",
  WIDGET_NOT_FOUND: "Widget not found.",
  STALE_LAYOUT: "This layout changed elsewhere. Reload to get the latest version, then try again.",
  DEFAULT_REQUIRED: "A default dashboard is required.",
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
  INVALID_QUIET_HOURS: "Invalid quiet hours (format HH:mm).",
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
    error instanceof CommentValidationError ||
    error instanceof InstrumentValidationError ||
    error instanceof DashboardValidationError ||
    error instanceof ToolsValidationError ||
    error instanceof ToolsTablesMissingError ||
    error instanceof IntegrationValidationError ||
    error instanceof AccountNotFoundError ||
    error instanceof AccessDeniedError
  );
}

/**
 * Correlation id for one error response: the client can quote it in a bug
 * report and the matching server log line carries the same id, so a failed
 * request can be diagnosed without logging (or returning) any user data.
 * One id per error response - there is no middleware to mint a per-request
 * id, and apiError is the single funnel every route error passes through.
 */
export function apiError(error: unknown, route: string): NextResponse {
  const requestId = randomUUID();
  if (error instanceof UnauthorizedError) {
    return NextResponse.json(
      {
        error: "UNAUTHORIZED",
        message: "Session missing or expired.",
        requestId,
      },
      { status: 401 }
    );
  }
  if (isCoded(error)) {
    return NextResponse.json(
      {
        error: error.code,
        message: CODE_MESSAGES[error.code] ?? "Invalid request.",
        requestId,
      },
      { status: error.status }
    );
  }
  console.error(`[api/${route}] failed [${requestId}]:`, error);
  return NextResponse.json(
    {
      error: "INTERNAL",
      message: "An error occurred. Please try again.",
      requestId,
    },
    { status: 500 }
  );
}
