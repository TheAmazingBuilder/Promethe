/**
 * v3 — Pure share-link status helpers (tested in isolation).
 *
 * GONE unification: invalid, expired, revoked and view-limited links are
 * indistinguishable from the OUTSIDE (same generic page / 404) so probing
 * tokens gains nothing. The owner's management view shows the true status.
 */
import type {
  RedactionPolicy,
} from "@/lib/redaction";
import type { ShareLinkStatus } from "./types";

/** Stored-row shape (subset of the Prisma model - keeps the helper pure). */
export interface ShareLinkRowLike {
  revokedAt: Date | null;
  expiresAt: Date;
  maxViews: number | null;
  viewCount: number;
}

export function shareLinkStatus(row: ShareLinkRowLike, now = new Date()): ShareLinkStatus {
  if (row.revokedAt !== null) return "REVOKED";
  if (row.expiresAt.getTime() <= now.getTime()) return "EXPIRED";
  if (row.maxViews !== null && row.viewCount >= row.maxViews) return "VIEW_LIMIT";
  return "ACTIVE";
}

/** True when the link can still be opened by a visitor. */
export function isShareLinkUsable(row: ShareLinkRowLike, now = new Date()): boolean {
  return shareLinkStatus(row, now) === "ACTIVE";
}

// ── policy summary (management list) ─────────────────────────────────────────

const SUMMARY_KEYS: Array<[keyof RedactionPolicy, string]> = [
  ["hideAmounts", "amounts"],
  ["hideAccountInfo", "account"],
  ["hideNotes", "notes"],
  ["hideScreenshots", "screenshots"],
  ["hideStrategyName", "strategy"],
  ["hideExactTimes", "times"],
  ["hidePsychology", "psychology"],
];

/** Comma list of what the policy hides - "nothing hidden" when empty. */
export function policySummary(policy: RedactionPolicy): string {
  const hidden = SUMMARY_KEYS.filter(([key]) => policy[key]).map(
    ([, label]) => label
  );
  if (hidden.length === 0) {
    return "nothing hidden";
  }
  return "hidden: " + hidden.join(", ");
}

/** Max expiry is 10 years - privacy by default: links always expire. */
export const MAX_EXPIRY_DAYS = 3650;

export const EXPIRY_OPTIONS = [7, 30, 90, 365, 3650] as const;

export function expiryLabel(days: number): string {
  if (days === 7) return "7 days";
  if (days === 30) return "30 days";
  if (days === 90) return "90 days";
  if (days === 365) return "1 year";
  if (days === 3650) return "10 years (max)";
  return `${days} days`;
}
