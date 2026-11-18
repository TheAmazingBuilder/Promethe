/**
 * Performance report PDF (MRT wave 3, work item 3) — new layout on the
 * shared ReportPdf primitives (src/lib/reports/pdf.ts), the same
 * generator as the monthly report. The view passes the already-loaded
 * report payload, the live weekly plan actions (with their Done states)
 * and translated labels; nothing is recomputed here.
 */
import { ReportPdf } from "./pdf";
import type { PerformanceReportPayload } from "@/lib/trading/dto";
import type { PlanAction } from "@/lib/analytics/weekly-plan";

export interface PerformancePdfLabels {
  title: string;
  verdict: string;
  verdictYes: string;
  verdictNo: string;
  verdictNotYet: string;
  expectancy: string;
  sample: string;
  sqn: string;
  glance: string;
  netPnl: string;
  trades: string;
  winRate: string;
  profitFactor: string;
  planFollowed: string;
  discipline: string;
  weekly: string;
  week: string;
  edgeSources: string;
  source: string;
  sourceSession: string;
  sourceSetup: string;
  sourceConfluence: string;
  costs: string;
  costsEmpty: string;
  recommendations: string;
  target: string;
  nextWeek: string;
  nextWeekEmpty: string;
}

function fmtR(value: number | null): string {
  if (value == null) return "-";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}R`;
}

function fmtPct(value: number | null): string {
  return value == null ? "-" : `${value.toFixed(1)} %`;
}

function fmtDay(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function buildPerformancePdf(
  payload: PerformanceReportPayload,
  periodLabel: string,
  coverageLine: string,
  generatedLabel: string,
  nextWeekActions: PlanAction[],
  labels: PerformancePdfLabels
): void {
  const { report } = payload;
  const pdf = new ReportPdf(payload.currency);
  const footerLabel = `Performance report ${periodLabel}`;

  pdf.header(`${labels.title} – ${periodLabel}`, generatedLabel);
  pdf.metaLine(coverageLine);

  // ── Verdict (same engine as the weekly plan) ──
  pdf.section(labels.verdict, footerLabel);
  const verdictWord =
    report.edge.verdict === "yes"
      ? labels.verdictYes
      : report.edge.verdict === "no"
        ? labels.verdictNo
        : labels.verdictNotYet;
  pdf.kvRow(labels.verdict, verdictWord);
  pdf.paragraph(report.edge.reason, footerLabel);
  pdf.kvRow(
    labels.expectancy,
    fmtR(report.edge.expectancyR)
  );
  pdf.kvRow(labels.sample, String(report.edge.sampleSize));
  pdf.kvRow(
    labels.sqn,
    report.edge.sqn != null ? report.edge.sqn.toFixed(2) : "-"
  );
  pdf.y += 4;

  // ── Week at a glance ──
  pdf.section(labels.glance, footerLabel);
  pdf.kvRow(labels.netPnl, pdf.moneyOf(report.atAGlance.netPnl));
  pdf.kvRow(labels.trades, String(report.atAGlance.trades));
  pdf.kvRow(labels.winRate, pdf.pctOf(report.atAGlance.winRate));
  pdf.kvRow(labels.profitFactor, report.atAGlance.profitFactor ?? "-");
  pdf.kvRow(
    labels.expectancy,
    report.atAGlance.expectancyR != null
      ? fmtR(Number(report.atAGlance.expectancyR))
      : "-"
  );
  pdf.kvRow(
    labels.planFollowed,
    report.atAGlance.planFollowedPct != null
      ? `${report.atAGlance.planFollowedPct.toFixed(1)} %`
      : "-"
  );
  pdf.kvRow(
    labels.discipline,
    `${report.atAGlance.disciplineScore} / 100`
  );
  pdf.y += 4;

  // ── P&L by week ──
  pdf.table(
    labels.weekly,
    [labels.week, labels.trades, labels.winRate, labels.netPnl],
    [70, 30, 40, 40],
    report.weeklyPnl.map((w) => [
      `${fmtDay(w.weekStart)} – ${fmtDay(w.weekEnd)}`,
      String(w.trades),
      fmtPct(w.winRate),
      pdf.moneyOf(w.netPnl),
    ]),
    footerLabel
  );

  // ── Where the edge comes from ──
  const kindLabel = (kind: string): string =>
    kind === "session"
      ? labels.sourceSession
      : kind === "setup"
        ? labels.sourceSetup
        : labels.sourceConfluence;
  pdf.table(
    labels.edgeSources,
    [
      labels.source,
      labels.trades,
      labels.winRate,
      labels.expectancy,
      labels.netPnl,
    ],
    [55, 25, 30, 35, 35],
    report.edgeSources.map((s) => [
      `${kindLabel(s.kind)}: ${s.name}`,
      String(s.trades),
      fmtPct(s.winRate),
      fmtR(s.expectancyR),
      pdf.moneyOf(s.netPnl),
    ]),
    footerLabel
  );

  // ── What costs ──
  pdf.section(labels.costs, footerLabel);
  if (report.costs.length === 0) {
    pdf.paragraph(labels.costsEmpty, footerLabel);
  } else {
    for (const cost of report.costs) pdf.bullet(cost, footerLabel);
  }
  pdf.y += 2;

  // ── Recommendations (top three actions of the period's plan) ──
  pdf.section(labels.recommendations, footerLabel);
  for (const action of report.recommendations) {
    pdf.bullet(
      `${action.rank}. ${action.title} - ${action.evidence.label}: ` +
        `${pdf.moneyOf(action.evidence.netPnl)}${action.evidence.suffix ?? ""}. ` +
        `${labels.target}: ${action.target}`,
      footerLabel
    );
  }
  pdf.y += 2;

  // ── Next week (live weekly plan, with Done states) ──
  pdf.section(labels.nextWeek, footerLabel);
  if (nextWeekActions.length === 0) {
    pdf.paragraph(labels.nextWeekEmpty, footerLabel);
  } else {
    for (const action of nextWeekActions) {
      pdf.bullet(
        `[${action.done ? "x" : " "}] ${action.title} - ${labels.target}: ${action.target}`,
        footerLabel
      );
    }
  }

  pdf.footer(footerLabel);
  pdf.save(`promethe-performance-report-${payload.period}.pdf`);
}
