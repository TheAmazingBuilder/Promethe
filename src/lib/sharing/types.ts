/**
 * v3 — Sharing types (client-safe: imported by both the app UI and the
 * server). The ShareLink row itself is server-only; the DTO below never
 * carries the raw token (shown exactly once at creation).
 */
import type { RedactionPolicy } from "@/lib/redaction";

export type ShareLinkType = "TRADE" | "REPORT";
export type ShareLinkMode = "SNAPSHOT" | "LIVE";
export type ShareLinkStatus = "ACTIVE" | "EXPIRED" | "REVOKED" | "VIEW_LIMIT";

/** Own-links listing row (management view). No secrets, prefix only. */
export interface ShareLinkDTO {
  id: string;
  type: ShareLinkType;
  targetId: string;
  title: string;
  mode: ShareLinkMode;
  status: ShareLinkStatus;
  tokenPrefix: string;
  policy: RedactionPolicy;
  expiresAt: string;
  maxViews: number | null;
  viewCount: number;
  lastViewedAt: string | null;
  createdAt: string;
}

/** What the create call returns — the ONLY moment the raw URL exists. */
export interface CreatedShareLink {
  link: ShareLinkDTO;
  /** Absolute path ("/s/<raw-token>") — build the full origin client-side. */
  urlPath: string;
}

/** Redaction choices exposed in the share dialog. */
export interface SharePolicyInput {
  hideAmounts: boolean;
  hideAccountInfo: boolean;
  hideNotes: boolean;
  hideScreenshots: boolean;
  hideStrategyName: boolean;
  hideExactTimes: boolean;
  hidePsychology: boolean;
}

export interface CreateShareLinkInput {
  type: ShareLinkType;
  /** Required for TRADE — the trade to share. */
  tradeId?: string;
  /** Required for REPORT — the period the report covers. */
  reportPeriod?: {
    start: string; // YYYY-MM-DD
    end: string; // YYYY-MM-DD
    accountId?: string | null; // null = all accounts
  };
  title: string;
  mode: ShareLinkMode;
  policy: SharePolicyInput;
  /** Days from now; 7 | 30 | 90 | 365 | 3650 (10 y max — no "never"). */
  expiresInDays: number;
  /** Optional view cap (>= 1). */
  maxViews?: number | null;
}

// ── Public payloads (rendered by /s/[token], already redacted) ───────────────

export interface PublicScreenshotRef {
  id: string;
  label: string | null;
  caption: string | null;
  /** /api/public/media/<token>/<id> — filled by the resolver. */
  url: string;
}

/** Redacted TradeDetailDTO-shaped snapshot (keys absent when hidden). */
export interface PublicTradePayload {
  kind: "TRADE";
  title: string;
  mode: ShareLinkMode;
  capturedAt: string;
  policy: RedactionPolicy;
  trade: Record<string, unknown>;
  screenshots: PublicScreenshotRef[];
}

export interface PublicReportBreakdownRow {
  key: string;
  name: string;
  tradeCount: number;
  winRate: string | null;
  /** Structurally absent when the policy hides amounts. */
  netPnl?: string | null;
  totalR: string | null;
  avgR: string | null;
  profitFactor: string | null;
}

export interface PublicReportPayload {
  kind: "REPORT";
  title: string;
  mode: ShareLinkMode;
  capturedAt: string;
  policy: RedactionPolicy;
  period: { start: string; end: string };
  stats: Record<string, unknown>;
  equity: {
    points: Array<{ time: string; value: number }>;
    unit: "CURRENCY" | "PERCENT" | "R";
  };
  byStrategy: PublicReportBreakdownRow[];
  bySymbol: PublicReportBreakdownRow[];
}

export type PublicSharePayload = PublicTradePayload | PublicReportPayload;

/** Resolution outcome — GONE covers invalid/expired/revoked/view-limit so
 *  probing tokens cannot distinguish between the cases. */
export type ResolveResult =
  | { ok: true; payload: PublicSharePayload }
  | { ok: false; reason: "GONE" };
