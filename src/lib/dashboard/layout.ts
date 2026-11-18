/**
 * Dashboard module — layout normalization & migration (v2.5 Module 1, spec §7).
 *
 * Repairs corrupted / hand-edited / legacy layouts:
 *  - clamps width/height to the widget's min/max (registry-provided bounds);
 *  - clamps x into [0, cols - w] and y ≥ 0;
 *  - resolves collisions by pushing widgets down (vertical compaction);
 *  - fills missing breakpoints by deriving from the nearest defined one;
 *  - version migration hook (LAYOUT_SCHEMA_VERSION).
 *
 * Pure & unit-tested — runs on read (server) AND on save (defense in depth).
 */
import {
  BREAKPOINTS,
  GRID_COLS,
  LAYOUT_SCHEMA_VERSION,
  type Breakpoint,
  type WidgetLayout,
  type WidgetLayouts,
} from "./types";

export interface NormalizableWidget {
  id: string;
  layouts: WidgetLayouts;
  /** Optional bounds - defaults when absent (registry lookup done by caller). */
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
}

const DEFAULT_MIN: Required<
  Pick<WidgetLayout, "w" | "h">
> = { w: 2, h: 2 };
const DEFAULT_MAX: Required<Pick<WidgetLayout, "w" | "h">> = { w: 12, h: 12 };

function clamp(
  value: number,
  min: number,
  max: number,
  fallback: number
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Repair one layout in place (bounds + grid containment). */
function repairLayout(
  layout: WidgetLayout,
  bounds: { minW: number; minH: number; maxW: number; maxH: number },
  cols: number
): WidgetLayout {
  const w = clamp(layout.w, bounds.minW, Math.min(bounds.maxW, cols), DEFAULT_MIN.w);
  const h = clamp(layout.h, bounds.minH, bounds.maxH, DEFAULT_MIN.h);
  const x = clamp(layout.x, 0, Math.max(0, cols - w), 0);
  const y = Math.max(0, Math.round(Number.isFinite(layout.y) ? layout.y : 0));
  return { x, y, w, h };
}

/**
 * Vertical compaction — reflow widgets row by row, pushing colliders down.
 * Deterministic: widgets sorted by (y, x) first; each takes the lowest free
 * position that does not overlap an already-placed widget.
 */
function compact(
  entries: Array<{ id: string; layout: WidgetLayout }>
): Map<string, WidgetLayout> {
  const placed = new Map<string, WidgetLayout>();
  const sorted = [...entries].sort(
    (a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x
  );

  /** Occupancy test against placed widgets. */
  const overlaps = (candidate: WidgetLayout): boolean => {
    for (const p of placed.values()) {
      if (
        candidate.x < p.x + p.w &&
        candidate.x + candidate.w > p.x &&
        candidate.y < p.y + p.h &&
        candidate.y + candidate.h > p.y
      ) {
        return true;
      }
    }
    return false;
  };

  for (const { id, layout } of sorted) {
    let current = layout;
    let guard = 0;
    while (overlaps(current) && guard < 200) {
      current = { ...current, y: current.y + 1 };
      guard++;
    }
    placed.set(id, current);
  }
  return placed;
}

/**
 * Fill missing breakpoints. Rule: derive `bp` from the closest larger
 * defined breakpoint (lg ← md ← sm fallback chain), clamping widths to
 * a per-breakpoint column budget so tablet/mobile stay usable.
 */
function fillBreakpoints(layouts: WidgetLayouts): WidgetLayouts {
  const out: WidgetLayouts = { ...layouts };
  // Column budget per breakpoint (tablets are narrower).
  const budget: Record<Breakpoint, number> = { lg: 12, md: 6, sm: 4 };

  for (const bp of BREAKPOINTS) {
    if (out[bp]) continue;
    // Closest defined breakpoint above in the chain lg → md → sm.
    const chain: Breakpoint[] = ["lg", "md", "sm"];
    const idx = chain.indexOf(bp);
    let source: WidgetLayout | undefined;
    for (let i = idx - 1; i >= 0 && !source; i--) {
      source = out[chain[i]];
    }
    if (!source) {
      // Nothing defined above: try the ones below (e.g. only sm given).
      for (let i = idx + 1; i < chain.length && !source; i++) {
        source = out[chain[i]];
      }
    }
    out[bp] = source
      ? { ...source, w: Math.min(source.w, budget[bp]) }
      : { x: 0, y: 0, w: Math.min(4, budget[bp]), h: 3 };
  }
  return out;
}

/**
 * Normalize the layouts of every widget on one dashboard.
 * Returns fully-repaired layouts for all three breakpoints.
 */
export function normalizeLayouts(
  widgets: NormalizableWidget[]
): Record<string, WidgetLayouts> {
  const result: Record<string, WidgetLayouts> = {};

  // Pass 1 — repair bounds per breakpoint, on filled layouts.
  const repaired: Array<{
    id: string;
    bp: Breakpoint;
    layout: WidgetLayout;
  }> = [];

  for (const widget of widgets) {
    const filled = fillBreakpoints(widget.layouts ?? {});
    const bounds = {
      minW: widget.minW ?? DEFAULT_MIN.w,
      minH: widget.minH ?? DEFAULT_MIN.h,
      maxW: widget.maxW ?? DEFAULT_MAX.w,
      maxH: widget.maxH ?? DEFAULT_MAX.h,
    };
    for (const bp of BREAKPOINTS) {
      const raw = filled[bp] ?? { x: 0, y: 0, w: 4, h: 3 };
      repaired.push({
        id: widget.id,
        bp,
        layout: repairLayout(raw, bounds, GRID_COLS),
      });
    }
  }

  // Pass 2 — collision compaction per breakpoint.
  for (const bp of BREAKPOINTS) {
    const entries = repaired
      .filter((r) => r.bp === bp)
      .map((r) => ({ id: r.id, layout: r.layout }));
    const placed = compact(entries);
    for (const [id, layout] of placed) {
      result[id] = result[id] ?? {};
      result[id]![bp] = layout;
    }
  }

  return result;
}

/**
 * Layout schema migration — currently a no-op passthrough at version 1.
 * Future migrations chain here: migrate(v1) → v2 → … → current.
 */
export function migrateLayouts(
  /** Persisted layoutVersion of the dashboard. */
  fromVersion: number,
  layouts: WidgetLayouts
): { version: number; layouts: WidgetLayouts } {
  let version = Math.max(1, Math.floor(fromVersion) || 1);
  let current = layouts;
  // v1 → v2 example:
  // if (version === 1) { current = { ...current, /* transform */ }; version = 2; }
  void current;
  return { version: Math.min(version, LAYOUT_SCHEMA_VERSION), layouts: current };
}

/**
 * First free slot for a new widget of size (w × h) on a 12-col grid —
 * used by the catalog "Add" action. Scans rows top→bottom, columns left→right.
 */
export function findFreeSlot(
  existing: WidgetLayout[],
  w: number,
  h: number,
  cols: number = GRID_COLS
): { x: number; y: number } {
  const width = Math.min(w, cols);
  const height = Math.max(1, h);
  const maxY = existing.reduce((acc, l) => Math.max(acc, l.y + l.h), 0);

  for (let y = 0; y <= maxY + 1; y++) {
    for (let x = 0; x + width <= cols; x++) {
      const candidate = { x, y, w: width, h: height };
      const collides = existing.some(
        (l) =>
          candidate.x < l.x + l.w &&
          candidate.x + candidate.w > l.x &&
          candidate.y < l.y + l.h &&
          candidate.y + candidate.h > l.y
      );
      if (!collides) return { x, y };
    }
  }
  return { x: 0, y: maxY };
}
