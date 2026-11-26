/**
 * Access context types (client-safe: no server imports here).
 *
 * Since the Mentors module was removed on 25 Nov 2026 (user decision),
 * every viewer is the owner of the data they access. The context stays
 * as a single explicit type so data-access functions keep one signature.
 */

export type AccessRole = "OWNER";

export interface AccessContext {
  /** The user actually looking at the data (always the owner now). */
  viewerId: string;
  /** The user whose data is being accessed (=== viewerId). */
  ownerId: string;
  role: AccessRole;
  /** Owners are never read-only. */
  readOnly: boolean;
}

/** Typed 403 - mapped by apiError() into a consistent envelope. */
export class AccessDeniedError extends Error {
  code = "ACCESS_DENIED";
  status = 403;

  constructor(message = "Access denied.") {
    super(message);
    this.name = "AccessDeniedError";
  }
}
