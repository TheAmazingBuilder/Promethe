/**
 * Phase 2 — Risk / Reward widget registration.
 *
 * Registers the daily risk-budget gauge and the discipline-score widget
 * through the Module 1 extension point registerWidget() — the dashboard
 * core is untouched. Both are SELF-FETCHING (hasLoader: false): the
 * budget gauge pulls /api/v1/risk-reward/summary, the score pulls
 * /api/v1/analytics/advanced directly.
 *
 * Imported for its side effects by the widget catalog, the widget
 * renderer, the dashboards view, the server-side dashboard validation
 * and the registry unit tests.
 */
import { z } from "zod";
import { Gauge, Target } from "lucide-react";
import { registerWidget } from "./registry";

const emptyConfigSchema = z.object({}).strict();

let registered = false;

/** Idempotent - imported for side effects by the catalog and the renderer. */
export function registerRiskRewardWidgets(): void {
  if (registered) return;
  registered = true;

  registerWidget({
    type: "risk-budget",
    category: "trading",
    nameKey: "dashboards.registry.riskBudget",
    descriptionKey: "dashboards.registry.riskBudgetDesc",
    icon: Gauge,
    defaultLayout: { w: 6, h: 6 },
    minSize: { w: 4, h: 5 },
    maxSize: { w: 12, h: 8 },
    configSchema: emptyConfigSchema,
    defaultConfig: {},
    hasLoader: false,
  });

  registerWidget({
    type: "discipline-score",
    category: "process",
    nameKey: "dashboards.registry.disciplineScore",
    descriptionKey: "dashboards.registry.disciplineScoreDesc",
    icon: Target,
    defaultLayout: { w: 6, h: 7 },
    minSize: { w: 4, h: 5 },
    maxSize: { w: 12, h: 10 },
    configSchema: emptyConfigSchema,
    defaultConfig: {},
    hasLoader: false,
  });
}

registerRiskRewardWidgets();
