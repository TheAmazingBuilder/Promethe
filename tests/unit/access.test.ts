/**
 * AccessContext unit tests.
 *
 * Owner-only since the Mentors module was removed on 25 Nov 2026: there
 * is no mentor role, no scope filter and no read-only guard anymore.
 * What remains is the owner context itself and the id guard that rejects
 * client-supplied ids that do not belong to the owner.
 */
import { describe, expect, it } from "vitest";
import { AccessDeniedError, assertOwnId, ownerContext } from "@/lib/access";

describe("ownerContext", () => {
  it("grants full access to the owner's own data", () => {
    const ctx = ownerContext("user_A");
    expect(ctx.role).toBe("OWNER");
    expect(ctx.ownerId).toBe("user_A");
    expect(ctx.viewerId).toBe("user_A");
    expect(ctx.readOnly).toBe(false);
  });
});

describe("assertOwnId", () => {
  it("rejects client-supplied ids that do not match the owner", () => {
    const ctx = ownerContext("user_A");
    expect(() => assertOwnId(ctx, "user_B")).toThrow(AccessDeniedError);
    expect(() => assertOwnId(ctx, "user_A")).not.toThrow();
  });
});
