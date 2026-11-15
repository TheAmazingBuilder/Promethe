/**
 * Dashboard icon keys → Lucide components.
 *
 * Dashboards persist an `icon` string (templates + custom dashboards); this
 * maps the known keys and falls back to LayoutDashboard for anything else.
 * <DashboardIcon> renders the resolved component (React.createElement keeps
 * the react-hooks/static-components rule happy — no render-time component
 * variables).
 */
import * as React from "react";
import {
  Brain,
  Circle,
  LayoutDashboard,
  Shield,
  TrendingUp,
  Zap,
  type LucideIcon,
} from "lucide-react";

const DASHBOARD_ICONS: Record<string, LucideIcon> = {
  "layout-dashboard": LayoutDashboard,
  zap: Zap,
  shield: Shield,
  "trending-up": TrendingUp,
  brain: Brain,
  circle: Circle,
};

export function getDashboardIcon(key: string | null | undefined): LucideIcon {
  if (!key) return LayoutDashboard;
  return DASHBOARD_ICONS[key] ?? LayoutDashboard;
}

/** Renders the dashboard icon for a key with the fallback applied. */
export function DashboardIcon({
  iconKey,
  className,
}: {
  iconKey: string | null | undefined;
  className?: string;
}) {
  return React.createElement(getDashboardIcon(iconKey), {
    className,
    "aria-hidden": true,
  });
}
