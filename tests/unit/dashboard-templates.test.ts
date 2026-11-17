/**
 * Dashboard module — built-in templates & widget registry unit tests
 * (v2.5 Module 1, spec §4.1 / §4.9).
 *
 * Validates the shipped blueprints against the registry: every widget type
 * registered, every config schema-valid, every lg layout inside the min/max
 * footprint, cardinality limits respected — plus the registry helpers
 * (getWidgetDefinition / safeParseWidgetConfig / registerWidget).
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  BUILT_IN_TEMPLATES,
  DEFAULT_DASHBOARD,
  getTemplate,
  type TemplateDashboard,
} from "@/lib/dashboard/templates";
import {
  getAllWidgetDefinitions,
  getWidgetDefinition,
  registerWidget,
  safeParseWidgetConfig,
  type WidgetDefinition,
} from "@/lib/dashboard/registry";
import {
  MAX_DASHBOARDS,
  MAX_WIDGETS_PER_DASHBOARD,
  WIDGET_TYPES,
} from "@/lib/dashboard/types";
// v2.5 M2 — registers the chart widgets (saved-chart / heatmap /
// year-calendar) through the same extension point the app uses.
import "@/lib/dashboard/register-chart-widgets";
// Phase 2 — registers the risk-budget / discipline-score widgets.
import "@/lib/dashboard/register-risk-reward-widgets";

const templateCases: Array<{ source: string; dashboards: TemplateDashboard[] }> = [
  ...BUILT_IN_TEMPLATES.map((t) => ({
    source: `template:${t.key}`,
    dashboards: t.dashboards,
  })),
  { source: "DEFAULT_DASHBOARD", dashboards: [DEFAULT_DASHBOARD] },
];

function widgetsOf(dashboards: TemplateDashboard[]): TemplateDashboard["widgets"] {
  return dashboards.flatMap((d) => d.widgets);
}

// ── Built-in templates vs the registry ───────────────────────────────────────

describe("built-in templates", () => {
  it("every widget type exists in the registry", () => {
    for (const { source, dashboards } of templateCases) {
      for (const widget of widgetsOf(dashboards)) {
        expect(getWidgetDefinition(widget.type), `${source}:${widget.type}`).toBeDefined();
      }
    }
  });

  it("every widget config passes safeParseWidgetConfig (template config or registry default)", () => {
    for (const { source, dashboards } of templateCases) {
      for (const widget of widgetsOf(dashboards)) {
        const definition = getWidgetDefinition(widget.type)!;
        const parsed = safeParseWidgetConfig(
          widget.type,
          widget.config ?? definition.defaultConfig
        );
        expect(parsed.ok, `${source}:${widget.type}`).toBe(true);
      }
    }
  });

  it("every lg layout exists and stays inside the widget's min/max footprint", () => {
    for (const { source, dashboards } of templateCases) {
      for (const widget of widgetsOf(dashboards)) {
        const definition = getWidgetDefinition(widget.type)!;
        const lg = widget.layout.lg;
        expect(lg, `${source}:${widget.type} lg layout`).toBeDefined();
        expect(lg!.w, `${source}:${widget.type} w`).toBeGreaterThanOrEqual(definition.minSize.w);
        expect(lg!.w, `${source}:${widget.type} w`).toBeLessThanOrEqual(
          Math.min(definition.maxSize.w, 12)
        );
        expect(lg!.h, `${source}:${widget.type} h`).toBeGreaterThanOrEqual(definition.minSize.h);
        expect(lg!.h, `${source}:${widget.type} h`).toBeLessThanOrEqual(definition.maxSize.h);
      }
    }
  });

  it("respects the dashboard/widget cardinality limits", () => {
    for (const template of BUILT_IN_TEMPLATES) {
      expect(template.dashboards.length, template.key).toBeGreaterThanOrEqual(1);
      expect(template.dashboards.length, template.key).toBeLessThanOrEqual(MAX_DASHBOARDS);
      for (const dashboard of template.dashboards) {
        expect(dashboard.widgets.length, `${template.key}:${dashboard.nameKey}`).toBeGreaterThanOrEqual(1);
        expect(dashboard.widgets.length, `${template.key}:${dashboard.nameKey}`).toBeLessThanOrEqual(
          MAX_WIDGETS_PER_DASHBOARD
        );
      }
    }
    expect(DEFAULT_DASHBOARD.widgets.length).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_DASHBOARD.widgets.length).toBeLessThanOrEqual(MAX_WIDGETS_PER_DASHBOARD);
  });
});

// ── getTemplate ──────────────────────────────────────────────────────────────

describe("getTemplate", () => {
  it("finds every built-in template by key", () => {
    for (const template of BUILT_IN_TEMPLATES) {
      expect(getTemplate(template.key)).toBe(template);
    }
  });

  it("returns undefined for unknown keys", () => {
    expect(getTemplate("does-not-exist")).toBeUndefined();
    expect(getTemplate("")).toBeUndefined();
    expect(getTemplate("Beginner")).toBeUndefined(); // lookup is exact
  });
});

// ── Widget registry ──────────────────────────────────────────────────────────

describe("widget registry", () => {
  it("has a definition for every WIDGET_TYPES entry", () => {
    for (const type of WIDGET_TYPES) {
      expect(getWidgetDefinition(type), type).toBeDefined();
    }
  });

  it("getWidgetDefinition returns undefined for unknown types", () => {
    expect(getWidgetDefinition("not-a-widget")).toBeUndefined();
  });

  it("safeParseWidgetConfig applies schema defaults", () => {
    const parsed = safeParseWidgetConfig("kpi-strip", { kpis: ["netPnl"] });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.config).toEqual({
        kpis: ["netPnl"],
        showDelta: false,
        showSparkline: false,
      });
    }
  });

  it("safeParseWidgetConfig falls back to {} for missing configs", () => {
    const parsed = safeParseWidgetConfig("recent-trades", undefined);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.config).toEqual({ limit: 6 });
    }
  });

  it("safeParseWidgetConfig rejects invalid configs", () => {
    expect(safeParseWidgetConfig("kpi-strip", { kpis: ["not-a-kpi"] }).ok).toBe(false); // unknown KPI
    expect(safeParseWidgetConfig("kpi-strip", { kpis: [] }).ok).toBe(false); // min 1
    expect(safeParseWidgetConfig("kpi-strip", { kpis: Array(9).fill("netPnl") }).ok).toBe(false); // max 8
    expect(safeParseWidgetConfig("kpi-strip", null).ok).toBe(false); // kpis required
    expect(safeParseWidgetConfig("equity-curve", { unexpected: true }).ok).toBe(false); // strict schema
    expect(safeParseWidgetConfig("not-a-widget", {}).ok).toBe(false); // unknown type
  });
});

// ── registerWidget (extension point) — mutates the registry, kept last ───────

describe("registerWidget (extension point)", () => {
  const TEST_TYPE = "test-register-widget";
  const icon = getWidgetDefinition("streak")!.icon;

  const makeDefinition = (nameKey: string): WidgetDefinition => ({
    type: TEST_TYPE as unknown as WidgetDefinition["type"],
    category: "system",
    nameKey,
    descriptionKey: "dashboards.registry.testDesc",
    icon,
    defaultLayout: { w: 4, h: 3 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 12, h: 12 },
    configSchema: z.object({ n: z.number().default(1) }),
    defaultConfig: { n: 1 },
    hasLoader: false,
  });

  it("registers a new widget type", () => {
    registerWidget(makeDefinition("test.first"));
    expect(getWidgetDefinition(TEST_TYPE)?.nameKey).toBe("test.first");
    expect(getAllWidgetDefinitions().map((d) => d.type)).toContain(TEST_TYPE);
  });

  it("re-registering a type replaces its definition", () => {
    const before = getAllWidgetDefinitions().length;
    registerWidget(makeDefinition("test.second"));
    expect(getWidgetDefinition(TEST_TYPE)?.nameKey).toBe("test.second");
    expect(getAllWidgetDefinitions()).toHaveLength(before); // replaced, not appended
  });

  it("the registered config schema is used by safeParseWidgetConfig", () => {
    expect(safeParseWidgetConfig(TEST_TYPE, { n: 5 }).ok).toBe(true);
    expect(safeParseWidgetConfig(TEST_TYPE, { n: "nope" }).ok).toBe(false);
    const parsed = safeParseWidgetConfig(TEST_TYPE, undefined);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.config).toEqual({ n: 1 }); // schema default applied
  });
});
