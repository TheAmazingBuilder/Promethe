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

const SUMMARY_KEYS: Array<[keyof RedactionPolicy, "fr" | "en", string]> = [
  ["hideAmounts", "fr", "montants"],
  ["hideAmounts", "en", "amounts"],
  ["hideAccountInfo", "fr", "compte"],
  ["hideAccountInfo", "en", "account"],
  ["hideNotes", "fr", "notes"],
  ["hideNotes", "en", "notes"],
  ["hideScreenshots", "fr", "captures"],
  ["hideScreenshots", "en", "screenshots"],
  ["hideStrategyName", "fr", "stratégie"],
  ["hideStrategyName", "en", "strategy"],
  ["hideExactTimes", "fr", "heures"],
  ["hideExactTimes", "en", "times"],
  ["hidePsychology", "fr", "psychologie"],
  ["hidePsychology", "en", "psychology"],
];

/** Comma list of what the policy hides - "rien" / "nothing" when empty. */
export function policySummary(policy: RedactionPolicy, locale: "fr" | "en"): string {
  const hidden = SUMMARY_KEYS.filter(([key, l]) => l === locale && policy[key]).map(
    ([, , label]) => label
  );
  if (hidden.length === 0) {
    return locale === "fr" ? "rien de masqué" : "nothing hidden";
  }
  return (locale === "fr" ? "masqué : " : "hidden: ") + hidden.join(", ");
}

/** Max expiry is 10 years - privacy by default: links always expire. */
export const MAX_EXPIRY_DAYS = 3650;

export const EXPIRY_OPTIONS = [7, 30, 90, 365, 3650] as const;

export function expiryLabel(days: number, locale: "fr" | "en"): string {
  if (days === 7) return locale === "fr" ? "7 jours" : "7 days";
  if (days === 30) return locale === "fr" ? "30 jours" : "30 days";
  if (days === 90) return locale === "fr" ? "90 jours" : "90 days";
  if (days === 365) return locale === "fr" ? "1 an" : "1 year";
  if (days === 3650) return locale === "fr" ? "10 ans (max)" : "10 years (max)";
  return locale === "fr" ? `${days} jours` : `${days} days`;
}
