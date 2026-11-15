/**
 * Dashboard module — layout normalization & migration unit tests
 * (v2.5 Module 1, spec §7).
 *
 * Pure function coverage: bounds clamping, collision repair (vertical
 * compaction), breakpoint filling, determinism, free-slot search and the
 * v1 migration passthrough. No DB, no React.
 */
import { describe, expect, it } from "vitest";
import {
  findFreeSlot,
  migrateLayouts,
  normalizeLayouts,
  type NormalizableWidget,
} from "@/lib/dashboard/layout";
import {
  BREAKPOINTS,
  LAYOUT_SCHEMA_VERSION,
} from "@/lib/dashboard/types";

type Bounds = Partial<Pick<NormalizableWidget, "minW" | "minH" | "maxW" | "maxH">>;

function widget(
  id: string,
  layouts: NormalizableWidget["layouts"],
  bounds: Bounds = {},
): NormalizableWidget {
  return { id, layouts, ...bounds };
}

// ── normalizeLayouts ─────────────────────────────────────────────────────────

describe("normalizeLayouts", () => {
  it("clamps w into [minW, min(maxW, 12)] and h into [minH, maxH]", () => {
    const out = normalizeLayouts([
      widget("w", { lg: { x: 0, y: 0, w: 99, h: 99 } }, { minW: 4, minH: 3, maxW: 6, maxH: 8 }),
    ]);
    expect(out.w!.lg).toEqual({ x: 0, y: 0, w: 6, h: 8 });
  });

  it("raises undersized w/h up to the minimums", () => {
    const out = normalizeLayouts([
      widget("w", { lg: { x: 0, y: 0, w: 1, h: 1 } }, { minW: 4, minH: 3, maxW: 12, maxH: 12 }),
    ]);
    expect(out.w!.lg).toEqual({ x: 0, y: 0, w: 4, h: 3 });
  });

  it("clamps x into [0, 12 − w] and floors y at 0", () => {
    const out = normalizeLayouts([widget("w", { lg: { x: 11, y: -7, w: 4, h: 2 } })]);
    expect(out.w!.lg).toEqual({ x: 8, y: 0, w: 4, h: 2 });
  });

  it("repairs overlaps by pushing the second widget below the first", () => {
    const out = normalizeLayouts([
      widget("a", { lg: { x: 0, y: 0, w: 4, h: 2 } }),
      widget("b", { lg: { x: 0, y: 0, w: 4, h: 2 } }),
    ]);
    expect(out.a!.lg).toEqual({ x: 0, y: 0, w: 4, h: 2 });
    expect(out.b!.lg).toEqual({ x: 0, y: 2, w: 4, h: 2 });
  });

  it("fills missing breakpoints from lg (md w ≤ 6, sm w ≤ 4)", () => {
    const out = normalizeLayouts([widget("w", { lg: { x: 2, y: 3, w: 8, h: 5 } })]);
    expect(out.w!.lg).toEqual({ x: 2, y: 3, w: 8, h: 5 });
    expect(out.w!.md).toEqual({ x: 2, y: 3, w: 6, h: 5 });
    expect(out.w!.sm).toEqual({ x: 2, y: 3, w: 4, h: 5 });
  });

  it("derives missing breakpoints even when only md is defined", () => {
    const out = normalizeLayouts([widget("w", { md: { x: 1, y: 2, w: 5, h: 3 } })]);
    expect(out.w!.lg).toEqual({ x: 1, y: 2, w: 5, h: 3 }); // lg ← md
    expect(out.w!.md).toEqual({ x: 1, y: 2, w: 5, h: 3 });
    expect(out.w!.sm).toEqual({ x: 1, y: 2, w: 4, h: 3 }); // sm ← md, w ≤ 4
  });

  it("returns all three breakpoints for every widget, even with empty layouts", () => {
    const out = normalizeLayouts([widget("w", {})]);
    for (const bp of BREAKPOINTS) {
      expect(out.w![bp], bp).toBeDefined();
    }
    expect(out.w!.lg).toEqual({ x: 0, y: 0, w: 4, h: 3 }); // safe default footprint
  });

  it("is deterministic — same input, same output", () => {
    const input = [
      widget("a", { lg: { x: 0, y: 0, w: 4, h: 2 } }),
      widget("b", { lg: { x: 0, y: 0, w: 6, h: 3 } }),
      widget("c", { lg: { x: 4, y: 0, w: 4, h: 2 } }),
    ];
    expect(normalizeLayouts(input)).toEqual(normalizeLayouts(input));
    expect(normalizeLayouts(structuredClone(input))).toEqual(normalizeLayouts(input));
  });

  it("places widgets sorted by (y, x) into the lowest free positions", () => {
    // 'a' and 'b' collide at the origin; 'c' sits beside them and must not move.
    const out = normalizeLayouts([
      widget("a", { lg: { x: 0, y: 0, w: 4, h: 2 } }),
      widget("b", { lg: { x: 0, y: 0, w: 4, h: 2 } }),
      widget("c", { lg: { x: 4, y: 0, w: 4, h: 2 } }),
    ]);
    expect(out.a!.lg).toEqual({ x: 0, y: 0, w: 4, h: 2 });
    expect(out.b!.lg).toEqual({ x: 0, y: 2, w: 4, h: 2 });
    expect(out.c!.lg).toEqual({ x: 4, y: 0, w: 4, h: 2 });
  });

  it("keeps non-overlapping widgets at their original positions", () => {
    const out = normalizeLayouts([
      widget("bottom", { lg: { x: 0, y: 5, w: 4, h: 2 } }),
      widget("top", { lg: { x: 0, y: 0, w: 4, h: 2 } }),
    ]);
    expect(out.top!.lg).toEqual({ x: 0, y: 0, w: 4, h: 2 });
    expect(out.bottom!.lg).toEqual({ x: 0, y: 5, w: 4, h: 2 });
  });

  it("compacts every breakpoint independently", () => {
    const out = normalizeLayouts([
      widget("a", { lg: { x: 0, y: 0, w: 4, h: 2 } }),
      widget("b", { md: { x: 0, y: 0, w: 4, h: 2 } }), // only md defined
    ]);
    for (const bp of BREAKPOINTS) {
      expect(out.a![bp], bp).toEqual({ x: 0, y: 0, w: 4, h: 2 });
      expect(out.b![bp], bp).toEqual({ x: 0, y: 2, w: 4, h: 2 });
    }
  });
});

// ── findFreeSlot ─────────────────────────────────────────────────────────────

describe("findFreeSlot", () => {
  it("returns the origin on an empty grid", () => {
    expect(findFreeSlot([], 4, 2)).toEqual({ x: 0, y: 0 });
  });

  it("returns the first non-overlapping position", () => {
    // Origin occupied → first free slot is beside it.
    expect(findFreeSlot([{ x: 0, y: 0, w: 4, h: 2 }], 4, 2)).toEqual({ x: 4, y: 0 });
    // Widget floating lower down → the top-left corner is free.
    expect(findFreeSlot([{ x: 4, y: 2, w: 4, h: 2 }], 4, 2)).toEqual({ x: 0, y: 0 });
  });

  it("scans rows top→bottom, columns left→right", () => {
    const existing = [
      { x: 0, y: 0, w: 4, h: 2 },
      { x: 8, y: 0, w: 4, h: 2 },
    ];
    // A 4-col gap exists at x=4 in row 0.
    expect(findFreeSlot(existing, 4, 2)).toEqual({ x: 4, y: 0 });
    // Nothing 5-wide fits in row 0 → next row.
    expect(findFreeSlot(existing, 5, 2)).toEqual({ x: 0, y: 2 });
  });

  it("appends below when the row is full", () => {
    const existing = [
      { x: 0, y: 0, w: 8, h: 2 },
      { x: 8, y: 0, w: 4, h: 2 },
    ];
    expect(findFreeSlot(existing, 6, 2)).toEqual({ x: 0, y: 2 });
  });

  it("clamps the requested width to the grid", () => {
    expect(findFreeSlot([], 20, 2)).toEqual({ x: 0, y: 0 });
  });
});

// ── migrateLayouts ───────────────────────────────────────────────────────────

describe("migrateLayouts", () => {
  it("version 1 is a passthrough (same version, same layouts)", () => {
    const layouts = { lg: { x: 1, y: 2, w: 4, h: 3 } };
    const migrated = migrateLayouts(1, layouts);
    expect(migrated.version).toBe(1);
    expect(migrated.layouts).toBe(layouts); // untouched reference
    expect(migrated.layouts.lg).toEqual({ x: 1, y: 2, w: 4, h: 3 });
  });

  it("clamps future versions to the current schema version", () => {
    expect(LAYOUT_SCHEMA_VERSION).toBe(1);
    const migrated = migrateLayouts(99, { lg: { x: 0, y: 0, w: 2, h: 2 } });
    expect(migrated.version).toBe(1);
    expect(migrated.layouts.lg).toEqual({ x: 0, y: 0, w: 2, h: 2 });
  });

  it("normalizes non-positive versions to 1", () => {
    expect(migrateLayouts(0, {}).version).toBe(1);
  });
});
