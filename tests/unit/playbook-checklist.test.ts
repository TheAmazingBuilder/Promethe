/**
 * Lot 11 (roadmap §14) - Playbook checklist evaluation.
 *
 * Mandatory checklists used to be recorded but never evaluated: a trade
 * could claim a full checklist while required items were unchecked, and
 * nothing anywhere scored it. evaluateChecklist is the single source of
 * truth used by the trade detail, the frozen-snapshot evaluation and the
 * pre-trade warnings.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateChecklist,
  resolveFrozenChecklistItems,
} from "@/lib/playbook/checklist";

const ITEMS = [
  { id: "a", label: "HTF trend aligned", isRequired: true },
  { id: "b", label: "Liquidity sweep", isRequired: true },
  { id: "c", label: "Journal note", isRequired: false },
];

describe("evaluateChecklist", () => {
  it("counts only required items; optional items never block completion", () => {
    const status = evaluateChecklist(ITEMS, { a: true, b: true });
    expect(status).toEqual({
      requiredTotal: 2,
      requiredChecked: 2,
      missing: [],
      complete: true,
    });
  });

  it("lists missing required labels; a missing answer counts as unchecked", () => {
    const status = evaluateChecklist(ITEMS, { a: true });
    expect(status.requiredTotal).toBe(2);
    expect(status.requiredChecked).toBe(1);
    expect(status.missing).toEqual(["Liquidity sweep"]);
    expect(status.complete).toBe(false);
  });

  it("treats a null result map as nothing checked", () => {
    const status = evaluateChecklist(ITEMS, null);
    expect(status.requiredChecked).toBe(0);
    expect(status.missing).toEqual(["HTF trend aligned", "Liquidity sweep"]);
    expect(status.complete).toBe(false);
  });

  it("ignores unknown answer ids", () => {
    const status = evaluateChecklist(ITEMS, {
      a: true,
      b: true,
      deleted: true,
    });
    expect(status.complete).toBe(true);
    expect(status.requiredChecked).toBe(2);
  });

  it("an empty required list is complete", () => {
    const status = evaluateChecklist(
      [{ id: "c", label: "Journal note", isRequired: false }],
      {},
    );
    expect(status).toEqual({
      requiredTotal: 0,
      requiredChecked: 0,
      missing: [],
      complete: true,
    });
  });
});

describe("resolveFrozenChecklistItems", () => {
  it("maps frozen items to answer keys by id", () => {
    const resolved = resolveFrozenChecklistItems(
      [{ id: "old-a", label: "HTF trend aligned", isRequired: true }],
      [{ id: "live-a", label: "HTF trend aligned" }],
    );
    expect(resolved).toEqual([
      { id: "old-a", label: "HTF trend aligned", isRequired: true },
    ]);
  });

  it("falls back to the live id when the frozen item has no id (pre-Lot-11 snapshot)", () => {
    const resolved = resolveFrozenChecklistItems(
      [{ label: "Liquidity sweep", isRequired: true }],
      [
        { id: "live-a", label: "HTF trend aligned" },
        { id: "live-b", label: "Liquidity sweep" },
      ],
    );
    expect(resolved[0].id).toBe("live-b");
  });

  it("keeps a synthetic key when neither id nor a live match exists", () => {
    const resolved = resolveFrozenChecklistItems(
      [{ label: "Deleted item", isRequired: true }],
      [],
    );
    expect(resolved[0].id).toBe("frozen:Deleted item");
    // The synthetic key never matches a stored answer, so it stays missing.
    expect(evaluateChecklist(resolved, {}).missing).toEqual(["Deleted item"]);
  });
});
