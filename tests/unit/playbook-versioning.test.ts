/**
 * Lot 11 (roadmap §14) - per-version performance grouping and strategy
 * snapshot comparison.
 *
 * Performance was grouped by strategy only: editing a strategy silently
 * moved old trades under the new definition. versionPerformance groups by
 * the version frozen at entry, with a null bucket for trades that predate
 * versioning. diffStrategySnapshots powers the compare view in the
 * versions dialog.
 */
import { describe, expect, it } from "vitest";
import { versionPerformance } from "@/lib/playbook/version-performance";
import { diffStrategySnapshots } from "@/lib/playbook/version-diff";

describe("versionPerformance", () => {
  it("groups closed trades by frozen version; null bucket goes last", () => {
    const rows = versionPerformance([
      { strategyVersion: 2, rMultiple: 2, resultType: "WIN" },
      { strategyVersion: 1, rMultiple: 1, resultType: "WIN" },
      { strategyVersion: 1, rMultiple: -1, resultType: "LOSS" },
      { strategyVersion: null, rMultiple: 0.5, resultType: "WIN" },
      { strategyVersion: 2, rMultiple: null, resultType: "BE" },
    ]);
    expect(rows.map((r) => r.version)).toEqual([2, 1, null]);
    const v1 = rows.find((r) => r.version === 1)!;
    expect(v1.trades).toBe(2);
    expect(v1.totalR).toBe(0);
    expect(v1.expectancyR).toBe(0);
    expect(v1.winRatePct).toBe(50);
    const v2 = rows.find((r) => r.version === 2)!;
    expect(v2.trades).toBe(2);
    // The breakeven trade has no R: it counts in trades/win rate, not in R.
    expect(v2.totalR).toBe(2);
    expect(v2.expectancyR).toBe(2);
    expect(v2.winRatePct).toBe(50);
    const pre = rows.find((r) => r.version === null)!;
    expect(pre.trades).toBe(1);
    expect(pre.totalR).toBe(0.5);
  });

  it("returns null R figures when no trade in the bucket has an R", () => {
    const rows = versionPerformance([
      { strategyVersion: 1, rMultiple: null, resultType: "BE" },
    ]);
    expect(rows[0].totalR).toBeNull();
    expect(rows[0].expectancyR).toBeNull();
    expect(rows[0].winRatePct).toBe(0);
  });

  it("returns no rows for no trades", () => {
    expect(versionPerformance([])).toEqual([]);
  });
});

describe("diffStrategySnapshots", () => {
  it("reports only changed fields, oldest first in each row", () => {
    const rows = diffStrategySnapshots(
      {
        name: "London Breakout",
        status: "ACTIVE",
        defaultRiskPercent: "1",
        entryRules: "Enter on BOS",
        checklistItems: [{ label: "HTF aligned", isRequired: true }],
      },
      {
        name: "London Breakout",
        status: "ACTIVE",
        defaultRiskPercent: "0.5",
        entryRules: "Enter on BOS",
        checklistItems: [
          { label: "HTF aligned", isRequired: true },
          { label: "News checked", isRequired: true },
        ],
      },
    );
    expect(rows.map((r) => r.field)).toEqual([
      "defaultRiskPercent",
      "checklist",
    ]);
    const risk = rows.find((r) => r.field === "defaultRiskPercent")!;
    expect(risk.from).toBe("1");
    expect(risk.to).toBe("0.5");
    const checklist = rows.find((r) => r.field === "checklist")!;
    expect(checklist.from).toBe("1 item (1 required)");
    expect(checklist.to).toBe("2 items (2 required)");
  });

  it("returns no rows for identical snapshots", () => {
    const snap = { name: "A", status: "ACTIVE", timeframes: ["H1"] };
    expect(diffStrategySnapshots(snap, snap)).toEqual([]);
  });

  it("treats an absent extended field on an old snapshot as unchanged when the new side is empty", () => {
    const rows = diffStrategySnapshots(
      { name: "A" },
      { name: "A", marketConditions: [], entryConditions: [] },
    );
    expect(rows).toEqual([]);
  });

  it("flags a newly added entry condition list", () => {
    const rows = diffStrategySnapshots(
      { name: "A" },
      { name: "A", entryConditions: [{ text: "BOS on H1" }] },
    );
    expect(rows.map((r) => r.field)).toEqual(["entryConditions"]);
  });
});
