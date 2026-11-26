import { describe, expect, it } from "vitest";
import { selectEquityAccounts } from "@/lib/analytics/account-scope";

describe("selectEquityAccounts", () => {
  const accounts = [
    { id: "usd-1", currency: "USD" },
    { id: "usd-2", currency: "USD" },
    { id: "cad-1", currency: "CAD" },
  ];

  it("uses only the selected account balance in an account-filtered view", () => {
    expect(selectEquityAccounts(accounts, accounts[2], "CAD")).toEqual([
      accounts[2],
    ]);
  });

  it("keeps only accounts matching the display currency in the global view", () => {
    expect(selectEquityAccounts(accounts, null, "USD")).toEqual([
      accounts[0],
      accounts[1],
    ]);
  });

  it("returns an empty set when no global account matches the display currency", () => {
    expect(selectEquityAccounts(accounts, null, "EUR")).toEqual([]);
  });
});
