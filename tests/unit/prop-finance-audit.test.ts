import { describe, expect, it } from "vitest";
import {
  expenseSnapshot,
  payoutSnapshot,
  validatePayoutDates,
  type PropFinanceExpenseSnapshot,
  type PropFinancePayoutSnapshot,
} from "@/lib/prop/finance-audit";

const START = "2026-01-05";

describe("validatePayoutDates (§13)", () => {
  it("refuses a requested date before the challenge start", () => {
    expect(
      validatePayoutDates({ startDate: START, requestedAt: "2026-01-04", receivedAt: null }),
    ).toBe("PAYOUT_BEFORE_CHALLENGE_START");
  });

  it("accepts a requested date on the challenge start", () => {
    expect(
      validatePayoutDates({ startDate: START, requestedAt: "2026-01-05", receivedAt: null }),
    ).toBeNull();
  });

  it("refuses a received date before the requested date", () => {
    expect(
      validatePayoutDates({
        startDate: START,
        requestedAt: "2026-01-10",
        receivedAt: "2026-01-09",
      }),
    ).toBe("RECEIVED_BEFORE_REQUESTED");
  });

  it("accepts a received date equal to the requested date", () => {
    expect(
      validatePayoutDates({
        startDate: START,
        requestedAt: "2026-01-10",
        receivedAt: "2026-01-10",
      }),
    ).toBeNull();
  });

  it("accepts a valid pair and a missing received date", () => {
    expect(
      validatePayoutDates({
        startDate: START,
        requestedAt: "2026-01-10",
        receivedAt: "2026-01-12",
      }),
    ).toBeNull();
    expect(
      validatePayoutDates({ startDate: START, requestedAt: "2026-01-10", receivedAt: null }),
    ).toBeNull();
  });

  it("checks the start rule before the received rule", () => {
    expect(
      validatePayoutDates({
        startDate: START,
        requestedAt: "2026-01-01",
        receivedAt: "2025-12-31",
      }),
    ).toBe("PAYOUT_BEFORE_CHALLENGE_START");
  });
});

describe("finance snapshots (§13)", () => {
  it("serializes a payout with amounts as strings and dates as YYYY-MM-DD", () => {
    const snap: PropFinancePayoutSnapshot = payoutSnapshot({
      grossAmount: { toString: () => "1000" },
      profitSplitPercent: { toString: () => "80" },
      netAmount: { toString: () => "800" },
      currency: "USD",
      status: "RECEIVED",
      requestedAt: new Date("2026-01-10T05:00:00.000Z"),
      receivedAt: new Date("2026-01-12T05:00:00.000Z"),
      method: null,
      note: "first payout",
    });
    expect(snap).toEqual({
      kind: "PAYOUT",
      grossAmount: "1000",
      profitSplitPercent: "80",
      netAmount: "800",
      currency: "USD",
      status: "RECEIVED",
      requestedAt: "2026-01-10",
      receivedAt: "2026-01-12",
      method: null,
      note: "first payout",
    });
  });

  it("serializes a payout without received date or note", () => {
    const snap = payoutSnapshot({
      grossAmount: { toString: () => "500" },
      profitSplitPercent: { toString: () => "90" },
      netAmount: { toString: () => "450" },
      currency: "EUR",
      status: "REQUESTED",
      requestedAt: new Date("2026-02-01T00:00:00.000Z"),
      receivedAt: null,
      method: "Bank transfer",
      note: null,
    });
    expect(snap.receivedAt).toBeNull();
    expect(snap.note).toBeNull();
    expect(snap.method).toBe("Bank transfer");
    expect(snap.kind).toBe("PAYOUT");
  });

  it("serializes an expense with its type and date", () => {
    const snap: PropFinanceExpenseSnapshot = expenseSnapshot({
      type: "RESET",
      amount: { toString: () => "99" },
      currency: "USD",
      date: new Date("2026-01-06T00:00:00.000Z"),
      note: null,
      challengeId: "c1",
    });
    expect(snap).toEqual({
      kind: "EXPENSE",
      type: "RESET",
      amount: "99",
      currency: "USD",
      date: "2026-01-06",
      note: null,
      challengeId: "c1",
    });
  });
});
