/**
 * v3 — Access context types (client-safe: no server imports here).
 *
 * Every data-access function takes an AccessContext and applies scope
 * filters; every mutation rejects read-only contexts (v3 §1). The SAME
 * functions and UI components serve the owner and mentors with different
 * contexts — mentors get a constrained, read-only view of the scope only.
 */

export type AccessRole = "OWNER" | "MENTOR";

export interface AccessScope {
  /** "ALL" or the explicit list of account ids the viewer may see. */
  accountIds: "ALL" | string[];
  /** "ALL" or the explicit list of strategy ids the viewer may see. */
  strategyIds: "ALL" | string[];
  /** When false, all currency amounts are redacted to pips & R only. */
  canViewAmounts: boolean;
  canViewJournal: boolean;
  canViewScreenshots: boolean;
  canViewAnalytics: boolean;
  canComment: boolean;
}

export interface AccessContext {
  /** The user actually looking at the data. */
  viewerId: string;
  /** The user whose data is being accessed (=== viewerId for owners). */
  ownerId: string;
  role: AccessRole;
  scope: AccessScope;
  /** Mentors are ALWAYS read-only - enforced server-side, not just hidden UI. */
  readOnly: boolean;
}

export const OWNER_SCOPE: AccessScope = {
  accountIds: "ALL",
  strategyIds: "ALL",
  canViewAmounts: true,
  canViewJournal: true,
  canViewScreenshots: true,
  canViewAnalytics: true,
  canComment: true,
};

/** Typed 403 - mapped by apiError() into a consistent envelope. */
export class AccessDeniedError extends Error {
  code = "ACCESS_DENIED";
  status = 403;

  constructor(message = "Access denied.") {
    super(message);
    this.name = "AccessDeniedError";
  }
}

export class ReadOnlyContextError extends AccessDeniedError {
  code = "READ_ONLY";

  constructor(message = "Read-only: mentors cannot modify data.") {
    super(message);
    this.name = "ReadOnlyContextError";
  }
}
