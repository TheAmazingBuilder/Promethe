/**
 * Access context helpers (pure, server + test friendly).
 *
 * Owner-only since the Mentors module was removed on 25 Nov 2026: the
 * mentor role, its scoped contexts and the read-only guard are gone.
 * Every data-access function still takes an AccessContext so the call
 * sites keep one shape.
 */
import { AccessContext, AccessDeniedError } from "./types";

export * from "./types";

/** Full-access owner context - requireUser() wraps this (session-based). */
export function ownerContext(userId: string): AccessContext {
  return {
    viewerId: userId,
    ownerId: userId,
    role: "OWNER",
    readOnly: false,
  };
}

/**
 * Guards an id coming from the CLIENT against the context (never accept
 * an ownerId/accountId/tradeId from the client without verification).
 * Throws AccessDeniedError when the id does not belong to the owner.
 */
export function assertOwnId(ctx: AccessContext, candidateOwnerId: string): void {
  if (candidateOwnerId !== ctx.ownerId) {
    throw new AccessDeniedError();
  }
}
