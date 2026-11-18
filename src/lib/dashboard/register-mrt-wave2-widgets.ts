/**
 * MRT wave 2 — dashboard widget registration.
 *
 * Registers the Top 3 leaks and Habits at a glance widgets through the
 * Module 1 extension point registerWidget() — the dashboard core is
 * untouched. Both are SELF-FETCHING (hasLoader: false): Top leaks pulls
 * /api/v1/weekly-plan, Habits pulls /api/v1/analytics?period=all.
 *
 * Imported for its side effects by the widget catalog, the widget
 * renderer, the dashboards view, the server-side dashboard validation
 * and the registry unit tests.
 */
import { z } from "zod";
import { Clock, TrendingDown } from "lucide-react";
import { registerWidget } from "./registry";

const emptyConfigSchema = z.object({}).strict();

let registered = false;

/** Idempotent - imported for side effects by the catalog and the renderer. */
export function registerMrtWave2Widgets(): void {
  if (registered) return;
  registered = true;

  registerWidget({
    type: "top-leaks",
    category: "analysis",
    nameKey: "dashboards.registry.topLeaks",
    descriptionKey: "dashboards.registry.topLeaksDesc",
    icon: TrendingDown,
    defaultLayout: { w: 6, h: 6 },
    minSize: { w: 4, h: 5 },
    maxSize: { w: 12, h: 10 },
    configSchema: emptyConfigSchema,
    defaultConfig: {},
    hasLoader: false,
  });

  registerWidget({
    type: "habits-at-a-glance",
    category: "analysis",
    nameKey: "dashboards.registry.habitsAtAGlance",
    descriptionKey: "dashboards.registry.habitsAtAGlanceDesc",
    icon: Clock,
    defaultLayout: { w: 6, h: 5 },
    minSize: { w: 4, h: 4 },
    maxSize: { w: 12, h: 10 },
    configSchema: emptyConfigSchema,
    defaultConfig: {},
    hasLoader: false,
  });
}

registerMrtWave2Widgets();
