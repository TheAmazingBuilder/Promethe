/**
 * v3 Phase 5 — unit tests for the pure mentor/comment building blocks:
 * mention parsing, scope→redaction-policy mapping, permission JSON
 * round-trips and the Zod schemas (handle charset, expiry normalization).
 */
import { describe, expect, it } from "vitest";
import { parseMentionHandles } from "@/server/comments";
import { mentorPolicyFrom } from "@/server/mentor-views";
import {
  handlePatchSchema,
  mentorInviteSchema,
  mentorPermissionsSchema,
} from "@/lib/validations/mentor";
import type { AccessScope } from "@/lib/access";

describe("parseMentionHandles", () => {
  it("extracts unique lowercase handles", () => {
    expect(parseMentionHandles("hey @Alice_fx and @bob99 plus @Alice_fx again")).toEqual([
      "alice_fx",
      "bob99",
    ]);
  });

  it("ignores too-short or invalid tokens", () => {
    expect(parseMentionHandles("@ab @a! @valid_one")).toEqual(["valid_one"]);
  });

  it("does not match emails or partial words, ignores too-short tokens", () => {
    expect(parseMentionHandles("contact@example.com see @me ok")).toEqual([]);
    expect(parseMentionHandles("user@example.com @alice_fx")).toEqual(["alice_fx"]);
  });

  it("returns empty for empty body", () => {
    expect(parseMentionHandles("")).toEqual([]);
  });
});

describe("mentorPolicyFrom", () => {
  const base: AccessScope = {
    accountIds: "ALL",
    strategyIds: "ALL",
    canViewAmounts: true,
    canViewJournal: true,
    canViewScreenshots: true,
    canViewAnalytics: true,
    canComment: true,
  };

  it("no redaction with full permissions", () => {
    const policy = mentorPolicyFrom(base);
    expect(policy.hideAmounts).toBe(false);
    expect(policy.hideNotes).toBe(false);
    expect(policy.hideScreenshots).toBe(false);
    expect(policy.hidePsychology).toBe(false);
    expect(policy.hideExactTimes).toBe(false); // mentors are not the public web
  });

  it("amounts hidden → account info hidden too (balances ARE amounts)", () => {
    const policy = mentorPolicyFrom({ ...base, canViewAmounts: false });
    expect(policy.hideAmounts).toBe(true);
    expect(policy.hideAccountInfo).toBe(true);
    expect(policy.hideNotes).toBe(false);
  });

  it("journal off → notes + psychology hidden, screenshots independent", () => {
    const policy = mentorPolicyFrom({
      ...base,
      canViewJournal: false,
      canViewScreenshots: true,
    });
    expect(policy.hideNotes).toBe(true);
    expect(policy.hidePsychology).toBe(true);
    expect(policy.hideScreenshots).toBe(false);
  });

  it("screenshots off hides them even with journal on", () => {
    const policy = mentorPolicyFrom({
      ...base,
      canViewJournal: true,
      canViewScreenshots: false,
    });
    expect(policy.hideNotes).toBe(false);
    expect(policy.hideScreenshots).toBe(true);
  });
});

describe("mentorPermissionsSchema", () => {
  it("normalizes expiresAt to null and applies defaults", () => {
    const parsed = mentorPermissionsSchema.parse({
      accountScope: "ALL",
      strategyScope: "ALL",
    });
    expect(parsed.expiresAt).toBeNull();
    expect(parsed.canViewAmounts).toBe(true);
    expect(parsed.canViewJournal).toBe(false);
    expect(parsed.canViewAnalytics).toBe(true);
    expect(parsed.canComment).toBe(false);
    expect(parsed.accountIds).toEqual([]);
  });

  it("keeps a valid expiry", () => {
    const parsed = mentorPermissionsSchema.parse({
      accountScope: "LIST",
      accountIds: ["a", "b"],
      strategyScope: "LIST",
      strategyIds: ["s1"],
      canViewAmounts: false,
      canViewJournal: true,
      canViewScreenshots: true,
      canViewAnalytics: false,
      canComment: true,
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    expect(parsed.expiresAt).toBe("2030-01-01T00:00:00.000Z");
    expect(parsed.accountIds).toEqual(["a", "b"]);
  });

  it("rejects an invalid scope value", () => {
    expect(() =>
      mentorPermissionsSchema.parse({ accountScope: "SOME" })
    ).toThrow();
  });
});

describe("handlePatchSchema", () => {
  it("accepts a valid handle", () => {
    expect(handlePatchSchema.parse({ handle: "Alice_FX" })).toEqual({
      handle: "alice_fx",
    });
  });

  it("rejects invalid charsets and lengths", () => {
    expect(() => handlePatchSchema.parse({ handle: "ab" })).toThrow();
    expect(() => handlePatchSchema.parse({ handle: "a".repeat(25) })).toThrow();
    expect(() => handlePatchSchema.parse({ handle: "héllò" })).toThrow();
    expect(() => handlePatchSchema.parse({ handle: "user name" })).toThrow();
  });
});

describe("mentorInviteSchema", () => {
  it("lowercases the email and requires permissions", () => {
    const parsed = mentorInviteSchema.parse({
      email: "Mentor@Example.COM",
      permissions: { accountScope: "ALL", strategyScope: "ALL" },
    });
    expect(parsed.email).toBe("mentor@example.com");
    expect(parsed.permissions.canViewAmounts).toBe(true);
  });

  it("rejects an invalid email", () => {
    expect(() =>
      mentorInviteSchema.parse({ email: "not-an-email", permissions: {} })
    ).toThrow();
  });
});
