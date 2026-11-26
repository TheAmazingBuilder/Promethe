/**
 * v3 — Snapshot builders (server): turn owner data into PUBLIC payloads.
 *
 * Security invariants (v3 §4.4):
 *  - Everything returned here has gone through the redaction engine — hidden
 *    fields are structurally ABSENT from the stored snapshot / response.
 *  - Screenshot URLs embed the raw share token, which only exists in the
 *    visitor's URL bar — snapshots store refs (ids) and the resolver injects
 *    the token at read time. The raw token is never persisted anywhere.
 *  - A runtime leak guard (assertNoLeaks) runs before every public response.
 */
import { getTradeDetail } from "@/server/trades";
import {
  parseRedactionPolicy,
  redactEquityCurve,
  redactStats,
  redactTrade,
  type RedactionPolicy,
} from "@/lib/redaction";
import type {
  PublicReportPayload,
  PublicScreenshotRef,
  PublicSharePayload,
  PublicTradePayload,
  ShareLinkMode,
} from "./types";

/** Raw trade snapshot (before URL injection) - what lands in snapshotJson. */
export interface TradeSnapshotStored {
  kind: "TRADE";
  title: string;
  mode: ShareLinkMode;
  capturedAt: string;
  policy: RedactionPolicy;
  trade: Record<string, unknown>;
  screenshotRefs: Array<{ id: string; label: string | null; caption: string | null }>;
}

// ── Public-shape allowlist (v3 §4.4 / Lot 14 §18) ────────────────────────────
// The redaction engine is a DENYLIST: it copies every key it does not know.
// A field added to TradeDetailDTO later would therefore flow into public
// snapshots by default. The allowlist below is the second gate: only keys
// listed here ever reach a stored snapshot or a public response. When the
// DTO gains a display field, add its key here (fail-closed until then).
// Keys are the full TradeDetailDTO field set as of 25 Nov 2026.
export const PUBLIC_TRADE_KEYS: ReadonlySet<string> = new Set([
  "id", "accountId", "accountName", "strategyId", "strategyName",
  "instrumentId", "symbol", "digits", "direction", "orderType", "status",
  "timeframe", "session", "setupType", "setupId", "strategyVersion",
  "entryTime", "exitTime", "entryPrice", "exitPrice", "stopLoss",
  "takeProfit", "lots", "riskPercent", "pips", "netPnl", "pnlCurrency",
  "rMultiple", "plannedRR", "resultType", "exitReason", "reviewStatus",
  "isDraft", "emotionBefore", "followedPlan", "grade", "createdAt",
  "updatedAt", "tags", "currentPrice", "marketCondition", "mfePrice",
  "maePrice", "initialStopLoss", "initialTakeProfit", "riskAmount",
  "commission", "swap", "fees", "grossPnl", "pnlSource", "points",
  "realizedRR", "emotionDuring", "emotionAfter", "confidence",
  "setupQualityRating", "executionRating", "lessonLearned",
  "preTradeAnalysis", "postTradeReview", "notes", "tradingViewUrl",
  "checklistResults", "checklistStatus", "accountCurrency",
  "accountInitialBalance", "exitPlanId", "playbookMatch", "review",
  "screenshots", "executions", "hasReview", "modifications",
  // Deliberately NOT listed: customFields (unbounded user content - never
  // public, see redactTrade), userId and other internal identifiers.
]);

const PUBLIC_REVIEW_KEYS: ReadonlySet<string> = new Set([
  "id", "playbookMatch", "followedPlan", "planAdherenceScore",
  "executionQuality", "entryQuality", "exitQuality", "riskManagementScore",
  "emotionalControlScore", "wouldTakeAgain", "mainLesson", "whatWentWell",
  "whatToImprove", "mistakeTagIds", "customAnswers", "reviewedAt",
  "createdAt", "updatedAt",
]);

const PUBLIC_EXECUTION_KEYS: ReadonlySet<string> = new Set([
  "id", "type", "time", "price", "lots", "commission", "pnl",
]);

const PUBLIC_TAG_KEYS: ReadonlySet<string> = new Set([
  "id", "name", "color", "kind", "isPreset",
]);

const CHECKLIST_STATUS_KEYS: ReadonlySet<string> = new Set([
  "requiredTotal", "requiredChecked", "missing", "complete",
]);

function pick(
  source: Record<string, unknown>,
  keys: ReadonlySet<string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (keys.has(key)) out[key] = value;
  }
  return out;
}

/**
 * Projects a (redacted) trade record onto the public-shape allowlist.
 * Unknown keys - including any field added to the DTO later - are dropped.
 * Nested structures are projected too (review, executions, tags,
 * checklistStatus). Pure and idempotent: running it twice changes nothing.
 */
export function projectPublicTrade(
  trade: Record<string, unknown>
): Record<string, unknown> {
  const out = pick(trade, PUBLIC_TRADE_KEYS);
  if (isPlainObject(out.review)) {
    out.review = pick(out.review, PUBLIC_REVIEW_KEYS);
  }
  if (isPlainObject(out.checklistStatus)) {
    out.checklistStatus = pick(out.checklistStatus, CHECKLIST_STATUS_KEYS);
  }
  if (Array.isArray(out.executions)) {
    out.executions = (out.executions as Record<string, unknown>[]).map((ex) =>
      pick(ex, PUBLIC_EXECUTION_KEYS)
    );
  }
  if (Array.isArray(out.tags)) {
    out.tags = (out.tags as Record<string, unknown>[]).map((tag) =>
      pick(tag, PUBLIC_TAG_KEYS)
    );
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Builds the redacted trade snapshot. Returns null when the trade does not
 * exist (or belongs to someone else — getTradeDetail is userId-scoped).
 */
export async function buildTradeSnapshot(
  userId: string,
  tradeId: string,
  policy: RedactionPolicy,
  mode: ShareLinkMode,
  title: string
): Promise<TradeSnapshotStored | null> {
  const detail = await getTradeDetail(userId, tradeId);
  if (!detail) return null;

  const redacted = redactTrade(detail as unknown as Record<string, unknown>, policy);
  // Drop the owner-scoped /api/v1/uploads URLs — public rendering goes through
  // the token-scoped media proxy, injected at resolve time.
  // Project onto the public-shape allowlist: a field added to the DTO later
  // must never reach a snapshot by default (fail-closed).
  const trade = projectPublicTrade({ ...redacted.trade });
  delete trade.screenshots;

  return {
    kind: "TRADE",
    title,
    mode,
    capturedAt: new Date().toISOString(),
    policy,
    trade,
    screenshotRefs: policy.hideScreenshots
      ? []
      : (detail.screenshots ?? []).map((sc) => ({
          id: sc.id,
          // Label is an enum (BEFORE | ENTRY | EXIT | AFTER) - safe to keep.
          label: sc.label,
          // Caption is free text written by the owner - it is a note, so it
          // leaves the snapshot when notes are hidden.
          caption: policy.hideNotes ? null : sc.caption,
        })),
  };
}

/** Stored report snapshot shape (equity already redacted to %/R when needed). */
export interface ReportSnapshotStored {
  kind: "REPORT";
  title: string;
  mode: ShareLinkMode;
  capturedAt: string;
  policy: RedactionPolicy;
  period: { start: string; end: string };
  stats: Record<string, unknown>;
  equity: PublicReportPayload["equity"];
  byStrategy: PublicReportPayload["byStrategy"];
  bySymbol: PublicReportPayload["bySymbol"];
}

/** Stats keys the public report may carry (computeTradeStats output). A
 * stat added later is dropped until listed here - same fail-closed rule
 * as the trade allowlist. */
const PUBLIC_STAT_KEYS: ReadonlySet<string> = new Set([
  "tradeCount", "wins", "losses", "breakevens", "winRate", "netPnl",
  "grossWin", "grossLoss", "profitFactor", "avgWin", "avgLoss", "maxWin",
  "maxLoss", "avgR", "expectancyR", "totalR", "maxDrawdown",
  "maxDrawdownPercent", "maxWinStreak", "maxLossStreak", "currentStreak",
  "tradingDays", "initialBalance",
]);

/** Applies the redaction policy to a raw report payload. */
export function redactReportPayload(
  raw: Omit<PublicReportPayload, "policy">,
  policy: RedactionPolicy
): ReportSnapshotStored {
  const stats = pick(redactStats(raw.stats, policy), PUBLIC_STAT_KEYS);
  delete stats.currency; // account-ish info - reports are currency-neutral

  const curve = redactEquityCurve(
    raw.equity.points.map((p) => ({ time: p.time, value: p.value })),
    policy,
    "PERCENT"
  );

  const redactRows = (
    rows: PublicReportPayload["byStrategy"],
    anonymizeNames: boolean
  ) =>
    rows.map((row, index) => {
      const out = { ...row };
      // Monetary column is structurally absent when amounts are hidden.
      if (policy.hideAmounts) delete out.netPnl;
      if (anonymizeNames) {
        // Strategy names (and raw strategy ids used as row keys) are
        // strategy content: when the policy hides the strategy name, rows
        // are numbered instead of named - never the real name or id.
        out.key = `strategy-${index + 1}`;
        out.name = `Strategy ${index + 1}`;
      }
      return out;
    });

  return {
    kind: "REPORT",
    title: raw.title,
    mode: raw.mode,
    capturedAt: raw.capturedAt,
    policy,
    period: raw.period,
    stats,
    equity: { points: curve.points, unit: curve.unit },
    byStrategy: redactRows(raw.byStrategy, policy.hideStrategyName),
    bySymbol: redactRows(raw.bySymbol, false),
  };
}

// ── resolve-time shaping ─────────────────────────────────────────────────────

/** Parses a stored snapshotJson, tolerating corruption (null → GONE). */
export function parseStoredSnapshot(
  json: string | null
): TradeSnapshotStored | ReportSnapshotStored | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (parsed.kind === "TRADE" || parsed.kind === "REPORT") {
      return parsed as unknown as TradeSnapshotStored | ReportSnapshotStored;
    }
    return null;
  } catch {
    return null;
  }
}

/** Recovers the effective policy from a parsed snapshot. */
export function snapshotPolicy(
  snapshot: TradeSnapshotStored | ReportSnapshotStored
): RedactionPolicy {
  return parseRedactionPolicy(JSON.stringify(snapshot.policy));
}

/**
 * Re-applies the CURRENT snapshot rules to a stored snapshot before serving
 * it. Links created before a rule existed (e.g. caption stripping, strategy
 * anonymization, the field allowlist) are served under the new rules - the
 * stored JSON is never trusted as-is. Idempotent: a snapshot built by the
 * current code passes through unchanged.
 */
export function sanitizeStoredSnapshot(
  snapshot: TradeSnapshotStored | ReportSnapshotStored
): TradeSnapshotStored | ReportSnapshotStored {
  const policy = parseRedactionPolicy(JSON.stringify(snapshot.policy));
  if (snapshot.kind === "TRADE") {
    // Re-run the CURRENT redaction (rules may have changed since capture -
    // e.g. free-text review answers under hideNotes) then project onto the
    // allowlist. Both are idempotent on current snapshots.
    const { trade } = redactTrade(snapshot.trade, policy);
    return {
      ...snapshot,
      trade: projectPublicTrade(trade),
      screenshotRefs: snapshot.screenshotRefs.map((ref) => ({
        ...ref,
        caption: policy.hideNotes ? null : ref.caption,
      })),
    };
  }
  const stats = pick(snapshot.stats, PUBLIC_STAT_KEYS);
  delete stats.currency;
  return {
    ...snapshot,
    stats,
    byStrategy: snapshot.byStrategy.map((row, index) =>
      policy.hideStrategyName
        ? { ...row, key: `strategy-${index + 1}`, name: `Strategy ${index + 1}` }
        : row
    ),
  };
}

/**
 * Converts a stored snapshot into the public payload, injecting the raw
 * token into screenshot URLs (the only place the raw token is used).
 */
export function toPublicPayload(
  snapshot: TradeSnapshotStored | ReportSnapshotStored,
  rawToken: string
): PublicSharePayload {
  if (snapshot.kind === "TRADE") {
    const screenshots: PublicScreenshotRef[] = snapshot.screenshotRefs.map((ref) => ({
      ...ref,
      url: `/api/v1/public/media/${encodeURIComponent(rawToken)}/${encodeURIComponent(ref.id)}`,
    }));
    const payload: PublicTradePayload = {
      kind: "TRADE",
      title: snapshot.title,
      mode: snapshot.mode,
      capturedAt: snapshot.capturedAt,
      policy: snapshot.policy,
      trade: snapshot.trade,
      screenshots,
    };
    return payload;
  }

  const payload: PublicReportPayload = {
    kind: "REPORT",
    title: snapshot.title,
    mode: snapshot.mode,
    capturedAt: snapshot.capturedAt,
    policy: snapshot.policy,
    period: snapshot.period,
    stats: snapshot.stats,
    equity: snapshot.equity,
    byStrategy: snapshot.byStrategy,
    bySymbol: snapshot.bySymbol,
  };
  return payload;
}
