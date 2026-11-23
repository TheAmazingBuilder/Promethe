import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { journalExportQuerySchema } from "@/lib/validations/journal";
import { zodFieldErrors } from "@/lib/validations/shared";
import { getJournalExportData } from "@/server/journal";
import { ReportPdf } from "@/lib/reports/pdf";

export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const url = new URL(req.url);
    const parsed = journalExportQuerySchema.safeParse(
      Object.fromEntries(url.searchParams.entries()),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Choose a valid Journal export date range (maximum 367 days).", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 },
      );
    }

    const { from, to } = parsed.data;
    const data = await getJournalExportData(session.user.id, from, to);
    const pdf = await ReportPdf.create(data.currency);
    const footer = "Journal export";
    pdf.header("Trading Journal", `Daily reflections · ${from} to ${to}`);
    pdf.metaLine(`${data.entries.length} daily entries · ${data.periodReviews.length} period reviews`);

    if (data.entries.length === 0 && data.periodReviews.length === 0) {
      pdf.paragraph("No Journal reflections were saved in this date range.", footer);
    }

    for (const entry of data.entries) {
      pdf.section(`Daily entry · ${entry.date}`, footer);
      const scores = [
        entry.mood != null ? `Mood ${entry.mood}/5` : null,
        entry.sleepQuality != null ? `Sleep ${entry.sleepQuality}/5` : null,
        entry.disciplineScore != null ? `Discipline ${entry.disciplineScore}/5` : null,
        entry.stressLevel != null ? `Stress ${entry.stressLevel}/5` : null,
        entry.energyLevel != null ? `Energy ${entry.energyLevel}/5` : null,
        entry.focusLevel != null ? `Focus ${entry.focusLevel}/5` : null,
      ].filter(Boolean).join(" · ");
      if (scores) pdf.paragraph(scores, footer);
      if (entry.marketBias) pdf.paragraph(`Market bias: ${entry.marketBias}`, footer);
      if (entry.preMarketPlan) pdf.paragraph(`Pre-market plan: ${entry.preMarketPlan}`, footer);
      if (entry.keyLevels) pdf.paragraph(`Key levels: ${entry.keyLevels}`, footer);
      if (entry.primaryScenario) pdf.paragraph(`Primary scenario: ${entry.primaryScenario}`, footer);
      if (entry.alternateScenario) pdf.paragraph(`Alternative scenario: ${entry.alternateScenario}`, footer);
      if (entry.invalidationConditions) pdf.paragraph(`Invalidation conditions: ${entry.invalidationConditions}`, footer);
      if (entry.maxRiskPercent) pdf.paragraph(`Maximum planned risk: ${entry.maxRiskPercent}%`, footer);
      if (entry.postMarketReview) pdf.paragraph(`Post-market review: ${entry.postMarketReview}`, footer);
      if (entry.keyLesson) pdf.paragraph(`Key lesson: ${entry.keyLesson}`, footer);
      if (entry.nextSessionCommitment) pdf.paragraph(`Next-session commitment: ${entry.nextSessionCommitment}`, footer);
    }

    for (const review of data.periodReviews) {
      pdf.section(`${review.periodType} review · ${review.periodStart} to ${review.periodEnd}`, footer);
      if (review.whatWentWell) pdf.paragraph(`What went well: ${review.whatWentWell}`, footer);
      if (review.whatToImprove) pdf.paragraph(`What to improve: ${review.whatToImprove}`, footer);
      if (review.keyLesson) pdf.paragraph(`Key lesson: ${review.keyLesson}`, footer);
      if (review.nextCommitment) pdf.paragraph(`Next commitment: ${review.nextCommitment}`, footer);
    }

    pdf.footer(footer);
    const filename = `promethe-journal-${from}-to-${to}.pdf`;
    return new NextResponse(pdf.doc.output("arraybuffer"), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return apiError(error, "journal/export");
  }
}
