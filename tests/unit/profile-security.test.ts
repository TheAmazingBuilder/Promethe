import { describe, expect, it } from "vitest";
import { changePasswordSchema } from "@/server/change-password";
import { sessionFingerprint } from "@/server/auth-sessions";

/**
 * Profile security — change-password validation and session fingerprints.
 * Pure checks only: no database is touched here.
 */
describe("changePasswordSchema", () => {
  it("accepts a valid change", () => {
    const parsed = changePasswordSchema.safeParse({
      currentPassword: "OldPass123",
      newPassword: "NewPass456",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a new password that is too short or has no digit", () => {
    expect(
      changePasswordSchema.safeParse({
        currentPassword: "OldPass123",
        newPassword: "short1",
      }).success
    ).toBe(false);
    expect(
      changePasswordSchema.safeParse({
        currentPassword: "OldPass123",
        newPassword: "NoDigitsHere",
      }).success
    ).toBe(false);
  });

  it("rejects a new password identical to the current one", () => {
    expect(
      changePasswordSchema.safeParse({
        currentPassword: "SamePass123",
        newPassword: "SamePass123",
      }).success
    ).toBe(false);
  });

  it("rejects an empty current password", () => {
    expect(
      changePasswordSchema.safeParse({
        currentPassword: "",
        newPassword: "NewPass456",
      }).success
    ).toBe(false);
  });
});

describe("sessionFingerprint", () => {
  it("is deterministic and never leaks the raw token", () => {
    const token = "a".repeat(64);
    const fp = sessionFingerprint(token);
    expect(fp).toBe(sessionFingerprint(token));
    expect(fp).not.toContain(token);
    expect(fp).toHaveLength(16);
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });

  it("differs between tokens", () => {
    expect(sessionFingerprint("a".repeat(64))).not.toBe(
      sessionFingerprint("b".repeat(64))
    );
  });
});
