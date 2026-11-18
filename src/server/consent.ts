/**
 * v3 Phase 6 — Consent records (RGPD art. 7): versioned proof of what the
 * user agreed to and when. TERMS/PRIVACY are recorded at signup inside the
 * user-creation transaction (atomic: a user without consent proof cannot
 * exist), COOKIES_PREFERENCES would record granular choices when marketing
 * cookies are ever added (the app currently uses strictly necessary cookies
 * only — see the /legal/cookies page).
 *
 * Versions are DATED constants: bumping them lets a future "re-consent"
 * banner compare Profile signup date vs current version.
 */
import { db } from "@/lib/db";

export const TERMS_VERSION = "2025-11-01";
export const PRIVACY_VERSION = "2025-11-01";

export type ConsentType =
  | "TERMS"
  | "PRIVACY"
  | "COOKIES_PREFERENCES"
  | "MARKETING_EMAIL";

export interface ConsentDTO {
  id: string;
  type: string;
  version: string;
  granted: boolean;
  choices: unknown;
  createdAt: string;
}

/** Records a consent (or refusal - granted=false is also proof). */
export async function recordConsent(
  userId: string,
  type: ConsentType,
  granted: boolean,
  choices?: Record<string, boolean>
): Promise<void> {
  await db.consentRecord.create({
    data: {
      userId,
      type,
      version: type === "TERMS" ? TERMS_VERSION : PRIVACY_VERSION,
      granted,
      choicesJson: choices ? JSON.stringify(choices) : null,
    },
  });
}

/** Full consent history, most recent first (settings view). */
export async function listConsents(userId: string): Promise<ConsentDTO[]> {
  const rows = await db.consentRecord.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    version: row.version,
    granted: row.granted,
    choices: row.choicesJson ? safeParse(row.choicesJson) : null,
    createdAt: row.createdAt.toISOString(),
  }));
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
