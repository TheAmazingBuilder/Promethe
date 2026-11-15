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

/** Raw trade snapshot (before URL injection) — what lands in snapshotJson. */
export interface TradeSnapshotStored {
  kind: "TRADE";
  title: string;
  mode: ShareLinkMode;
  capturedAt: string;
  policy: RedactionPolicy;
  trade: Record<string, unknown>;
  screenshotRefs: Array<{ id: string; label: string | null; caption: string | null }>;
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
  // Drop the owner-scoped /api/uploads URLs — public rendering goes through
  // the token-scoped media proxy, injected at resolve time.
  const trade = { ...redacted.trade };
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
          label: sc.label,
          caption: sc.caption,
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

/** Applies the redaction policy to a raw report payload. */
export function redactReportPayload(
  raw: Omit<PublicReportPayload, "policy">,
  policy: RedactionPolicy
): ReportSnapshotStored {
  const stats = redactStats(raw.stats, policy);
  delete stats.currency; // account-ish info — reports are currency-neutral

  const curve = redactEquityCurve(
    raw.equity.points.map((p) => ({ time: p.time, value: p.value })),
    policy,
    "PERCENT"
  );

  const redactRows = (rows: PublicReportPayload["byStrategy"]) =>
    rows.map((row) => {
      if (!policy.hideAmounts) return { ...row };
      // Monetary column is structurally absent when amounts are hidden.
      const { netPnl: _netPnl, ...rest } = row;
      return rest;
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
    byStrategy: redactRows(raw.byStrategy),
    bySymbol: redactRows(raw.bySymbol),
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
      url: `/api/public/media/${encodeURIComponent(rawToken)}/${encodeURIComponent(ref.id)}`,
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
