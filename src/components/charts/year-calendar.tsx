"use client";

/**
 * v2.5 Module 2 — yearly contribution calendar (spec §4.6).
 *
 * GitHub-style year grid (custom SVG): weeks as columns, weekdays as rows.
 * Year selector, metric selector (daily net P&L, daily R, trade count,
 * win/loss, journal filled, discipline), color intensity from the semantic
 * tokens, localized month labels, week start per locale, click a day → that
 * day's journal, keyboard navigation (arrows), accessible table view.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { Table2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n/i18n-provider";
import { apiFetch } from "@/lib/api-client";
import { navigate } from "@/lib/router";
import { fmtNum } from "@/lib/format";
import { useFormat } from "@/lib/format/use-format";
import {
  buildYearGrid,
  cellTone,
  metricScale,
  type YearCell,
  type YearDayStats,
  type YearMetric,
} from "@/lib/charts/yearGrid";

interface YearDaysPayload {
  year: number;
  currency: string;
  timezone: string;
  days: Record<string, YearDayStats>;
}

const CELL = 13;
const GAP = 3;
const LABEL_W = 26;
const MONTH_LABEL_H = 16;
const LEGEND_H = 22;

const METRICS: Array<{ key: YearMetric; labelKey: string }> = [
  { key: "netPnl", labelKey: "mNetPnl" },
  { key: "totalR", labelKey: "mTotalR" },
  { key: "tradeCount", labelKey: "mTradeCount" },
  { key: "winLoss", labelKey: "mWinLoss" },
  { key: "journal", labelKey: "mJournal" },
  { key: "discipline", labelKey: "mDiscipline" },
];

export function YearCalendar({
  year,
  onYearChange,
}: {
  year: number;
  onYearChange: (year: number) => void;
}) {
  const t = useTranslations("chartsBuilder.yearCalendar");
  const { locale } = useI18n();
  const fmt = useFormat();
  const [metric, setMetric] = React.useState<YearMetric>("netPnl");
  const [showTable, setShowTable] = React.useState(false);
  const [focus, setFocus] = React.useState<{ row: number; col: number } | null>(null);

  const data = useQuery({
    queryKey: ["calendar", "year", year],
    queryFn: async () => apiFetch<YearDaysPayload>(`/api/v1/calendar/year?year=${year}`),
    staleTime: 5 * 60 * 1000,
  });

  // Week start per locale (en-US → Sunday=7, else Monday=1).
  const weekStart: 1 | 7 = locale.startsWith("en") ? 7 : 1;

  const stats = data.data?.days ?? {};
  const grid = React.useMemo(
    () => buildYearGrid(year, stats, weekStart),
    [year, stats, weekStart]
  );
  const scale = React.useMemo(() => metricScale(stats, metric), [stats, metric]);

  const formatDay = (cell: YearCell): string => {
    const s = cell.stats;
    if (!s) return t("cellEmpty");
    switch (metric) {
      case "netPnl":
        return t("cellPnl", {
          amount: fmt.money(s.netPnl, data.data?.currency ?? "USD"),
          count: s.tradeCount,
        });
      case "totalR":
        return t("cellR", { r: fmtNum(s.totalR ?? 0, 2), count: s.tradeCount });
      case "tradeCount":
        return t("cellCount", { count: s.tradeCount });
      case "winLoss":
        return t("cellWinLoss", { wins: s.wins, losses: s.losses });
      case "journal":
        return s.hasJournal ? t("cellJournalYes") : t("cellEmpty");
      case "discipline":
        return s.discipline != null
          ? t("cellDiscipline", { score: s.discipline })
          : t("cellEmpty");
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (!focus) return;
    let { row, col } = focus;
    switch (e.key) {
      case "ArrowUp":
        row = Math.max(0, row - 1);
        break;
      case "ArrowDown":
        row = Math.min(6, row + 1);
        break;
      case "ArrowLeft":
        col = Math.max(0, col - 1);
        break;
      case "ArrowRight":
        col = Math.min(grid.cells[0].length - 1, col + 1);
        break;
      case "Enter":
      case " ": {
        const cell = grid.cells[focus.row][focus.col];
        if (cell.inYear) {
          e.preventDefault();
          navigate(`/journal/${cell.date}`);
        }
        return;
      }
      default:
        return;
    }
    e.preventDefault();
    setFocus({ row, col });
  };

  const fillOf = (cell: YearCell): { fill: string; opacity: number } => {
    const { tone, intensity } = cellTone(cell.stats, metric, scale);
    if (tone === "muted") return { fill: "var(--muted)", opacity: 0.35 };
    if (tone === "neutral") return { fill: "var(--muted-foreground)", opacity: 0.3 };
    const pct = Math.round(intensity * 100);
    return {
      fill: `color-mix(in oklab, var(--${tone}) ${pct}%, var(--card))`,
      opacity: 1,
    };
  };

  const years = React.useMemo(() => {
    const now = new Date().getFullYear();
    return Array.from({ length: 6 }, (_, i) => now - i);
  }, []);

  const width = LABEL_W + grid.cells[0].length * (CELL + GAP) + 8;
  const height = MONTH_LABEL_H + 7 * (CELL + GAP) + LEGEND_H;

  const focusCell = focus ? grid.cells[focus.row]?.[focus.col] : null;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">{t("title", { year })}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Select value={String(year)} onValueChange={(v) => onYearChange(Number(v))}>
            <SelectTrigger className="h-8 w-24" aria-label={t("yearLabel")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={metric} onValueChange={(v) => setMetric(v as YearMetric)}>
            <SelectTrigger className="h-8 w-40" aria-label={t("metricLabel")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METRICS.map((m) => (
                <SelectItem key={m.key} value={m.key}>
                  {t(m.labelKey as never)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setShowTable((v) => !v)}
            aria-pressed={showTable}
          >
            <Table2 aria-hidden="true" />
            <span className="hidden sm:inline">
              {showTable ? t("viewAsGrid") : t("viewAsTable")}
            </span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.isLoading ? (
          <Skeleton className="h-44 w-full" />
        ) : showTable ? (
          <YearTable grid={grid} formatDay={formatDay} t={t} locale={locale} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <svg
                viewBox={`0 0 ${width} ${height}`}
                width={Math.max(width, 320)}
                style={{ minWidth: "100%" }}
                role="img"
                aria-label={t("title", { year })}
                tabIndex={0}
                onKeyDown={onKeyDown}
                className="outline-none focus-visible:outline-2 focus-visible:outline-ring"
              >
                {/* Month labels (localized, first week of each month) */}
                {grid.monthLabelCols.map(({ col, month }) => (
                  <text
                    key={month}
                    x={LABEL_W + col * (CELL + GAP)}
                    y={11}
                    fontSize={10}
                    fill="var(--muted-foreground)"
                  >
                    {new Intl.DateTimeFormat(locale, { month: "short" }).format(
                      new Date(2025, month - 1, 1)
                    )}
                  </text>
                ))}
                {/* Weekday initials */}
                {[0, 1, 2, 3, 4, 5, 6].map((row) => {
                  const iso = ((weekStart + row - 1) % 7) + 1; // 1..7
                  const d = new Date(2024, 0, 7 + iso); // 2024-01-08 = Monday
                  return (
                    <text
                      key={row}
                      x={LABEL_W - 8}
                      y={MONTH_LABEL_H + row * (CELL + GAP) + CELL - 3}
                      textAnchor="end"
                      fontSize={9}
                      fill="var(--muted-foreground)"
                    >
                      {row % 2 === 0
                        ? new Intl.DateTimeFormat(locale, { weekday: "narrow" }).format(d)
                        : ""}
                    </text>
                  );
                })}
                {/* Cells */}
                {grid.cells.map((weekRow, row) =>
                  weekRow.map((cell, col) => {
                    const { fill, opacity } = fillOf(cell);
                    const isFocus = focus?.row === row && focus?.col === col;
                    return (
                      <rect
                        key={`${row}-${col}`}
                        x={LABEL_W + col * (CELL + GAP)}
                        y={MONTH_LABEL_H + row * (CELL + GAP)}
                        width={CELL}
                        height={CELL}
                        rx={2.5}
                        fill={fill}
                        fillOpacity={opacity}
                        stroke={isFocus ? "var(--ring)" : "transparent"}
                        strokeWidth={isFocus ? 1.5 : 0}
                        style={{
                          cursor: cell.inYear ? "pointer" : undefined,
                        }}
                        onMouseEnter={() => setFocus({ row, col })}
                        onClick={() => cell.inYear && navigate(`/journal/${cell.date}`)}
                      >
                        <title>
                          {cell.inYear
                            ? `${cell.date} - ${formatDay(cell)}`
                            : ""}
                        </title>
                      </rect>
                    );
                  })
                )}
                {/* Legend */}
                {(() => {
                  const y = MONTH_LABEL_H + 7 * (CELL + GAP) + 6;
                  const swatches =
                    scale.kind === "binary"
                      ? [{ fill: "color-mix(in oklab, var(--gain) 60%, var(--card))" }]
                      : scale.kind === "sequential"
                        ? [0, 1, 2, 3].map((i) => ({
                            fill: `color-mix(in oklab, var(--gain) ${25 + i * 25}%, var(--card))`,
                          }))
                        : [
                            { fill: `color-mix(in oklab, var(--loss) ${25 + 3 * 25}%, var(--card))` },
                            { fill: `color-mix(in oklab, var(--loss) 25%, var(--card))` },
                            { fill: `color-mix(in oklab, var(--gain) 25%, var(--card))` },
                            { fill: `color-mix(in oklab, var(--gain) ${25 + 3 * 25}%, var(--card))` },
                          ];
                  return (
                    <g>
                      <text x={LABEL_W - 8} y={y + 9} textAnchor="end" fontSize={9} fill="var(--muted-foreground)">
                        {t("less")}
                      </text>
                      {swatches.map((s, i) => (
                        <rect
                          key={i}
                          x={LABEL_W + i * (CELL + 2)}
                          y={y}
                          width={CELL}
                          height={CELL}
                          rx={2.5}
                          fill={s.fill}
                        />
                      ))}
                      <text
                        x={LABEL_W + swatches.length * (CELL + 2) + 4}
                        y={y + 9}
                        fontSize={9}
                        fill="var(--muted-foreground)"
                      >
                        {t("more")}
                      </text>
                    </g>
                  );
                })()}
              </svg>
            </div>
            {/* Focus info (accessible) */}
            <div className="min-h-5 text-xs text-muted-foreground" aria-live="polite">
              {focusCell?.inYear
                ? `${focusCell.date} - ${formatDay(focusCell)}`
                : t("hoverHint")}
            </div>
            <p className="text-xs text-muted-foreground">{t("clickHint")}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Table fallback ───────────────────────────────────────────────────────────

function YearTable({
  grid,
  formatDay,
  t,
  locale,
}: {
  grid: ReturnType<typeof buildYearGrid>;
  formatDay: (cell: YearCell) => string;
  t: (k: string, params?: Record<string, string | number>) => string;
  locale: string;
}) {
  const months = grid.monthLabelCols;
  const weeks = grid.cells[0].length;
  return (
    <div className="max-h-96 overflow-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted">
          <tr>
            <th className="px-2 py-2 text-left font-medium">{t("weekCol")}</th>
            {[0, 1, 2, 3, 4, 5, 6].map((row) => {
              const iso = ((grid.weekStart + row - 1) % 7) + 1;
              const d = new Date(2024, 0, 7 + iso);
              return (
                <th key={row} className="px-2 py-2 font-medium">
                  {new Intl.DateTimeFormat(locale, { weekday: "short" }).format(d)}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: weeks }, (_, w) => {
            const month = months.filter((m) => m.col <= w).slice(-1)[0]?.month;
            return (
              <tr key={w} className="border-t">
                <td className="px-2 py-1 text-muted-foreground">
                  {month
                    ? new Intl.DateTimeFormat(locale, { month: "short" }).format(
                        new Date(2025, month - 1, 1)
                      )
                    : ""}
                </td>
                {[0, 1, 2, 3, 4, 5, 6].map((row) => {
                  const cell = grid.cells[row][w];
                  return (
                    <td key={row} className="px-2 py-1 font-mono">
                      {cell.inYear ? formatDay(cell) : ""}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
