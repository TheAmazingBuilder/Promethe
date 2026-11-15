"use client";

import { useEffect, useState } from "react";

/**
 * Hash router — single visible route ("/") in this sandbox, client-side
 * navigation with real deep links (#/trades, #/trades/quick, #/trades/abc…).
 *
 * v2 additions: quick trade, trade form (create/edit), settings sub-pages
 * (#/reglages/templates) — parsed into a typed route object.
 */

export const VIEW_IDS = [
  "dashboard",
  "trades",
  "trade",
  "trade-form",
  "quick-trade",
  "analytics",
  "calendar",
  "journal",
  "strategies",
  "rules",
  "accounts",
  "instruments",
  "tags",
  "templates",
  "tools",
  "settings",
  "broker-sync",
  "import",
  "reconciliation",
  "sharing",
  // v3 Phase 5 — mentoring
  "mentors",
  "mentor",
  "mentor-owner",
  "mentor-trade",
  "invitation",
  // v3 Phase 6 — portability & compliance
  "account-settings",
  "legal",
  // v2.5 Module 1 — customizable dashboards
  "focus",
  "appearance-settings",
  "dashboards-settings",
  // v2.5 Module 2 — advanced charts
  "analytics-charts",
  "analytics-heatmaps",
  "analytics-benchmark",
  "analytics-annotations",
  // v2.5 Module 4 — productivity & ergonomics
  "trash",
  // v2.5 Module 8 — privacy, accessibility & time zones
  "privacy-settings",
  "accessibility-settings",
] as const;

export type ViewId = (typeof VIEW_IDS)[number];

export interface AppRoute {
  view: ViewId;
  /** Detail id (e.g. trade id for #/trades/abc). */
  id?: string;
  /** Trade form mode. */
  mode?: "create" | "edit";
  /** Mentor space: the mentee (owner) whose journal is being viewed. */
  ownerId?: string;
  /** Invitation token (#/invitation/{token}). */
  token?: string;
  /** Legal page (#/legal/{mentions|confidentialite|cookies}). */
  legalPage?: "mentions" | "confidentialite" | "cookies";
  /** Journal day (#/journal/2025-05-02) — local calendar day. */
  journalDate?: string;
  /** Hash query params (#/trades?symbol=EURUSD) — drill-down filters etc. */
  query?: Record<string, string>;
}

const PATH_TO_VIEW: Record<string, ViewId> = {
  "": "dashboard",
  trades: "trades",
  analytics: "analytics",
  calendrier: "calendar",
  journal: "journal",
  strategies: "strategies",
  regles: "rules",
  comptes: "accounts",
  instruments: "instruments",
  tags: "tags",
  outils: "tools",
  reglages: "settings",
  reconciliation: "reconciliation",
};

export function parseHash(hash: string): AppRoute {
  // Query string (#/trades?symbol=X) → route.query (single values only).
  const qIndex = hash.indexOf("?");
  const query: Record<string, string> = {};
  if (qIndex >= 0) {
    const params = new URLSearchParams(hash.slice(qIndex + 1));
    for (const [k, v] of params) {
      if (v !== "") query[k] = v;
    }
  }
  const clean = (qIndex >= 0 ? hash.slice(0, qIndex) : hash)
    .replace(/^#/, "")
    .split("?")[0]
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  const [head, second, third] = clean.split("/");
  const view = PATH_TO_VIEW[head ?? ""] ?? "dashboard";
  const withQuery = (route: Omit<AppRoute, "query">): AppRoute => ({
    ...route,
    query,
  });

  // ── Trades subtree ──
  if (view === "trades") {
    if (!second) return withQuery({ view: "trades" });
    if (second === "quick") return withQuery({ view: "quick-trade" });
    if (second === "new") return withQuery({ view: "trade-form", mode: "create" });
    if (third === "edit") {
      return withQuery({
        view: "trade-form",
        mode: "edit",
        id: decodeURIComponent(second),
      });
    }
    return withQuery({ view: "trade", id: decodeURIComponent(second) });
  }

  // ── v2.5 Module 2 — analytics sub-pages (#/analytics/charts…) ──
  if (view === "analytics") {
    if (second === "charts") return withQuery({ view: "analytics-charts" });
    if (second === "heatmaps") return withQuery({ view: "analytics-heatmaps" });
    if (second === "benchmark") {
      return withQuery({ view: "analytics-benchmark" });
    }
    if (second === "annotations") {
      return withQuery({ view: "analytics-annotations" });
    }
    return withQuery({ view: "analytics" });
  }

  // ── Settings subtree (#/reglages/templates, #/reglages/broker-sync…) ──
  if (view === "settings" && second === "templates") {
    return withQuery({ view: "templates" });
  }
  if (view === "settings" && second === "broker-sync") {
    return withQuery({ view: "broker-sync" });
  }
  // #/importer — file import wizard
  if (head === "importer") return withQuery({ view: "import" });
  // #/journal/{date} — journal of one local day (deep link from calendar)
  if (view === "journal" && second && /^\d{4}-\d{2}-\d{2}$/.test(second)) {
    return withQuery({ view: "journal", journalDate: second });
  }
  // #/reglages/partage — public share links management
  if (view === "settings" && second === "partage") {
    return withQuery({ view: "sharing" });
  }
  // #/reglages/mentors — mentoring management (owner side)
  if (view === "settings" && second === "mentors") {
    return withQuery({ view: "mentors" });
  }
  // #/reglages/compte — account, data export & deletion (v3 Phase 6)
  if (view === "settings" && second === "compte") {
    return withQuery({ view: "account-settings" });
  }
  // #/reglages/appearance — palettes, density, chart colors (v2.5 M1)
  if (view === "settings" && second === "appearance") {
    return withQuery({ view: "appearance-settings" });
  }
  // #/reglages/dashboards — manage dashboards, templates, custom metrics (v2.5 M1)
  if (view === "settings" && second === "dashboards") {
    return withQuery({ view: "dashboards-settings" });
  }
  // #/reglages/privacy — privacy mode, scope, auto-triggers (v2.5 M8)
  if (view === "settings" && second === "privacy") {
    return withQuery({ view: "privacy-settings" });
  }
  // #/reglages/accessibility — text scale, contrast, motion, fonts (v2.5 M8)
  if (view === "settings" && second === "accessibility") {
    return withQuery({ view: "accessibility-settings" });
  }
  // #/focus — distraction-free trading mode (v2.5 M1)
  if (head === "focus") return withQuery({ view: "focus" });
  // #/trash — soft-deleted items, 30-day retention (v2.5 M4)
  if (head === "trash") return withQuery({ view: "trash" });
  // #/legal/{mentions|confidentialite|cookies} — public even logged out
  if (head === "legal") {
    const page =
      second === "mentions" || second === "confidentialite" || second === "cookies"
        ? second
        : "mentions";
    return withQuery({ view: "legal", legalPage: page });
  }
  // #/mentor — mentor space; #/mentor/{ownerId} — one mentee's journal;
  // #/mentor/{ownerId}/trades/{tradeId} — read-only trade detail
  if (head === "mentor") {
    if (!second) return withQuery({ view: "mentor" });
    if (third === "trades" && clean.split("/").length >= 4) {
      const tradeId = decodeURIComponent(clean.split("/")[3]);
      return withQuery({
        view: "mentor-trade",
        ownerId: decodeURIComponent(second),
        id: tradeId,
      });
    }
    return withQuery({ view: "mentor-owner", ownerId: decodeURIComponent(second) });
  }
  // #/invitation/{token} — mentor invitation accept/decline
  if (head === "invitation" && second) {
    return withQuery({ view: "invitation", token: decodeURIComponent(second) });
  }

  return withQuery({ view });
}

/** Programmatic navigation — accepts "#/trades" or "trades". */
export function navigate(to: string): void {
  const target = to.startsWith("#") ? to : `#/${to.replace(/^\/+/, "")}`;
  if (window.location.hash === target) return;
  window.location.hash = target;
}

export function useHashRoute(): AppRoute {
  // Neutral first render (matches SSR) — the real hash is applied after mount
  // so a direct load of #/trades/abc never causes a hydration mismatch.
  const [route, setRoute] = useState<AppRoute>({ view: "dashboard" });

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    onChange();
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return route;
}
