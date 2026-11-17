"use client";

/**
 * Monthly PDF report dialog - pick a month, download the report as a PDF
 * (jsPDF, built on the fly from /api/reports/monthly). Layout: header,
 * KPI block, mini equity curve, symbol + strategy tables, best/worst trades.
 */
import * as React from "react";
import { jsPDF } from "jspdf";
import { useTranslations } from "next-intl";
import { FileDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api-client";

interface MonthlyReportGroup {
  name: string;
  trades: number;
  wins: number;
  winRate: number | null;
  netPnl: string;
}

interface MonthlyReportTrade {
  symbol: string;
  direction: string;
  date: string;
  netPnl: string;
  rMultiple: string | null;
}

interface MonthlyReport {
  month: string;
  monthLabel: string;
  currency: string;
  tradeCount: number;
  netPnl: string | null;
  winRate: string | null;
  profitFactor: string | null;
  avgWin: string | null;
  avgLoss: string | null;
  totalR: string | null;
  maxDrawdown: string | null;
  equity: Array<{ date: string; cumPnl: string }>;
  bySymbol: MonthlyReportGroup[];
  byStrategy: MonthlyReportGroup[];
  bestTrades: MonthlyReportTrade[];
  worstTrades: MonthlyReportTrade[];
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function buildPdf(report: MonthlyReport, generatedLabel: string): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = 210;
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
  const bottom = 282;
  let y = 18;
  let page = 1;

  const money = new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: report.currency,
  });
  const moneyOf = (v: string | null) =>
    v == null ? "-" : money.format(Number(v));
  const pctOf = (v: string | null) =>
    v == null ? "-" : `${Number(v).toFixed(1)} %`;

  const footer = () => {
    doc.setFontSize(8);
    doc.setTextColor(130, 130, 130);
    doc.text(
      `Promethe - Rapport mensuel ${report.monthLabel}  ·  ${page}`,
      margin,
      290
    );
    doc.setTextColor(0, 0, 0);
  };

  const ensureSpace = (needed: number) => {
    if (y + needed > bottom) {
      footer();
      doc.addPage();
      page += 1;
      y = 18;
    }
  };

  const section = (title: string) => {
    ensureSpace(14);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(16, 185, 129);
    doc.text(title, margin, y);
    doc.setDrawColor(16, 185, 129);
    doc.line(margin, y + 2, margin + contentWidth, y + 2);
    doc.setTextColor(0, 0, 0);
    y += 9;
  };

  const kvRow = (label: string, value: string) => {
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(label, margin, y);
    doc.setFont("helvetica", "bold");
    doc.text(value, margin + contentWidth, y, { align: "right" });
    y += 6;
  };

  // ── Header ──
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(16, 185, 129);
  doc.text("Promethe", margin, y);
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(13);
  doc.text(`Rapport mensuel - ${report.monthLabel}`, margin, y + 8);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 100, 100);
  doc.text(generatedLabel, margin, y + 14);
  doc.setTextColor(0, 0, 0);
  y += 24;

  if (report.tradeCount === 0) {
    section("Aucun trade");
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("Aucun trade clôturé ce mois-ci.", margin, y);
    footer();
    doc.save(`promethe-rapport-${report.month}.pdf`);
    return;
  }

  // ── KPIs ──
  section("Chiffres clés");
  kvRow("Trades clôturés", String(report.tradeCount));
  kvRow("P&L net", moneyOf(report.netPnl));
  kvRow("Taux de réussite", pctOf(report.winRate));
  kvRow("Facteur de profit", report.profitFactor ?? "-");
  kvRow("Gain moyen", moneyOf(report.avgWin));
  kvRow("Perte moyenne", moneyOf(report.avgLoss));
  kvRow("R total", report.totalR ?? "-");
  kvRow("Drawdown max", moneyOf(report.maxDrawdown));
  y += 4;

  // ── Equity curve ──
  if (report.equity.length >= 2) {
    section("Courbe d'équité");
    const boxH = 42;
    ensureSpace(boxH + 4);
    const boxY = y;
    const values = report.equity.map((p) => Number(p.cumPnl));
    const min = Math.min(0, ...values);
    const max = Math.max(0, ...values);
    const span = max - min || 1;
    doc.setDrawColor(220, 220, 220);
    doc.rect(margin, boxY, contentWidth, boxH);
    // Zero line.
    const zeroY = boxY + boxH - ((0 - min) / span) * boxH;
    doc.setDrawColor(180, 180, 180);
    doc.line(margin, zeroY, margin + contentWidth, zeroY);
    doc.setDrawColor(16, 185, 129);
    doc.setLineWidth(0.6);
    report.equity.forEach((p, i) => {
      if (i === 0) return;
      const x1 =
        margin + ((i - 1) / (report.equity.length - 1)) * contentWidth;
      const x2 = margin + (i / (report.equity.length - 1)) * contentWidth;
      const y1 = boxY + boxH - ((values[i - 1] - min) / span) * boxH;
      const y2 = boxY + boxH - ((values[i] - min) / span) * boxH;
      doc.line(x1, y1, x2, y2);
    });
    doc.setLineWidth(0.2);
    y = boxY + boxH + 8;
  }

  // ── Tables ──
  const table = (
    title: string,
    headers: string[],
    widths: number[],
    rows: string[][]
  ) => {
    if (rows.length === 0) return;
    section(title);
    ensureSpace(8 + rows.length * 6);
    let x = margin;
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setFillColor(245, 245, 245);
    doc.rect(margin, y - 4, contentWidth, 7, "F");
    headers.forEach((h, i) => {
      doc.text(h, x, y);
      x += widths[i];
    });
    y += 7;
    doc.setFont("helvetica", "normal");
    rows.forEach((row) => {
      ensureSpace(6);
      let cx = margin;
      row.forEach((cell, i) => {
        doc.text(cell, cx, y);
        cx += widths[i];
      });
      y += 6;
    });
    y += 4;
  };

  table(
    "Par instrument",
    ["Symbole", "Trades", "Gagnants", "P&L net"],
    [60, 40, 40, 40],
    report.bySymbol.map((g) => [
      g.name,
      String(g.trades),
      String(g.wins),
      moneyOf(g.netPnl),
    ])
  );

  table(
    "Par stratégie",
    ["Stratégie", "Trades", "Réussite", "P&L net"],
    [70, 30, 40, 40],
    report.byStrategy.map((g) => [
      g.name,
      String(g.trades),
      g.winRate == null ? "-" : `${g.winRate.toFixed(1)} %`,
      moneyOf(g.netPnl),
    ])
  );

  const tradeRows = (trades: MonthlyReportTrade[]) =>
    trades.map((t) => [
      t.date,
      t.symbol,
      t.direction === "LONG" ? "Achat" : "Vente",
      moneyOf(t.netPnl),
    ]);
  table(
    "Meilleurs trades",
    ["Date", "Symbole", "Sens", "P&L net"],
    [45, 55, 40, 40],
    tradeRows(report.bestTrades)
  );
  table(
    "Pires trades",
    ["Date", "Symbole", "Sens", "P&L net"],
    [45, 55, 40, 40],
    tradeRows(report.worstTrades)
  );

  footer();
  doc.save(`promethe-rapport-${report.month}.pdf`);
}

export function MonthlyReportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("reports");
  const [month, setMonth] = React.useState(currentMonth);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const report = await apiFetch<MonthlyReport>(
        `/api/reports/monthly?month=${month}`
      );
      if (report.tradeCount === 0) {
        setError(t("empty"));
        return;
      }
      const generatedLabel = `${t("generatedOn")} ${new Intl.DateTimeFormat(
        "fr-FR",
        { dateStyle: "medium" }
      ).format(new Date())}`;
      buildPdf(report, generatedLabel);
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message || t("failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="report-month">{t("month")}</Label>
          <Input
            id="report-month"
            type="month"
            value={month}
            max={currentMonth()}
            onChange={(event) => setMonth(event.target.value)}
          />
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={generate} disabled={busy || !month}>
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <FileDown className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {busy ? t("generating") : t("generate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
