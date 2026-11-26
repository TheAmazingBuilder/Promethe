"use client";

/**
 * Monthly PDF report dialog - pick a month, download the report as a PDF
 * (jsPDF, built on the fly from /api/v1/reports/monthly). Layout: header,
 * KPI block, mini equity curve, symbol + strategy tables, best/worst trades.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { FileDown, Loader2 } from "lucide-react";
import { ReportPdf } from "@/lib/reports/pdf";
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
  accountId: string | null;
  excludedTradeCount: number;
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

async function buildPdf(
  report: MonthlyReport,
  generatedLabel: string
): Promise<void> {
  const pdf = await ReportPdf.create(report.currency);
  const footerLabel = `Monthly report ${report.monthLabel}`;

  pdf.header(`Monthly report – ${report.monthLabel}`, generatedLabel);
  if (report.excludedTradeCount > 0 && report.tradeCount > 0) {
    pdf.paragraph(
      `${report.excludedTradeCount} trades in other currencies were excluded. Figures below use ${report.currency} only.`,
      footerLabel
    );
  }

  if (report.tradeCount === 0) {
    pdf.section("No trades", footerLabel);
    pdf.paragraph(
      report.excludedTradeCount > 0
        ? `No trades in ${report.currency} this month. ${report.excludedTradeCount} trades in other currencies were excluded.`
        : "No trades closed this month.",
      footerLabel
    );
    pdf.footer(footerLabel);
    pdf.save(`promethe-report-${report.month}.pdf`);
    return;
  }

  // ── KPIs ──
  pdf.section("Key figures", footerLabel);
  pdf.kvRow("Closed trades", String(report.tradeCount));
  pdf.kvRow("Net P&L", pdf.moneyOf(report.netPnl));
  pdf.kvRow("Win rate", pdf.pctOf(report.winRate));
  pdf.kvRow("Profit factor", report.profitFactor ?? "-");
  pdf.kvRow("Average win", pdf.moneyOf(report.avgWin));
  pdf.kvRow("Average loss", pdf.moneyOf(report.avgLoss));
  pdf.kvRow("Total R", report.totalR ?? "-");
  pdf.kvRow("Max P&L drawdown", pdf.moneyOf(report.maxDrawdown));
  pdf.y += 4;

  // ── Cumulative P&L curve (not an equity curve: no cash flows, no open positions) ──
  pdf.equityChart(report.equity, footerLabel);

  // ── Tables ──
  pdf.table(
    "By instrument",
    ["Symbol", "Trades", "Winners", "Net P&L"],
    [60, 40, 40, 40],
    report.bySymbol.map((g) => [
      g.name,
      String(g.trades),
      String(g.wins),
      pdf.moneyOf(g.netPnl),
    ]),
    footerLabel
  );

  pdf.table(
    "By strategy",
    ["Strategy", "Trades", "Win rate", "Net P&L"],
    [70, 30, 40, 40],
    report.byStrategy.map((g) => [
      g.name,
      String(g.trades),
      g.winRate == null ? "-" : `${g.winRate.toFixed(1)} %`,
      pdf.moneyOf(g.netPnl),
    ]),
    footerLabel
  );

  const tradeRows = (trades: MonthlyReportTrade[]) =>
    trades.map((t) => [
      t.date,
      t.symbol,
      t.direction === "LONG" ? "Buy" : "Sell",
      pdf.moneyOf(t.netPnl),
    ]);
  pdf.table(
    "Best trades",
    ["Date", "Symbol", "Side", "Net P&L"],
    [45, 55, 40, 40],
    tradeRows(report.bestTrades),
    footerLabel
  );
  pdf.table(
    "Worst trades",
    ["Date", "Symbol", "Side", "Net P&L"],
    [45, 55, 40, 40],
    tradeRows(report.worstTrades),
    footerLabel
  );

  pdf.footer(footerLabel);
  pdf.save(`promethe-report-${report.month}.pdf`);
}

export function MonthlyReportDialog({
  open,
  onOpenChange,
  accountId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId?: string;
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
        `/api/v1/reports/monthly?month=${month}${accountId ? `&account=${encodeURIComponent(accountId)}` : ""}`
      );
      if (report.tradeCount === 0 && report.excludedTradeCount === 0) {
        setError(t("empty"));
        return;
      }
      const generatedLabel = `${t("generatedOn")} ${new Intl.DateTimeFormat(
        "en-CA",
        { dateStyle: "medium" }
      ).format(new Date())}`;
      await buildPdf(report, generatedLabel);
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
