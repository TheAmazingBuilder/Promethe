/**
 * Shared jsPDF primitives for the Promethe report exports.
 *
 * Extracted from the monthly report dialog (src/components/reports/
 * monthly-report-dialog.tsx) so every PDF export — monthly report and
 * performance report — shares one layout engine: same A4 page, margins,
 * section headings, key/value rows, tables and equity chart. The monthly
 * PDF output is unchanged; the performance report builds a new layout
 * on top of these helpers instead of duplicating the generator.
 *
 * Money formatting here is export-by-design (the user explicitly
 * downloads their own data), formatted with Intl like the monthly
 * dialog before it. The money-formatting ratchet test scans line by
 * line: keep the `currency:` option on its own line, never on the same
 * line as `Intl.NumberFormat(`.
 *
 * jsPDF is loaded lazily (ReportPdf.create): the library is ~327 Ko
 * parsed and only used when a PDF is actually exported, so it must
 * never be a static import of this module.
 */
import type { jsPDF } from "jspdf";

export interface EquityPoint {
  date: string;
  cumPnl: string;
}

const EMERALD: [number, number, number] = [16, 185, 129];

export class ReportPdf {
  readonly doc: jsPDF;
  readonly margin = 15;
  readonly contentWidth = 180;
  readonly bottom = 282;
  y = 18;
  page = 1;
  private readonly moneyFmt: Intl.NumberFormat;

  constructor(currency: string, JsPDFCtor: typeof jsPDF) {
    this.doc = new JsPDFCtor({ unit: "mm", format: "a4" });
    this.moneyFmt = new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
    });
  }

  /**
   * Loads jspdf on demand (dynamic import) and returns a ready ReportPdf.
   * The only way to build one - the constructor stays private to the
   * factory so no caller can reintroduce a static jspdf import.
   */
  static async create(currency: string): Promise<ReportPdf> {
    const { jsPDF: JsPDFCtor } = await import("jspdf");
    return new ReportPdf(currency, JsPDFCtor);
  }

  moneyOf(value: string | null): string {
    return value == null ? "-" : this.moneyFmt.format(Number(value));
  }

  pctOf(value: string | null): string {
    return value == null ? "-" : `${Number(value).toFixed(1)} %`;
  }

  /** Footer of the current page: "Promethe – <label> · <page>". */
  footer(label: string): void {
    this.doc.setFontSize(8);
    this.doc.setTextColor(130, 130, 130);
    this.doc.text(`Promethe – ${label}  ·  ${this.page}`, this.margin, 290);
    this.doc.setTextColor(0, 0, 0);
  }

  ensureSpace(needed: number, footerLabel: string): void {
    if (this.y + needed > this.bottom) {
      this.footer(footerLabel);
      this.doc.addPage();
      this.page += 1;
      this.y = 18;
    }
  }

  /** Header: emerald brand, report title, small grey line under it. */
  header(title: string, metaLine: string): void {
    this.doc.setFontSize(18);
    this.doc.setFont("helvetica", "bold");
    this.doc.setTextColor(...EMERALD);
    this.doc.text("Promethe", this.margin, this.y);
    this.doc.setTextColor(0, 0, 0);
    this.doc.setFontSize(13);
    this.doc.text(title, this.margin, this.y + 8);
    this.doc.setFontSize(9);
    this.doc.setFont("helvetica", "normal");
    this.doc.setTextColor(100, 100, 100);
    this.doc.text(metaLine, this.margin, this.y + 14);
    this.doc.setTextColor(0, 0, 0);
    this.y += 24;
  }

  /** Second header line under the title (coverage, generated date). */
  metaLine(text: string): void {
    this.doc.setFontSize(9);
    this.doc.setFont("helvetica", "normal");
    this.doc.setTextColor(100, 100, 100);
    this.doc.text(text, this.margin, this.y);
    this.doc.setTextColor(0, 0, 0);
    this.y += 7;
  }

  section(title: string, footerLabel: string): void {
    this.ensureSpace(14, footerLabel);
    this.doc.setFontSize(12);
    this.doc.setFont("helvetica", "bold");
    this.doc.setTextColor(...EMERALD);
    this.doc.text(title, this.margin, this.y);
    this.doc.setDrawColor(...EMERALD);
    this.doc.line(
      this.margin,
      this.y + 2,
      this.margin + this.contentWidth,
      this.y + 2
    );
    this.doc.setTextColor(0, 0, 0);
    this.y += 9;
  }

  kvRow(label: string, value: string): void {
    this.doc.setFontSize(10);
    this.doc.setFont("helvetica", "normal");
    this.doc.text(label, this.margin, this.y);
    this.doc.setFont("helvetica", "bold");
    this.doc.text(value, this.margin + this.contentWidth, this.y, {
      align: "right",
    });
    this.y += 6;
  }

  /** Wrapped paragraph, split on the content width. */
  paragraph(text: string, footerLabel: string): void {
    this.doc.setFontSize(10);
    this.doc.setFont("helvetica", "normal");
    const lines = this.doc.splitTextToSize(text, this.contentWidth);
    for (const line of lines) {
      // A paragraph may span several pages. Check space per line so long
      // Journal reflections cannot overflow past the page footer.
      this.ensureSpace(7, footerLabel);
      this.doc.text(line, this.margin, this.y);
      this.y += 5;
    }
    this.y += 2;
  }

  /** Wrapped bullet line ("• text"). */
  bullet(text: string, footerLabel: string): void {
    this.doc.setFontSize(10);
    this.doc.setFont("helvetica", "normal");
    const lines = this.doc.splitTextToSize(text, this.contentWidth - 5) as string[];
    this.ensureSpace(lines.length * 5 + 2, footerLabel);
    lines.forEach((line, i) => {
      this.doc.text(i === 0 ? "•  " : "    ", this.margin, this.y);
      this.doc.text(line, this.margin + 5, this.y);
      this.y += 5;
    });
    this.y += 1;
  }

  table(
    title: string,
    headers: string[],
    widths: number[],
    rows: string[][],
    footerLabel: string
  ): void {
    if (rows.length === 0) return;
    this.section(title, footerLabel);
    this.ensureSpace(8 + rows.length * 6, footerLabel);
    let x = this.margin;
    this.doc.setFontSize(9);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFillColor(245, 245, 245);
    this.doc.rect(this.margin, this.y - 4, this.contentWidth, 7, "F");
    headers.forEach((h, i) => {
      this.doc.text(h, x, this.y);
      x += widths[i];
    });
    this.y += 7;
    this.doc.setFont("helvetica", "normal");
    rows.forEach((row) => {
      this.ensureSpace(6, footerLabel);
      let cx = this.margin;
      row.forEach((cell, i) => {
        this.doc.text(cell, cx, this.y);
        cx += widths[i];
      });
      this.y += 6;
    });
    this.y += 4;
  }

  /** Mini cumulative P&L curve (not an equity curve: the points plot cumPnl, see below). */
  equityChart(points: EquityPoint[], footerLabel: string): void {
    if (points.length < 2) return;
    this.section("Cumulative P&L curve", footerLabel);
    const boxH = 42;
    this.ensureSpace(boxH + 4, footerLabel);
    const boxY = this.y;
    const values = points.map((p) => Number(p.cumPnl));
    const min = Math.min(0, ...values);
    const max = Math.max(0, ...values);
    const span = max - min || 1;
    this.doc.setDrawColor(220, 220, 220);
    this.doc.rect(this.margin, boxY, this.contentWidth, boxH);
    // Zero line.
    const zeroY = boxY + boxH - ((0 - min) / span) * boxH;
    this.doc.setDrawColor(180, 180, 180);
    this.doc.line(this.margin, zeroY, this.margin + this.contentWidth, zeroY);
    this.doc.setDrawColor(...EMERALD);
    this.doc.setLineWidth(0.6);
    points.forEach((p, i) => {
      if (i === 0) return;
      const x1 =
        this.margin + ((i - 1) / (points.length - 1)) * this.contentWidth;
      const x2 = this.margin + (i / (points.length - 1)) * this.contentWidth;
      const y1 = boxY + boxH - ((values[i - 1] - min) / span) * boxH;
      const y2 = boxY + boxH - ((values[i] - min) / span) * boxH;
      this.doc.line(x1, y1, x2, y2);
    });
    this.doc.setLineWidth(0.2);
    this.y = boxY + boxH + 8;
  }

  save(filename: string): void {
    this.doc.save(filename);
  }
}
