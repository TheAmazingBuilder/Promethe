/**
 * v3 Phase 1 — AccessContext unit tests (v3 §1).
 *
 * Verifies the owner/mentor context rules: mentors are read-only (mutations
 * rejected), scope filters exclude accounts/strategies outside the grant,
 * and id guards reject ids that do not belong to the owner.
 */
import { describe, expect, it } from "vitest";
import {
  AccessDeniedError,
  accountFilter,
  assertOwnId,
  assertWritable,
  canAccessAccount,
  canAccessStrategy,
  canAccessTrade,
  mentorContext,
  ownerContext,
  ReadOnlyContextError,
} from "@/lib/access";

describe("ownerContext", () => {
  it("grants full scope and write access", () => {
    const ctx = ownerContext("user_A");
    expect(ctx.role).toBe("OWNER");
    expect(ctx.ownerId).toBe("user_A");
    expect(ctx.viewerId).toBe("user_A");
    expect(ctx.readOnly).toBe(false);
    expect(ctx.scope.accountIds).toBe("ALL");
    expect(canAccessAccount(ctx, "any_account")).toBe(true);
    expect(() => assertWritable(ctx)).not.toThrow();
  });
});

describe("mentorContext", () => {
  const scope = {
    accountIds: ["acct_1", "acct_2"],
    strategyIds: "ALL" as const,
    canViewAmounts: false,
    canViewJournal: false,
    canViewScreenshots: false,
    canViewAnalytics: true,
    canComment: true,
  };

  it("is always read-only, even with canComment", () => {
    const ctx = mentorContext("mentor_X", "user_A", scope);
    expect(ctx.role).toBe("MENTOR");
    expect(ctx.viewerId).toBe("mentor_X");
    expect(ctx.ownerId).toBe("user_A");
    expect(ctx.readOnly).toBe(true);
    expect(() => assertWritable(ctx)).toThrow(ReadOnlyContextError);
  });

  it("enforces the account scope", () => {
    const ctx = mentorContext("mentor_X", "user_A", scope);
    expect(canAccessAccount(ctx, "acct_1")).toBe(true);
    expect(canAccessAccount(ctx, "acct_2")).toBe(true);
    expect(canAccessAccount(ctx, "acct_3")).toBe(false);
  });

  it("strategy scope: untagged trades remain visible, tagged checked", () => {
    const ctx = mentorContext("mentor_X", "user_A", {
      ...scope,
      strategyIds: ["strat_gold"],
    });
    expect(canAccessStrategy(ctx, "strat_gold")).toBe(true);
    expect(canAccessStrategy(ctx, "strat_fx")).toBe(false);
    expect(canAccessStrategy(ctx, null)).toBe(true);
  });

  it("accountFilter produces a Prisma IN filter for LIST scopes only", () => {
    const mentor = mentorContext("mentor_X", "user_A", scope);
    expect(accountFilter(mentor)).toEqual({ accountId: { in: ["acct_1", "acct_2"] } });

    const allScopes = mentorContext("mentor_X", "user_A", { ...scope, accountIds: "ALL" });
    expect(accountFilter(allScopes)).toEqual({});

    const owner = ownerContext("user_A");
    expect(accountFilter(owner)).toEqual({});
  });

  it("copies scope lists defensively", () => {
    const shared = ["acct_1"];
    const ctx = mentorContext("mentor_X", "user_A", { ...scope, accountIds: shared });
    shared.push("acct_999");
    expect(canAccessAccount(ctx, "acct_999")).toBe(false);
  });

  it("rejects self-mentorship", () => {
    expect(() => mentorContext("user_A", "user_A", scope)).toThrow(AccessDeniedError);
  });
});

describe("canAccessTrade", () => {
  it("requires both account and strategy scope", () => {
    const ctx = mentorContext("mentor_X", "user_A", {
      accountIds: ["acct_1"],
      strategyIds: ["strat_gold"],
      canViewAmounts: true,
      canViewJournal: true,
      canViewScreenshots: true,
      canViewAnalytics: true,
      canComment: false,
    });
    expect(canAccessTrade(ctx, "acct_1", "strat_gold")).toBe(true);
    expect(canAccessTrade(ctx, "acct_1", "strat_fx")).toBe(false);
    expect(canAccessTrade(ctx, "acct_2", "strat_gold")).toBe(false);
  });
});

describe("assertOwnId", () => {
  it("rejects client-supplied ids that do not match the owner", () => {
    const ctx = ownerContext("user_A");
    expect(() => assertOwnId(ctx, "user_B")).toThrow(AccessDeniedError);
    expect(() => assertOwnId(ctx, "user_A")).not.toThrow();
  });
});
