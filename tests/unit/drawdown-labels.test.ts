/**
 * Lot 1 (MD §3.4) — drawdown / curve labels stay honest.
 *
 * Every surface that renders the cumulative-trade-P&L measure must call
 * it a P&L drawdown / cumulative P&L curve, never an equity drawdown or
 * equity curve: the underlying series excludes deposits, withdrawals
 * and open positions (see src/lib/analytics/engine.ts). The Analytics
 * view already carried the honest hint; this pins the other surfaces
 * (dashboard KPI strip, quality view, monthly PDF copy lives in code,
 * public share page, annotations) plus the scope boundary: prop-firm
 * challenge limits are real limits, not P&L measures, and keep their
 * plain "Max drawdown" wording.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const messages = JSON.parse(
  readFileSync(new URL("../../messages/en.json", import.meta.url), "utf8")
) as Record<string, any>;

describe("drawdown labels (MD §3.4)", () => {
  it("calls the P&L-based drawdown 'Max P&L drawdown' on every stats surface", () => {
    expect(messages.dashboard.kpiMaxDrawdown).toBe("Max P&L drawdown");
    expect(messages.dashboard.kpiMaxDrawdownPct).toBe("Max P&L drawdown (%)");
    expect(messages.analytics.kpiMaxDrawdown).toBe("Max P&L drawdown");
    expect(messages.dashboards.kpi.maxDrawdown).toBe("Max P&L drawdown");
    expect(messages.dashboards.kpi.currentDrawdown).toBe("Current P&L drawdown");
    expect(messages.analytics.advanced.quality.detailDrawdown).toBe("Max P&L drawdown");
    expect(messages.publicShare.report.maxDrawdown).toBe("Max P&L drawdown");
    expect(messages.chartsBuilder.annotations.sMaxDd).toBe("Max P&L drawdown");
  });

  it("calls the curve 'Cumulative P&L curve' wherever the P&L series is plotted", () => {
    expect(messages.dashboard.equityTitle).toBe("Cumulative P&L curve");
    expect(messages.analytics.equityTitle).toBe("Cumulative P&L curve");
    expect(messages.dashboards.registry.equityCurve).toBe("Cumulative P&L curve");
    expect(messages.dashboards.registry.equityCurveDesc).toBe(
      "Initial balance plus cumulative trade P&L."
    );
  });

  it("keeps the Analytics qualification sentence as the canonical wording", () => {
    expect(messages.analytics.kpiDrawdownHint).toBe(
      "Based on cumulative trade P&L, not account equity."
    );
  });

  it("leaves real prop-firm limits labelled as plain max drawdown", () => {
    // A challenge limit is a configured threshold, not a measured
    // P&L drawdown — renaming it would be wrong.
    expect(messages.accountsView.propDd).toBe("Max drawdown");
  });
});

describe("drawdown labels in hardcoded copy (MD §3.4)", () => {
  const pdf = readFileSync(
    new URL("../../src/lib/reports/pdf.ts", import.meta.url),
    "utf8"
  );
  const dialog = readFileSync(
    new URL("../../src/components/reports/monthly-report-dialog.tsx", import.meta.url),
    "utf8"
  );

  it("monthly PDF calls the chart a cumulative P&L curve and the KPI a P&L drawdown", () => {
    expect(pdf).toContain('"Cumulative P&L curve"');
    expect(pdf).not.toContain('"Equity curve"');
    expect(dialog).toContain('"Max P&L drawdown"');
    expect(dialog).not.toContain('"Max drawdown"');
  });
});
