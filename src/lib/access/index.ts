/**
 * v3 — Access context helpers (pure, server + test friendly).
 *
 * Usage pattern for every v3 data-access function:
 *
 *   const ctx = await requireOwnerContext();          // OWNER (requireUser)
 *   const ctx = await requireMentorAccess(ownerId);   // MENTOR (read-only)
 *
 *   assertWritable(ctx);                              // mutations
 *   if (!canAccessAccount(ctx, accountId)) throw new AccessDeniedError();
 *   db.trade.findMany({ where: { userId: ctx.ownerId, ...accountFilter(ctx) } })
 */
import {
  AccessContext,
  AccessDeniedError,
  AccessScope,
  OWNER_SCOPE,
  ReadOnlyContextError,
} from "./types";

export * from "./types";

/** Full-access owner context - requireUser() wraps this (session-based). */
export function ownerContext(userId: string): AccessContext {
  return {
    viewerId: userId,
    ownerId: userId,
    role: "OWNER",
    scope: { ...OWNER_SCOPE },
    readOnly: false,
  };
}

/** Builds the constrained read-only mentor context from an access scope. */
export function mentorContext(
  mentorId: string,
  ownerId: string,
  scope: AccessScope
): AccessContext {
  if (mentorId === ownerId) {
    throw new AccessDeniedError("Self-mentorship is not possible: use the owner account.");
  }
  return {
    viewerId: mentorId,
    ownerId,
    role: "MENTOR",
    // Defensive copy — scope lists are never shared mutable references.
    scope: {
      ...scope,
      accountIds: Array.isArray(scope.accountIds) ? [...scope.accountIds] : scope.accountIds,
      strategyIds: Array.isArray(scope.strategyIds) ? [...scope.strategyIds] : scope.strategyIds,
    },
    readOnly: true,
  };
}

/** Throws unless the context allows mutations (mentors are read-only). */
export function assertWritable(ctx: AccessContext): void {
  if (ctx.readOnly || ctx.role !== "OWNER" || ctx.viewerId !== ctx.ownerId) {
    throw new ReadOnlyContextError();
  }
}

/** Account-level scope check. Owners always pass. */
export function canAccessAccount(ctx: AccessContext, accountId: string): boolean {
  if (ctx.role === "OWNER") return true;
  const { accountIds } = ctx.scope;
  return accountIds === "ALL" || accountIds.includes(accountId);
}

/** Strategy-level scope check. Owners always pass. */
export function canAccessStrategy(ctx: AccessContext, strategyId: string | null | undefined): boolean {
  if (ctx.role === "OWNER") return true;
  if (!strategyId) return true; // untagged trades are visible to any scoped mentor
  const { strategyIds } = ctx.scope;
  return strategyIds === "ALL" || strategyIds.includes(strategyId);
}

/**
 * Prisma account filter for scoped queries — spread into `where`:
 *   where: { userId: ctx.ownerId, ...accountFilter(ctx) }
 * Owners and ALL-scope mentors get no extra constraint (undefined spreads to
 * nothing in Prisma).
 */
export function accountFilter(ctx: AccessContext): { accountId?: { in: string[] } } {
  if (ctx.role === "OWNER" || ctx.scope.accountIds === "ALL") return {};
  return { accountId: { in: ctx.scope.accountIds } };
}

/** Whether a trade from a given account+strategy falls inside the scope. */
export function canAccessTrade(
  ctx: AccessContext,
  accountId: string,
  strategyId: string | null | undefined
): boolean {
  return canAccessAccount(ctx, accountId) && canAccessStrategy(ctx, strategyId);
}

/**
 * Guards an id coming from the CLIENT against the context (v3 §1: never
 * accept an ownerId/accountId/tradeId from the client without verification).
 * Throws AccessDeniedError when the id does not belong to the owner.
 */
export function assertOwnId(ctx: AccessContext, candidateOwnerId: string): void {
  if (candidateOwnerId !== ctx.ownerId) {
    throw new AccessDeniedError();
  }
}
