import { describe, expect, it } from "vitest";
import { ReportPdf } from "@/lib/reports/pdf";
import type { jsPDF } from "jspdf";

class FakeJsPDF {
  pages = 1;
  written: string[] = [];

  setFontSize() {}
  setFont() {}
  setTextColor() {}
  text(value: string) {
    this.written.push(value);
  }
  splitTextToSize() {
    return Array.from({ length: 60 }, (_, index) => `Long journal line ${index + 1}`);
  }
  addPage() {
    this.pages += 1;
  }
}

describe("ReportPdf paragraph pagination", () => {
  it("continues a long paragraph over multiple pages without dropping lines", () => {
    const pdf = new ReportPdf("USD", FakeJsPDF as unknown as typeof jsPDF);

    pdf.paragraph("A long journal reflection", "Journal export");
    // The export caller writes the final page footer after all content.
    pdf.footer("Journal export");

    const doc = pdf.doc as unknown as FakeJsPDF;
    expect(doc.pages).toBeGreaterThan(1);
    expect(doc.written.filter((line) => line.startsWith("Long journal line "))).toHaveLength(60);
    expect(doc.written).toContain("Promethe – Journal export  ·  1");
    expect(doc.written).toContain("Promethe – Journal export  ·  2");
  });
});
