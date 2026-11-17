/**
 * Client-safe session types shared by API routes and React components.
 * (No server imports here — this module is bundled for the client.)
 */

export interface SessionUser {
  id: string;
  email: string;
}

/** Quick-entry smart defaults (v2 §4.1) - persisted in Profile.preferencesJson. */
export interface ProfilePreferences {
  /** Last used account (pre-selected in the quick form). */
  lastAccountId?: string | null;
  /** Last used instrument. */
  lastInstrumentId?: string | null;
  /** Last used timeframe. */
  lastTimeframe?: string | null;
  /** Remembered lot size per instrument symbol. */
  rememberedLots?: Record<string, string> | null;
  /** Favorite instruments (shown first in the quick picker). */
  favoriteInstrumentIds?: string[] | null;
}

export const EMPTY_PREFERENCES: ProfilePreferences = {};

export interface SessionProfile {
  displayName: string;
  timezone: string;
  baseCurrency: string;
  locale: string;
  theme: string;
  defaultAccountId: string | null;
  preferences: ProfilePreferences;
  /** v3 - mentoring handle (null until the user picks one). */
  handle: string | null;
  /** v3 - name shown to mentors (falls back to displayName). */
  publicDisplayName: string | null;
}

export interface SessionPayload {
  user: SessionUser;
  profile: SessionProfile;
}

/** Typed API error envelope - Prisma/internal errors are never exposed. */
export interface ApiErrorBody {
  error: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
}
