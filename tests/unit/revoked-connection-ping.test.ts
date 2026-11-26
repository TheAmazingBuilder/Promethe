import { describe, expect, it } from "vitest";
import { isRevokedConnection } from "@/lib/sync/status";

describe("revoked broker connection", () => {
  it("rejects a sticky REVOKED status even when revokedAt is missing", () => {
    expect(isRevokedConnection({ status: "REVOKED", revokedAt: null })).toBe(true);
  });

  it("rejects a connection carrying a revocation timestamp", () => {
    expect(
      isRevokedConnection({ status: "ACTIVE", revokedAt: new Date("2026-01-01T00:00:00Z") })
    ).toBe(true);
  });

  it("allows non-revoked pending and active connections", () => {
    expect(isRevokedConnection({ status: "PENDING", revokedAt: null })).toBe(false);
    expect(isRevokedConnection({ status: "ACTIVE", revokedAt: null })).toBe(false);
  });
});
