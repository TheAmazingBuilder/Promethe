/**
 * v3 — Share link service (server).
 *
 * Lifecycle: create (token shown ONCE) → public resolve (view-counted,
 * rate-limited at the route level) → revoke (immediate, clears the stored
 * snapshot). Tokens are 256-bit URL-safe, stored as HMAC-SHA256 hashes —
 * a DB leak cannot forge or brute-force them, and the raw token is never
 * persisted (screenshot URLs are injected at read time from the visitor's
 * own URL).
 */
import { db } from "@/lib/db";
import {
  assertNoHiddenKeys,
  assertNoLeaks,
  parseRedactionPolicy,
  tradeLeakProbes,
  type RedactionPolicy,
} from "@/lib/redaction";
import {
  generateToken,
  hashToken,
  tokenPrefixOf,
} from "@/lib/tokens";
import { getTradeDetail } from "@/server/trades";
import {
  buildReportPayload,
  parseReportPeriod,
  type ReportPeriod,
} from "@/lib/sharing/report";
import {
  buildTradeSnapshot,
  parseStoredSnapshot,
  redactReportPayload,
  sanitizeStoredSnapshot,
  snapshotPolicy,
  toPublicPayload,
  type ReportSnapshotStored,
  type TradeSnapshotStored,
} from "@/lib/sharing/snapshot";
import {
  isShareLinkUsable,
  shareLinkStatus,
} from "@/lib/sharing/status";
import type {
  CreatedShareLink,
  PublicSharePayload,
  ResolveResult,
  ShareLinkDTO,
  ShareLinkMode,
  ShareLinkType,
} from "@/lib/sharing/types";
import type { ShareLinkInput } from "@/lib/validations/sharing";
import type { ShareLink } from "@prisma/client";

export class ShareValidationError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 422) {
    super(code);
    this.name = "ShareValidationError";
    this.code = code;
    this.status = status;
  }
}

// ── mappers ──────────────────────────────────────────────────────────────────

function toDTO(row: ShareLink): ShareLinkDTO {
  return {
    id: row.id,
    type: row.type as ShareLinkType,
    targetId: row.targetId,
    title: row.title,
    mode: row.mode as ShareLinkMode,
    status: shareLinkStatus(row),
    tokenPrefix: row.tokenPrefix,
    policy: parseRedactionPolicy(row.redactionJson),
    expiresAt: row.expiresAt.toISOString(),
    maxViews: row.maxViews,
    viewCount: row.viewCount,
    lastViewedAt: row.lastViewedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── create ───────────────────────────────────────────────────────────────────

/** Stored LIVE spec - where the read-time rebuild finds its parameters. */
interface LiveSpec {
  live: true;
  period?: ReportPeriod;
}

export async function createShareLink(
  userId: string,
  input: ShareLinkInput
): Promise<CreatedShareLink> {
  const policy: RedactionPolicy = {
    hideAmounts: input.policy.hideAmounts,
    hideAccountInfo: input.policy.hideAccountInfo,
    hideNotes: input.policy.hideNotes,
    hideScreenshots: input.policy.hideScreenshots,
    hideStrategyName: input.policy.hideStrategyName,
    hideExactTimes: input.policy.hideExactTimes,
    hidePsychology: input.policy.hidePsychology,
  };

  let snapshotJson: string | null = null;
  let targetId = "";

  if (input.type === "TRADE") {
    // Ownership is enforced inside getTradeDetail (userId-scoped).
    const detail = await getTradeDetail(userId, input.tradeId);
    if (!detail) throw new ShareValidationError("SHARE_TRADE_NOT_FOUND", 404);

    targetId = detail.id;
    const snapshot = await buildTradeSnapshot(
      userId,
      detail.id,
      policy,
      input.mode,
      input.title
    );
    if (!snapshot) throw new ShareValidationError("SHARE_TRADE_NOT_FOUND", 404);

    // Defense in depth:
    //  1. key-exact scan — no hidden KEY may survive (no false positives);
    //  2. distinctive STRING probes only (account/broker/notes…) — numeric
    //     value scanning is a TEST-time tool (a visible R of 0.5 legitimately
    //     equals hidden lots of 0.5).
    assertNoHiddenKeys(snapshot.trade, policy);
    assertNoLeaks(snapshot.trade, stringProbesOnly(detail as unknown as Record<string, unknown>, policy));

    if (input.mode === "SNAPSHOT") {
      snapshotJson = JSON.stringify(snapshot);
    }
  } else {
    const period = parseReportPeriod(input.reportPeriod);
    if (!period) throw new ShareValidationError("INVALID_PERIOD");

    if (period.accountId) {
      const account = await db.account.findFirst({
        where: { id: period.accountId, userId },
        select: { id: true },
      });
      if (!account) throw new ShareValidationError("ACCOUNT_NOT_FOUND", 404);
    }

    targetId = `report:${period.start}:${period.end}:${period.accountId ?? "all"}`;
    const raw = await buildReportPayload(userId, period, input.title, input.mode);
    const redacted = redactReportPayload(raw, policy);

    if (input.mode === "SNAPSHOT") {
      snapshotJson = JSON.stringify(redacted);
    } else {
      const spec: LiveSpec = { live: true, period };
      snapshotJson = JSON.stringify(spec);
    }
  }

  const token = generateToken(32);
  const row = await db.shareLink.create({
    data: {
      userId,
      type: input.type,
      targetId,
      tokenHash: hashToken(token),
      tokenPrefix: tokenPrefixOf(token),
      title: input.title,
      mode: input.mode,
      snapshotJson,
      redactionJson: JSON.stringify(policy),
      expiresAt: new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000),
      maxViews: input.maxViews ?? null,
    },
  });

  return { link: toDTO(row), urlPath: `/s/${token}` };
}

// ── list / revoke ────────────────────────────────────────────────────────────

export async function listShareLinks(userId: string): Promise<ShareLinkDTO[]> {
  const rows = await db.shareLink.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toDTO);
}

export async function revokeShareLink(userId: string, id: string): Promise<boolean> {
  const row = await db.shareLink.findFirst({ where: { id, userId } });
  if (!row) return false;
  // Immediate effect: status flips AND the stored snapshot is wiped.
  await db.shareLink.update({
    where: { id: row.id },
    data: { revokedAt: new Date(), snapshotJson: null },
  });
  return true;
}

// ── public resolution ────────────────────────────────────────────────────────

/** Cheap shape check before any DB hit: 32 bytes → 43 base64url chars. */
function looksLikeToken(raw: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(raw);
}

/** Distinctive STRING probes only (see the leak-guard rationale above). */
function stringProbesOnly(
  trade: Record<string, unknown>,
  policy: RedactionPolicy
): string[] {
  return tradeLeakProbes(trade, policy).filter(
    (probe): probe is string => typeof probe === "string"
  );
}

export interface ResolveOptions {
  /** Count a view (public page) - false for OG images and media proxy. */
  countView: boolean;
}

export async function resolveShareLink(
  rawToken: string,
  options: ResolveOptions
): Promise<ResolveResult> {
  if (!looksLikeToken(rawToken)) return { ok: false, reason: "GONE" };

  const row = await db.shareLink.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!row || !isShareLinkUsable(row)) return { ok: false, reason: "GONE" };

  if (options.countView) {
    // Race-safe increment: only succeeds while under the cap.
    const bumped = await db.shareLink.updateMany({
      where: {
        id: row.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        ...(row.maxViews !== null
          ? { viewCount: { lt: row.maxViews } }
          : {}),
      },
      data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
    });
    if (bumped.count === 0) return { ok: false, reason: "GONE" };
  }

  const policy = parseRedactionPolicy(row.redactionJson);

  // ── SNAPSHOT: serve the frozen payload ──
  if (row.mode === "SNAPSHOT") {
    const stored = parseStoredSnapshot(row.snapshotJson);
    if (!stored) return { ok: false, reason: "GONE" };
    // Stored before the current rules? Re-apply them (captions, strategy
    // names, field allowlist) - the stored JSON is never served as-is.
    const snapshot = sanitizeStoredSnapshot(stored);
    return { ok: true, payload: toPublicPayload(snapshot, rawToken) };
  }

  // ── LIVE: rebuild from current data, re-redacted ──
  if (row.type === "TRADE") {
    const detail = await getTradeDetail(row.userId, row.targetId);
    if (!detail) return { ok: false, reason: "GONE" }; // trade deleted → link dies
    const snapshot = await buildTradeSnapshot(
      row.userId,
      row.targetId,
      policy,
      "LIVE",
      row.title
    );
    if (!snapshot) return { ok: false, reason: "GONE" };
    assertNoHiddenKeys(snapshot.trade, policy);
    assertNoLeaks(snapshot.trade, stringProbesOnly(detail as unknown as Record<string, unknown>, policy));
    return { ok: true, payload: toPublicPayload(snapshot, rawToken) };
  }

  // LIVE REPORT — period comes from the stored live spec.
  let spec: LiveSpec | null = null;
  try {
    spec = JSON.parse(row.snapshotJson ?? "null") as LiveSpec | null;
  } catch {
    spec = null;
  }
  const period = spec?.period ?? parseReportPeriod({ start: row.targetId.split(":")[1], end: row.targetId.split(":")[2] });
  if (!period) return { ok: false, reason: "GONE" };

  const raw = await buildReportPayload(row.userId, period, row.title, "LIVE");
  const redacted = redactReportPayload(raw, policy);
  return { ok: true, payload: toPublicPayload(redacted, rawToken) };
}

// ── public media proxy ───────────────────────────────────────────────────────

/**
 * Streams one screenshot through a VALID share token (TRADE type, screenshots
 * allowed by the policy, screenshot attached to the shared trade). This is
 * what makes "shared screenshots die with the link": every image request
 * re-checks the link status, so revocation is immediate for <img> loads too.
 */
export async function readPublicScreenshot(
  rawToken: string,
  screenshotId: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!looksLikeToken(rawToken)) return null;

  const row = await db.shareLink.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!row || !isShareLinkUsable(row)) return null;
  if (row.type !== "TRADE") return null;

  const policy = parseRedactionPolicy(row.redactionJson);
  if (policy.hideScreenshots) return null;

  // Snapshot links may have been created with screenshots allowed, then the
  // policy is unchanged — but LIVE links re-check against the CURRENT refs.
  const shot = await db.tradeScreenshot.findFirst({
    where: { id: screenshotId, userId: row.userId, tradeId: row.targetId },
  });
  if (!shot) return null;

  // SNAPSHOT mode: only screenshots that existed at capture time are public.
  if (row.mode === "SNAPSHOT") {
    const snapshot = parseStoredSnapshot(row.snapshotJson);
    if (!snapshot || snapshot.kind !== "TRADE") return null;
    if (!snapshot.screenshotRefs.some((ref) => ref.id === screenshotId)) return null;
  }

  const { readUpload } = await import("@/server/uploads");
  return readUpload(row.userId, screenshotId);
}

/** Snapshot access for the OG image route (no view counting). */
export async function peekShareForOg(
  rawToken: string
): Promise<PublicSharePayload | null> {
  const result = await resolveShareLink(rawToken, { countView: false });
  return result.ok ? result.payload : null;
}

