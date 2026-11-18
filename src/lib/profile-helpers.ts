/**
 * Profile page — pure helpers (no DB, no Next.js imports, unit-testable).
 *
 * The profile header shows only what Promethe really stores: a display
 * name, an email and a sign-up date. There is no avatar upload, no phone,
 * no bio, no company and no location field anywhere in the app, so the
 * helpers below cover exactly the real fields.
 */

/** Initials for the avatar circle, e.g. "Rody Bints" -> "RB". */
export function initialsFromName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).toUpperCase() || "?";
}

/**
 * "Member since" label, e.g. "March 2023" (en-CA, the app locale).
 * Returns an empty string for an invalid date so the UI can hide the row
 * instead of showing a broken value.
 */
export function formatMemberSince(isoDate: string | null | undefined): string {
  if (!isoDate) return "";
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** Short date for a session row, e.g. "Nov 17, 2026". */
export function formatShortDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "";
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** Days left until a scheduled account deletion (0 when past). */
export function daysUntilDeletion(scheduledForIso: string | null | undefined): number {
  if (!scheduledForIso) return 0;
  const target = new Date(scheduledForIso).getTime();
  if (Number.isNaN(target)) return 0;
  return Math.max(0, Math.ceil((target - Date.now()) / 86_400_000));
}
