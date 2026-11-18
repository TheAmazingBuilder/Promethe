"use client";

/**
 * Widget catalog preview — schematic miniature of a widget, drawn from its
 * type only. No real data is loaded and no prerequisite is needed: the same
 * miniature renders for available and requirement-gated widgets (the
 * catalog dims it when the Add button is disabled). Values are derived
 * deterministically from the widget type so previews are stable.
 */
import type { WidgetType } from "@/lib/dashboard/types";

/** Deterministic pseudo-random values in [0, 1) from a string seed. */
function seededValues(seed: string, count: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    h ^= h >>> 16;
    out.push(((h >>> 0) % 1000) / 1000);
  }
  return out;
}

type Shape =
  | "kpi"
  | "bigNumber"
  | "line"
  | "bars"
  | "table"
  | "calendar"
  | "heatmap"
  | "note"
  | "list"
  | "status"
  | "actions"
  | "progress"
  | "split";

const SHAPE_BY_TYPE: Record<WidgetType, Shape> = {
  "kpi-strip": "kpi",
  "single-kpi": "bigNumber",
  "equity-curve": "line",
  "drawdown-curve": "line",
  "pnl-calendar": "calendar",
  "open-trades": "table",
  "recent-trades": "table",
  "session-performance": "bars",
  "weekday-performance": "bars",
  "hour-performance": "bars",
  "strategy-table": "table",
  "instrument-table": "table",
  "r-histogram": "bars",
  "win-loss": "split",
  streak: "bigNumber",
  "goals-progress": "progress",
  "journal-prompt": "note",
  "review-queue": "list",
  "next-news": "list",
  "prop-status": "status",
  "sync-status": "status",
  "quick-actions": "actions",
  "sticky-note": "note",
  "custom-metric": "bigNumber",
  "period-compare": "bars",
  "saved-chart": "line",
  "risk-budget": "progress",
  "discipline-score": "bigNumber",
  "top-leaks": "list",
  "habits-at-a-glance": "progress",
  heatmap: "heatmap",
  "year-calendar": "calendar",
};

function BarsShape({ seed }: { seed: string }) {
  const values = seededValues(seed, 7);
  return (
    <div className="flex h-full items-end gap-1">
      {values.map((v, i) => (
        <div
          key={i}
          className={
            i === 3 ? "flex-1 rounded-sm bg-emerald-500/70" : "flex-1 rounded-sm bg-muted-foreground/25"
          }
          style={{ height: `${25 + v * 70}%` }}
        />
      ))}
    </div>
  );
}

function LineShape({ seed }: { seed: string }) {
  const values = seededValues(seed, 8);
  const points = values
    .map((v, i) => `${(i * 120) / (values.length - 1)},${44 - v * 34}`)
    .join(" ");
  return (
    <svg
      viewBox="0 0 120 48"
      preserveAspectRatio="none"
      className="h-full w-full text-emerald-500"
    >
      <polygon points={`0,48 ${points} 120,48`} className="fill-current opacity-10" />
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function KpiShape({ seed }: { seed: string }) {
  const values = seededValues(seed, 4);
  return (
    <div className="flex h-full gap-1.5">
      {values.map((v, i) => (
        <div
          key={i}
          className="flex flex-1 flex-col justify-center gap-1.5 rounded-sm border bg-background/60 px-1.5 py-1"
        >
          <div className="h-1.5 w-3/4 rounded-full bg-muted-foreground/25" />
          <div
            className={
              i === 0
                ? "h-2 rounded-full bg-emerald-500/70"
                : "h-2 rounded-full bg-muted-foreground/40"
            }
            style={{ width: `${45 + v * 50}%` }}
          />
        </div>
      ))}
    </div>
  );
}

function BigNumberShape({ seed }: { seed: string }) {
  const [v] = seededValues(seed, 1);
  return (
    <div className="flex h-full flex-col items-start justify-center gap-1.5 px-1">
      <div className="h-1.5 w-16 rounded-full bg-muted-foreground/25" />
      <div
        className="h-3.5 rounded-full bg-emerald-500/70"
        style={{ width: `${35 + (v ?? 0.5) * 40}%` }}
      />
      <div className="h-1.5 w-24 rounded-full bg-muted-foreground/20" />
    </div>
  );
}

function TableShape({ seed }: { seed: string }) {
  const values = seededValues(seed, 3);
  return (
    <div className="flex h-full flex-col justify-center gap-1.5">
      <div className="h-1.5 w-2/3 rounded-full bg-muted-foreground/30" />
      {values.map((v, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <div className="h-2 w-2 shrink-0 rounded-full bg-emerald-500/60" />
          <div
            className="h-1.5 rounded-full bg-muted-foreground/25"
            style={{ width: `${40 + v * 50}%` }}
          />
          <div className="ml-auto h-1.5 w-8 rounded-full bg-muted-foreground/20" />
        </div>
      ))}
    </div>
  );
}

function CalendarShape({ seed }: { seed: string }) {
  const values = seededValues(seed, 21);
  return (
    <div className="grid h-full grid-cols-7 gap-0.5">
      {values.map((v, i) => (
        <div
          key={i}
          className="rounded-[2px]"
          style={{
            backgroundColor:
              v > 0.66
                ? "rgb(16 185 129 / 0.55)"
                : v > 0.33
                  ? "rgb(16 185 129 / 0.25)"
                  : "rgb(148 163 184 / 0.18)",
          }}
        />
      ))}
    </div>
  );
}

function HeatmapShape({ seed }: { seed: string }) {
  const values = seededValues(seed, 24);
  return (
    <div className="grid h-full grid-cols-8 gap-0.5">
      {values.map((v, i) => (
        <div
          key={i}
          className="rounded-[2px]"
          style={{ backgroundColor: `rgb(16 185 129 / ${0.08 + v * 0.75})` }}
        />
      ))}
    </div>
  );
}

function NoteShape() {
  return (
    <div className="flex h-full flex-col justify-center gap-1.5 px-0.5">
      <div className="h-2 w-1/2 rounded-full bg-emerald-500/50" />
      <div className="h-1.5 w-full rounded-full bg-muted-foreground/25" />
      <div className="h-1.5 w-5/6 rounded-full bg-muted-foreground/25" />
      <div className="h-1.5 w-2/3 rounded-full bg-muted-foreground/20" />
    </div>
  );
}

function ListShape({ seed }: { seed: string }) {
  const values = seededValues(seed, 3);
  return (
    <div className="flex h-full flex-col justify-center gap-1.5">
      {values.map((v, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <div
            className={
              v > 0.5
                ? "flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-[3px] bg-emerald-500/70 text-[8px] leading-none text-white"
                : "h-2.5 w-2.5 shrink-0 rounded-[3px] border border-muted-foreground/40"
            }
          >
            {v > 0.5 ? "✓" : null}
          </div>
          <div
            className="h-1.5 rounded-full bg-muted-foreground/25"
            style={{ width: `${45 + v * 45}%` }}
          />
        </div>
      ))}
    </div>
  );
}

function StatusShape() {
  return (
    <div className="flex h-full flex-col justify-center gap-2">
      <div className="flex items-center gap-1.5">
        <div className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
        <div className="h-1.5 w-2/3 rounded-full bg-muted-foreground/25" />
      </div>
      <div className="flex items-center gap-1.5">
        <div className="h-2 w-2 shrink-0 rounded-full bg-amber-500/80" />
        <div className="h-1.5 w-1/2 rounded-full bg-muted-foreground/25" />
      </div>
      <div className="flex items-center gap-1.5">
        <div className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/40" />
        <div className="h-1.5 w-3/5 rounded-full bg-muted-foreground/20" />
      </div>
    </div>
  );
}

function ActionsShape() {
  return (
    <div className="grid h-full grid-cols-2 content-center gap-1.5">
      {["emerald", "muted", "muted", "muted"].map((tone, i) => (
        <div
          key={i}
          className={
            tone === "emerald"
              ? "flex h-5 items-center justify-center rounded-md bg-emerald-500/80"
              : "flex h-5 items-center justify-center rounded-md border border-muted-foreground/25 bg-background/60"
          }
        >
          <div
            className={
              tone === "emerald"
                ? "h-1.5 w-8 rounded-full bg-white/80"
                : "h-1.5 w-8 rounded-full bg-muted-foreground/30"
            }
          />
        </div>
      ))}
    </div>
  );
}

function ProgressShape({ seed }: { seed: string }) {
  const values = seededValues(seed, 2);
  return (
    <div className="flex h-full flex-col justify-center gap-2.5">
      {values.map((v, i) => (
        <div key={i} className="space-y-1">
          <div className="h-1.5 w-1/3 rounded-full bg-muted-foreground/25" />
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted-foreground/15">
            <div
              className="h-full rounded-full bg-emerald-500/70"
              style={{ width: `${30 + v * 65}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function SplitShape() {
  return (
    <div className="flex h-full flex-col justify-center gap-2 px-0.5">
      <div className="flex h-3 w-full overflow-hidden rounded-full">
        <div className="h-full bg-emerald-500/70" style={{ width: "58%" }} />
        <div className="h-full bg-red-400/60" style={{ width: "42%" }} />
      </div>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/70" />
          <span className="h-1.5 w-8 rounded-full bg-muted-foreground/25" />
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-red-400/60" />
          <span className="h-1.5 w-8 rounded-full bg-muted-foreground/25" />
        </span>
      </div>
    </div>
  );
}

/**
 * Non-interactive schematic preview of a widget type. Purely presentational:
 * decorative (aria-hidden) and pointer-events-none so it never steals clicks.
 */
export function WidgetPreview({
  type,
  className,
}: {
  type: string;
  className?: string;
}) {
  const shape: Shape = SHAPE_BY_TYPE[type as WidgetType] ?? "kpi";
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none h-16 w-full overflow-hidden rounded-md border bg-muted/30 p-2 ${
        className ?? ""
      }`}
    >
      {shape === "kpi" ? (
        <KpiShape seed={type} />
      ) : shape === "bigNumber" ? (
        <BigNumberShape seed={type} />
      ) : shape === "line" ? (
        <LineShape seed={type} />
      ) : shape === "bars" ? (
        <BarsShape seed={type} />
      ) : shape === "table" ? (
        <TableShape seed={type} />
      ) : shape === "calendar" ? (
        <CalendarShape seed={type} />
      ) : shape === "heatmap" ? (
        <HeatmapShape seed={type} />
      ) : shape === "note" ? (
        <NoteShape />
      ) : shape === "list" ? (
        <ListShape seed={type} />
      ) : shape === "status" ? (
        <StatusShape />
      ) : shape === "actions" ? (
        <ActionsShape />
      ) : shape === "progress" ? (
        <ProgressShape seed={type} />
      ) : (
        <SplitShape />
      )}
    </div>
  );
}
