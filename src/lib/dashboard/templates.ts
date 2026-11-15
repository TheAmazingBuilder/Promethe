/**
 * Dashboard module — built-in templates (v2.5 Module 1, spec §4.9).
 *
 * Six blueprints, versioned in code (no personal data). Import semantics:
 * "add as new dashboard" or "replace current". Widgets with unmet
 * prerequisites are skipped and reported by the applier (server).
 *
 * A template dashboard = { nameKey, icon, widgets: [{ type, config?, title?,
 * layout: { lg, md, sm } }] } — validated against the registry by tests.
 */
import type { WidgetLayout, WidgetLayouts, WidgetType } from "./types";

export interface TemplateWidget {
  type: WidgetType;
  title?: string;
  config?: unknown;
  /** Explicit per-breakpoint layouts (missing breakpoints are normalized). */
  layout: WidgetLayouts;
}

export interface TemplateDashboard {
  nameKey: string;
  icon: string;
  widgets: TemplateWidget[];
}

export interface DashboardTemplate {
  key: string;
  nameKey: string;
  descriptionKey: string;
  dashboards: TemplateDashboard[];
}

const l = (x: number, y: number, w: number, h: number): WidgetLayout => ({
  x,
  y,
  w,
  h,
});

/** Layouts helper — md/sm derived by the normalizer, lg explicit. */
const lg = (layout: WidgetLayout): WidgetLayouts => ({ lg: layout });

const lGrid = (layout: WidgetLayout): WidgetLayouts => ({
  lg: layout,
  md: { ...layout, w: Math.min(layout.w, 6) },
  sm: { ...layout, w: Math.min(layout.w, 4) },
});

export const BUILT_IN_TEMPLATES: DashboardTemplate[] = [
  {
    key: "beginner",
    nameKey: "dashboards.templates.beginner",
    descriptionKey: "dashboards.templates.beginnerDesc",
    dashboards: [
      {
        nameKey: "dashboards.templates.beginnerDashboard",
        icon: "layout-dashboard",
        widgets: [
          {
            type: "kpi-strip",
            layout: lGrid(l(0, 0, 12, 6)),
            config: {
              kpis: ["netPnl", "winRate", "tradeCount", "currentStreak"],
              showDelta: false,
              showSparkline: false,
            },
          },
          { type: "equity-curve", layout: lGrid(l(0, 4, 8, 5)) },
          { type: "quick-actions", layout: lGrid(l(8, 4, 4, 5)) },
          { type: "journal-prompt", layout: lGrid(l(0, 9, 6, 3)) },
          { type: "goals-progress", layout: lGrid(l(6, 9, 6, 5)) },
          { type: "recent-trades", layout: lGrid(l(0, 14, 12, 6)) },
        ],
      },
    ],
  },
  {
    key: "scalper",
    nameKey: "dashboards.templates.scalper",
    descriptionKey: "dashboards.templates.scalperDesc",
    dashboards: [
      {
        nameKey: "dashboards.templates.scalperDashboard",
        icon: "zap",
        widgets: [
          {
            type: "kpi-strip",
            layout: lGrid(l(0, 0, 12, 6)),
            config: {
              kpis: [
                "netPnl",
                "winRate",
                "profitFactor",
                "expectancyR",
                "avgDurationMin",
                "tradeCount",
                "avgWin",
                "avgLoss",
              ],
              showDelta: false,
              showSparkline: false,
            },
          },
          { type: "open-trades", layout: lGrid(l(0, 4, 7, 5)) },
          { type: "session-performance", layout: lGrid(l(7, 4, 5, 5)) },
          { type: "hour-performance", layout: lGrid(l(0, 9, 6, 4)) },
          { type: "r-histogram", layout: lGrid(l(6, 9, 6, 4)) },
          { type: "next-news", layout: lGrid(l(0, 13, 5, 4)) },
          { type: "quick-actions", layout: lGrid(l(5, 13, 3, 4)) },
        ],
      },
    ],
  },
  {
    key: "swing",
    nameKey: "dashboards.templates.swing",
    descriptionKey: "dashboards.templates.swingDesc",
    dashboards: [
      {
        nameKey: "dashboards.templates.swingDashboard",
        icon: "trending-up",
        widgets: [
          {
            type: "kpi-strip",
            layout: lGrid(l(0, 0, 12, 6)),
            config: {
              kpis: [
                "netPnl",
                "expectancyR",
                "totalR",
                "avgR",
                "maxDrawdown",
                "currentDrawdown",
                "sqn",
                "tradingDays",
              ],
              showDelta: false,
              showSparkline: false,
            },
          },
          { type: "equity-curve", layout: lGrid(l(0, 4, 8, 5)) },
          { type: "drawdown-curve", layout: lGrid(l(8, 4, 4, 5)) },
          { type: "strategy-table", layout: lGrid(l(0, 9, 6, 6)) },
          { type: "instrument-table", layout: lGrid(l(6, 9, 6, 6)) },
          { type: "pnl-calendar", layout: lGrid(l(0, 15, 4, 5)) },
          { type: "streak", layout: lGrid(l(4, 15, 4, 2)) },
        ],
      },
    ],
  },
  {
    key: "prop-firm",
    nameKey: "dashboards.templates.propFirm",
    descriptionKey: "dashboards.templates.propFirmDesc",
    dashboards: [
      {
        nameKey: "dashboards.templates.propFirmDashboard",
        icon: "shield",
        widgets: [
          { type: "prop-status", layout: lGrid(l(0, 0, 12, 5)) },
          {
            type: "kpi-strip",
            layout: lGrid(l(0, 4, 12, 6)),
            config: {
              kpis: [
                "netPnl",
                "maxDrawdown",
                "currentDrawdown",
                "winRate",
                "avgRiskPercent",
                "tradeCount",
                "currentStreak",
                "reviewedPercent",
              ],
              showDelta: false,
              showSparkline: false,
            },
          },
          { type: "equity-curve", layout: lGrid(l(0, 8, 8, 5)) },
          { type: "drawdown-curve", layout: lGrid(l(8, 8, 4, 5)) },
          { type: "open-trades", layout: lGrid(l(0, 13, 6, 5)) },
          { type: "weekday-performance", layout: lGrid(l(6, 13, 6, 4)) },
        ],
      },
    ],
  },
  {
    key: "psychology",
    nameKey: "dashboards.templates.psychology",
    descriptionKey: "dashboards.templates.psychologyDesc",
    dashboards: [
      {
        nameKey: "dashboards.templates.psychologyDashboard",
        icon: "brain",
        widgets: [
          {
            type: "kpi-strip",
            layout: lGrid(l(0, 0, 12, 6)),
            config: {
              kpis: [
                "netPnl",
                "winRate",
                "expectancyR",
                "currentStreak",
                "reviewedPercent",
                "tradingDays",
                "avgDurationMin",
                "totalFees",
              ],
              showDelta: false,
              showSparkline: false,
            },
          },
          { type: "journal-prompt", layout: lGrid(l(0, 4, 5, 3)) },
          { type: "goals-progress", layout: lGrid(l(5, 4, 7, 5)) },
          { type: "session-performance", layout: lGrid(l(0, 9, 6, 4)) },
          { type: "hour-performance", layout: lGrid(l(6, 9, 6, 4)) },
          { type: "win-loss", layout: lg(l(0, 13, 4, 4)) },
          { type: "r-histogram", layout: lg(l(4, 13, 8, 4)) },
        ],
      },
    ],
  },
  {
    key: "minimalist",
    nameKey: "dashboards.templates.minimalist",
    descriptionKey: "dashboards.templates.minimalistDesc",
    dashboards: [
      {
        nameKey: "dashboards.templates.minimalistDashboard",
        icon: "circle",
        widgets: [
          { type: "single-kpi", layout: lGrid(l(0, 0, 4, 2)), config: { kpi: "netPnl", showDelta: false } },
          { type: "single-kpi", layout: lGrid(l(4, 0, 4, 2)), config: { kpi: "winRate", showDelta: false } },
          { type: "single-kpi", layout: lGrid(l(8, 0, 4, 2)), config: { kpi: "expectancyR", showDelta: false } },
          { type: "equity-curve", layout: lGrid(l(0, 2, 12, 5)) },
          { type: "streak", layout: lGrid(l(0, 7, 4, 2)) },
          { type: "period-compare", layout: lGrid(l(4, 7, 4, 2)) },
        ],
      },
    ],
  },
];

export function getTemplate(key: string): DashboardTemplate | undefined {
  return BUILT_IN_TEMPLATES.find((t) => t.key === key);
}

/**
 * Default dashboard — direct port of the v2 home view (first login /
 * migration bootstrap). Not listed in the template catalog.
 */
export const DEFAULT_DASHBOARD: TemplateDashboard = {
  nameKey: "dashboards.defaultName",
  icon: "layout-dashboard",
  widgets: [
    {
      type: "kpi-strip",
      layout: lGrid(l(0, 0, 12, 6)),
      config: {
        kpis: [
          "netPnl",
          "winRate",
          "profitFactor",
          "expectancyR",
          "tradeCount",
          "maxDrawdown",
          "currentStreak",
          "tradingDays",
        ],
        showDelta: false,
        showSparkline: false,
      },
    },
    { type: "prop-status", layout: lGrid(l(0, 6, 12, 5)) },
    { type: "goals-progress", layout: lGrid(l(0, 11, 6, 5)) },
    { type: "open-trades", layout: lGrid(l(6, 11, 6, 5)) },
    { type: "equity-curve", layout: lGrid(l(0, 16, 8, 5)) },
    { type: "quick-actions", layout: lGrid(l(8, 16, 4, 5)) },
    { type: "strategy-table", layout: lGrid(l(0, 21, 6, 6)) },
    { type: "recent-trades", layout: lGrid(l(6, 21, 6, 6)) },
  ],
};
