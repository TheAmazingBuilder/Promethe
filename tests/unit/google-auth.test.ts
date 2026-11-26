import { afterEach, describe, expect, it, vi } from "vitest";
import {
  googleCodeChallenge,
  googleRedirectUri,
  verifiedGoogleEmail,
} from "@/lib/auth/google";

afterEach(() => {
  vi.unstubAllEnvs();
});

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

describe("googleRedirectUri", () => {
  it("uses the localhost callback only outside production when unset", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("GOOGLE_REDIRECT_URI", "");
    expect(googleRedirectUri()).toBe(
      "http://localhost:3000/api/auth/google/callback"
    );
  });

  it("fails closed in production when no callback URI is configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GOOGLE_REDIRECT_URI", "");
    expect(googleRedirectUri()).toBeNull();
  });

  it("accepts a configured HTTPS callback with the exact route", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "GOOGLE_REDIRECT_URI",
      "https://promethe.example/api/auth/google/callback"
    );
    expect(googleRedirectUri()).toBe(
      "https://promethe.example/api/auth/google/callback"
    );
  });

  it("rejects insecure production URLs and unexpected callback paths", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "GOOGLE_REDIRECT_URI",
      "http://promethe.example/api/auth/google/callback"
    );
    expect(googleRedirectUri()).toBeNull();

    vi.stubEnv(
      "GOOGLE_REDIRECT_URI",
      "https://promethe.example/untrusted/callback"
    );
    expect(googleRedirectUri()).toBeNull();
  });

  it("rejects callback URLs containing query strings or fragments", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "GOOGLE_REDIRECT_URI",
      "https://promethe.example/api/auth/google/callback?next=/"
    );
    expect(googleRedirectUri()).toBeNull();

    vi.stubEnv(
      "GOOGLE_REDIRECT_URI",
      "https://promethe.example/api/auth/google/callback#fragment"
    );
    expect(googleRedirectUri()).toBeNull();
  });
});

describe("googleCodeChallenge", () => {
  it("uses the RFC 7636 S256 challenge derivation", () => {
    const verifier =
      "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(googleCodeChallenge(verifier)).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
  });
});
