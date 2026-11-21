import { describe, expect, it } from "vitest";
import { AUTH_RATE_LIMITS } from "@/server/auth-rate-limit-policy";

describe("public authentication rate-limit policy", () => {
  it("limits password login attempts per email and per IP", () => {
    expect(AUTH_RATE_LIMITS.login.email).toEqual({ limit: 5, windowMs: 15 * 60 * 1000 });
    expect(AUTH_RATE_LIMITS.login.ip).toEqual({ limit: 20, windowMs: 15 * 60 * 1000 });
  });
  it("applies a tighter signup quota over a longer email window", () => {
    expect(AUTH_RATE_LIMITS.signup.email).toEqual({ limit: 3, windowMs: 60 * 60 * 1000 });
    expect(AUTH_RATE_LIMITS.signup.ip).toEqual({ limit: 10, windowMs: 15 * 60 * 1000 });
  });
  it("defines a bounded Google OAuth initiation quota", () => {
    expect(AUTH_RATE_LIMITS.google.ip).toEqual({ limit: 30, windowMs: 15 * 60 * 1000 });
  });
});
