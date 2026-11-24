import { describe, expect, it } from "vitest";
import {
  comparePlanVsReal,
  validateExitPlan,
  type ExecutionLike,
  type ModificationLike,
} from "@/lib/tools/exit-plans";
import type { ExitPlanEntry } from "@/lib/tools/types";

function plan(
  tiers: ExitPlanEntry["tiers"],
  trailingAfterTier: number | null = null
): ExitPlanEntry {
  return {
    id: "plan-1",
    name: "Test plan",
    tiers,
    breakevenAfterTier: null,
    trailingAfterTier,
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function execution(patch: Partial<ExecutionLike> = {}): ExecutionLike {
  return {
    id: "exit-1",
    type: "PARTIAL_EXIT",
    price: "110.9",
    lots: "0.5",
    time: "2026-11-24T10:00:00.000Z",
    ...patch,
  };
}

function modification(patch: Partial<ModificationLike> = {}): ModificationLike {
  return {
    id: "mod-1",
    field: "STOP_LOSS",
    oldValue: "90",
    newValue: "100",
    time: "2026-11-24T10:05:00.000Z",
    ...patch,
  };
}

describe("exit plan validation and comparison", () => {
  it("rejects non-finite or non-numeric targets and more than four tiers", () => {
    expect(validateExitPlan([{ pct: 100, targetType: "PRICE", target: "Infinity" }])).toBe("target");
    expect(validateExitPlan([{ pct: 100, targetType: "R", target: "not-a-number" }])).toBe("target");
    expect(
      validateExitPlan(
        Array.from({ length: 5 }, () => ({ pct: 20, targetType: "R" as const, target: "1" }))
      )
    ).toBe("count");
    expect(
      validateExitPlan(
        [{ pct: 100, targetType: "R", target: "1" }],
        1,
        null
      )
    ).toBe("trigger");
    expect(
      validateExitPlan(
        [{ pct: 100, targetType: "R", target: "1" }],
        null,
        -1
      )
    ).toBe("trigger");
  });

  it("rejects breakeven or trailing triggers that reference a missing tier", () => {
    const tiers = [{ pct: 100, targetType: "R" as const, target: "2" }];
    expect(validateExitPlan(tiers, 1, null)).toBe("trigger");
    expect(validateExitPlan(tiers, null, 1)).toBe("trigger");
    expect(validateExitPlan(tiers, 0, 0)).toBeNull();
  });

  it("assigns one execution to only its closest matching tier", () => {
    const result = comparePlanVsReal(
      plan([
        { pct: 50, targetType: "PRICE", target: "110" },
        { pct: 50, targetType: "PRICE", target: "111" },
      ]),
      "LONG",
      "100",
      "90",
      "1",
      [execution()],
      []
    );

    expect(result.tiers[0].realizedPct.toString()).toBe("0");
    expect(result.tiers[1].realizedPct.toString()).toBe("50");
    expect(result.totalRealizedPct.toString()).toBe("50");
  });

  it("does not treat a breakeven move alone as trailing", () => {
    const result = comparePlanVsReal(
      plan([{ pct: 50, targetType: "PRICE", target: "110" }], 0),
      "LONG",
      "100",
      "90",
      "1",
      [execution({ price: "110", time: "2026-11-24T10:00:00.000Z" })],
      [modification()]
    );

    expect(result.breakevenMoved).toBe(true);
    expect(result.trailingStarted).toBe(false);
  });

  it("recognizes trailing only after the configured tier and a profitable stop advance", () => {
    const result = comparePlanVsReal(
      plan([{ pct: 50, targetType: "PRICE", target: "110" }], 0),
      "LONG",
      "100",
      "90",
      "1",
      [execution({ price: "110", time: "2026-11-24T10:00:00.000Z" })],
      [
        modification(),
        modification({
          id: "mod-2",
          oldValue: "100",
          newValue: "105",
          time: "2026-11-24T10:10:00.000Z",
        }),
      ]
    );

    expect(result.trailingStarted).toBe(true);
  });

  it("ignores manual realized percentages outside the 0–100 range", () => {
    const result = comparePlanVsReal(
      plan([{ pct: 50, targetType: "PRICE", target: "110" }]),
      "LONG",
      "100",
      "90",
      "1",
      [execution({ price: "110", lots: "0.25" })],
      [],
      { 0: "150" }
    );

    expect(result.tiers[0].realizedPct.toString()).toBe("25");
  });
});
