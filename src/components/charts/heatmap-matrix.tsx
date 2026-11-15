"use client";

/**
 * v2.5 Module 2 — cross-heatmap matrix (spec §4.4).
 *
 * Custom SVG (no chart library): diverging color scale centered on zero via
 * the semantic tokens (color-mix over var(--gain)/var(--loss) — never
 * hard-coded green/red), low-sample cells hatched, totals row/column, legend,
 * keyboard navigation (arrows move the focused cell, Enter drills down),
 * hover/focus tooltip with n + confidence hint, click-to-drill.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { cellColor, type MatrixResult } from "@/lib/charts/heatmap";
import type { XDimension } from "@/lib/validations/charts";
import type { MeasureFormatKind } from "./chart-preview";
import { formatCategoryKey } from "./chart-preview";
import { fmtNum } from "@/lib/format";

export interface HeatmapMatrixProps {
  result: MatrixResult;
  format: MeasureFormatKind;
  currency: string;
  locale: string;
  /** Drill-down handler — receives the dimension(s) to filter on. */
  onDrill?: (drills: Array<{ dimension: XDimension; value: string }>) => void;
  /** Localize bucket-ish keys. */
  tBucket: (k: string) => string;
}

const CELL = 34;
const ROW_LABEL_W = 110;
const COL_LABEL_H = 54;
const TOTAL_W = 74;
const GAP = 2;

export function HeatmapMatrix({
  result,
  format,
  currency,
  locale,
  onDrill,
  tBucket,
}: HeatmapMatrixProps) {
  const t = useTranslations("chartsBuilder.heatmap");
  const [focus, setFocus] = React.useState<{ r: number; c: number } | null>(null);

  const formatKey = React.useCallback(
    (dim: XDimension, key: string) =>
      formatCategoryKey(dim, key, locale, tBucket),
    [locale, tBucket]
  );

  const fmtVal = React.useCallback(
    (v: number | null) => {
      if (v == null) return "—";
      switch (format) {
        case "CURRENCY":
          return new Intl.NumberFormat(locale, {
            style: "currency",
            currency,
            maximumFractionDigits: 0,
          }).format(v);
        case "PERCENT":
          return `${fmtNum(v, 1)} %`;
        case "R":
          return `${fmtNum(v, 2)} R`;
        default:
          return fmtNum(v, 2);
      }
    },
    [format, currency, locale]
  );

  const nRows = result.rows.length;
  const nCols = result.colKeys.length;
  const gridW = nCols * (CELL + GAP);
  const width = ROW_LABEL_W + gridW + TOTAL_W;
  const height = COL_LABEL_H + nRows * (CELL + GAP) + CELL + 30; // + totals row + legend

  const cellFill = (value: number | null, lowSample: boolean): string => {
    const { token, intensity } = cellColor(value, result.maxAbs, lowSample);
    if (token === "neutral") return "var(--muted)";
    const pct = Math.round(intensity * 100);
    return `color-mix(in oklab, var(--${token}) ${pct}%, var(--card))`;
  };

  const onKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (!focus || nRows === 0 || nCols === 0) return;
    let { r, c } = focus;
    switch (e.key) {
      case "ArrowUp":
        r = Math.max(0, r - 1);
        break;
      case "ArrowDown":
        r = Math.min(nRows - 1, r + 1);
        break;
      case "ArrowLeft":
        c = Math.max(0, c - 1);
        break;
      case "ArrowRight":
        c = Math.min(nCols - 1, c + 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        drillAt(r, c);
        return;
      default:
        return;
    }
    e.preventDefault();
    setFocus({ r, c });
  };

  const drillAt = (r: number, c: number) => {
    if (!onDrill) return;
    const row = result.rows[r];
    if (!row) return;
    onDrill([
      { dimension: result.rowDim, value: row.key },
      { dimension: result.colDim, value: result.colKeys[c] ?? "" },
    ]);
  };

  const focusCell =
    focus && focus.r < nRows && focus.c < nCols
      ? result.rows[focus.r]?.cells[focus.c]
      : null;

  return (
    <div className="space-y-2">
      <div
        className="overflow-x-auto rounded-md border p-2"
        role="group"
        aria-label={t("ariaLabel")}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={Math.max(width, 320)}
          style={{ minWidth: "100%", maxWidth: "100%" }}
          role="img"
          aria-label={t("ariaLabel")}
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="outline-none focus-visible:outline-2 focus-visible:outline-ring"
        >
          <defs>
            {/* Hatching for low-sample cells — redundant non-color cue. */}
            <pattern
              id="tj-low-sample"
              patternUnits="userSpaceOnUse"
              width="6"
              height="6"
              patternTransform="rotate(45)"
            >
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--muted-foreground)" strokeWidth="1.2" opacity="0.5" />
            </pattern>
          </defs>

          {/* Column labels (rotated when narrow) */}
          {result.colKeys.map((ck, ci) => {
            const x = ROW_LABEL_W + ci * (CELL + GAP) + CELL / 2;
            const label = formatKey(result.colDim, ck);
            return (
              <text
                key={ck}
                x={x}
                y={COL_LABEL_H - 8}
                textAnchor="end"
                fontSize={10}
                fill="var(--muted-foreground)"
                transform={`rotate(-60 ${x} ${COL_LABEL_H - 8})`}
              >
                {label.length > 14 ? `${label.slice(0, 13)}…` : label}
              </text>
            );
          })}

          {/* Rows */}
          {result.rows.map((row, ri) => {
            const y = COL_LABEL_H + ri * (CELL + GAP);
            return (
              <g key={row.key}>
                <text
                  x={ROW_LABEL_W - 8}
                  y={y + CELL / 2 + 3}
                  textAnchor="end"
                  fontSize={11}
                  fill="var(--foreground)"
                >
                  {formatKey(result.rowDim, row.key).slice(0, 16)}
                </text>
                {row.cells.map((cell, ci) => {
                  const x = ROW_LABEL_W + ci * (CELL + GAP);
                  const isFocus = focus?.r === ri && focus?.c === ci;
                  const hasData = cell.n > 0;
                  return (
                    <g key={cell.colKey}>
                      <rect
                        x={x}
                        y={y}
                        width={CELL}
                        height={CELL}
                        rx={3}
                        fill={hasData ? cellFill(cell.value, cell.lowSample) : "var(--muted)"}
                        fillOpacity={hasData ? (cell.lowSample ? 0.35 : 1) : 0.3}
                        stroke={isFocus ? "var(--ring)" : "var(--border)"}
                        strokeWidth={isFocus ? 2 : 0.5}
                        style={{ cursor: onDrill && hasData ? "pointer" : undefined }}
                        onMouseEnter={() => setFocus({ r: ri, c: ci })}
                        onClick={() => onDrill && hasData && drillAt(ri, ci)}
                      >
                        <title>
                          {`${formatKey(result.rowDim, row.key)} × ${formatKey(result.colDim, cell.colKey)} — ${fmtVal(cell.value)} (n=${cell.n})`}
                        </title>
                      </rect>
                      {cell.lowSample && hasData && (
                        <rect
                          x={x}
                          y={y}
                          width={CELL}
                          height={CELL}
                          rx={3}
                          fill="url(#tj-low-sample)"
                          pointerEvents="none"
                        />
                      )}
                      {/* Value text (redundant non-color cue when space permits) */}
                      {hasData && !cell.lowSample && cell.value != null && (
                        <text
                          x={x + CELL / 2}
                          y={y + CELL / 2 + 3}
                          textAnchor="middle"
                          fontSize={9}
                          fontWeight={500}
                          fill="var(--card-foreground)"
                          pointerEvents="none"
                          style={{ mixBlendMode: "normal" }}
                        >
                          {Math.abs(cell.value) >= 1000
                            ? fmtNum(cell.value, 0)
                            : fmtNum(cell.value, 1)}
                        </text>
                      )}
                    </g>
                  );
                })}
                {/* Row total */}
                <rect
                  x={ROW_LABEL_W + nCols * (CELL + GAP)}
                  y={y}
                  width={TOTAL_W - 10}
                  height={CELL}
                  rx={3}
                  fill="var(--secondary)"
                />
                <text
                  x={ROW_LABEL_W + nCols * (CELL + GAP) + (TOTAL_W - 10) / 2}
                  y={y + CELL / 2 + 3}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--foreground)"
                >
                  {fmtVal(row.total)}{" "}
                  <tspan fill="var(--muted-foreground)" fontSize={9}>
                    ({row.totalN})
                  </tspan>
                </text>
              </g>
            );
          })}

          {/* Totals row */}
          {(() => {
            const y = COL_LABEL_H + nRows * (CELL + GAP);
            return (
              <g>
                <text
                  x={ROW_LABEL_W - 8}
                  y={y + CELL / 2 + 3}
                  textAnchor="end"
                  fontSize={10}
                  fontWeight={600}
                  fill="var(--muted-foreground)"
                >
                  {t("total")}
                </text>
                {result.colKeys.map((ck, ci) => {
                  const x = ROW_LABEL_W + ci * (CELL + GAP);
                  return (
                    <g key={ck}>
                      <rect
                        x={x}
                        y={y}
                        width={CELL}
                        height={CELL}
                        rx={3}
                        fill="var(--secondary)"
                      />
                      <text
                        x={x + CELL / 2}
                        y={y + CELL / 2 + 3}
                        textAnchor="middle"
                        fontSize={8}
                        fill="var(--foreground)"
                      >
                        {result.colTotalsN[ci] > 0
                          ? fmtNum(result.colTotals[ci] ?? 0, 0)
                          : "—"}
                      </text>
                    </g>
                  );
                })}
                <rect
                  x={ROW_LABEL_W + nCols * (CELL + GAP)}
                  y={y}
                  width={TOTAL_W - 10}
                  height={CELL}
                  rx={3}
                  fill="var(--accent)"
                />
                <text
                  x={ROW_LABEL_W + nCols * (CELL + GAP) + (TOTAL_W - 10) / 2}
                  y={y + CELL / 2 + 3}
                  textAnchor="middle"
                  fontSize={9}
                  fontWeight={600}
                  fill="var(--foreground)"
                >
                  {fmtVal(result.grand.value)} ({result.grand.n})
                </text>
              </g>
            );
          })()}

          {/* Legend */}
          <g transform={`translate(${ROW_LABEL_W}, ${height - 16})`}>
            <text x={-8} y={4} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">
              {t("legend")}
            </text>
            {["0%", "25%", "50%", "75%", "100%"].map((pct, i) => {
              const intensity = i / 4;
              return (
                <rect
                  key={pct}
                  x={i * 40}
                  y={-7}
                  width={40}
                  height={14}
                  fill={`color-mix(in oklab, var(--gain) ${Math.round((0.25 + 0.75 * intensity) * 100)}%, var(--card))`}
                />
              );
            })}
            {["0%", "25%", "50%", "75%", "100%"].map((pct, i) => {
              const intensity = 1 - i / 4;
              return (
                <rect
                  key={`n${pct}`}
                  x={210 + i * 40}
                  y={-7}
                  width={40}
                  height={14}
                  fill={`color-mix(in oklab, var(--loss) ${Math.round((0.25 + 0.75 * intensity) * 100)}%, var(--card))`}
                />
              );
            })}
            <text x={-2} y={22} fontSize={9} fill="var(--muted-foreground)">
              {t("legendGain")}
            </text>
            <text x={212} y={22} fontSize={9} fill="var(--muted-foreground)">
              {t("legendLoss")}
            </text>
            <rect x={430} y={-7} width={18} height={14} fill="var(--muted)" fillOpacity={0.35} />
            <rect x={430} y={-7} width={18} height={14} fill="url(#tj-low-sample)" />
            <text x={452} y={4} fontSize={9} fill="var(--muted-foreground)">
              {t("legendLowSample")}
            </text>
          </g>
        </svg>
      </div>

      {/* Focus/hover tooltip info (accessible text) */}
      <div className="min-h-6 text-xs text-muted-foreground" aria-live="polite">
        {focusCell ? (
          <>
            <span className="font-medium text-foreground">
              {formatKey(result.rowDim, focusCell.rowKey)} ×{" "}
              {formatKey(result.colDim, focusCell.colKey)}:
            </span>{" "}
            {fmtVal(focusCell.value)} — {t("nTrades", { count: focusCell.n })}
            {focusCell.n > 0 && (
              <>
                {" "}
                · {t("winsLosses", {
                  wins: focusCell.wins,
                  losses: focusCell.losses,
                })}
              </>
            )}
            {focusCell.n > 0 && focusCell.n < 30 && (
              <>
                {" "}
                · <span className="italic">{t("confidenceHint")}</span>
              </>
            )}
            {focusCell.lowSample && focusCell.n > 0 && (
              <>
                {" "}
                · <span className="italic">{t("lowSampleHint")}</span>
              </>
            )}
          </>
        ) : (
          t("hoverHint")
        )}
      </div>
    </div>
  );
}
