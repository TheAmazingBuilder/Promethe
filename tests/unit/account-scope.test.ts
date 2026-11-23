import { describe, expect, it } from "vitest";
import {
  AccountNotFoundError,
  resolveOwnedAccount,
} from "@/server/account-errors";

describe("resolveOwnedAccount", () => {
  const accounts = [{ id: "account-a" }, { id: "account-b" }];

  it("returns null when no account filter was requested", () => {
    expect(resolveOwnedAccount(accounts, undefined)).toBeNull();
    expect(resolveOwnedAccount(accounts, null)).toBeNull();
  });

  it("resolves only an account in the supplied owner-scoped list", () => {
    expect(resolveOwnedAccount(accounts, "account-b")).toEqual({ id: "account-b" });
  });

  it("rejects unknown or foreign account IDs instead of widening to all", () => {
    expect(() => resolveOwnedAccount(accounts, "foreign-account")).toThrow(
      AccountNotFoundError
    );
  });
});
