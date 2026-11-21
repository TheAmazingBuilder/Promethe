import { describe, expect, it } from "vitest";
import { verifiedGoogleEmail } from "@/lib/auth/google";

describe("verifiedGoogleEmail", () => {
  it("normalizes an explicitly verified email", () => {
    expect(
      verifiedGoogleEmail({
        email: " Trader@Example.Test ",
        email_verified: true,
      })
    ).toBe("trader@example.test");
  });

  it("rejects missing or false verification claims", () => {
    expect(
      verifiedGoogleEmail({ email: "trader@example.test", email_verified: false })
    ).toBeNull();
    expect(verifiedGoogleEmail({ email: "trader@example.test" })).toBeNull();
  });

  it("rejects missing or empty email values", () => {
    expect(verifiedGoogleEmail({ email_verified: true })).toBeNull();
    expect(verifiedGoogleEmail({ email: "  ", email_verified: true })).toBeNull();
  });
});
