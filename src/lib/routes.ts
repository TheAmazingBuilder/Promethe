/**
 * Clean-URL routing — pure functions, no Next.js imports (unit-testable).
 *
 * Phase 2: the app used to live on a single visible route ("/") with hash
 * routing (#/trades, #/calendrier, ...). It now uses real Next.js App
 * Router pages (all English slugs, no "#"). This module is the single
 * source of truth for:
 * - parsing a clean pathname into a typed route (`parsePathname`),
 * - parsing a legacy hash into the same typed route (`parseHash`),
 * - building the canonical clean URL for a route (`routeToPath`),
 * - deciding whether a URL needs a canonical redirect
 *   (`canonicalPathFor` — legacy French slugs, /tools?tab=, ...).
 *
 * Legacy French slugs (calendrier, outils, reglages, regles, comptes,
 * importer, risque-recompense, ...) are accepted on input so old
 * bookmarks and shared links keep working, but they are never produced.
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
  "playbook",
  "gaia",
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
  // Profile page (/settings/profile)
  "profile-settings",
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
  // v2.5 Module 6 — advanced analytics
  "analytics-lifecycle",
  "analytics-exits",
  "analytics-quality",
  "analytics-setups",
  "analytics-sequences",
  "analytics-seasonality",
  "analytics-anomalies",
  "analytics-weekly-plan",
  // v2.5 Module 4 — productivity & ergonomics
  "trash",
  "search",
  "history",
  "custom-fields-settings",
  "shortcuts-settings",
  // v2.5 Module 8 — privacy, accessibility & time zones
  "privacy-settings",
  "accessibility-settings",
  "time-settings",
  // v2.5 Module 9 — Discord / Telegram integrations
  "integrations-settings",
] as const;

export type ViewId = (typeof VIEW_IDS)[number];

export interface AppRoute {
  view: ViewId;
  /** Detail id (e.g. trade id for /trades/abc). */
  id?: string;
  /** Trade form mode. */
  mode?: "create" | "edit";
  /** Mentor space: the mentee (owner) whose journal is being viewed. */
  ownerId?: string;
  /** Invitation token (/invitation/{token}). */
  token?: string;
  /** Legal page (/legal/terms, /legal/privacy, /legal/cookies). */
  legalPage?: "terms" | "privacy" | "cookies";
  /** Journal day (/journal/2025-05-02) - local calendar day. */
  journalDate?: string;
  /** Query params (?symbol=EURUSD, ?tab=..., ?note=...) - drill-down filters etc. */
  query?: Record<string, string>;
}

/** First path segment -> view. Includes legacy French slugs (input only). */
const PATH_TO_VIEW: Record<string, ViewId> = {
  "": "dashboard",
  trades: "trades",
  analytics: "analytics",
  calendar: "calendar",
  calendrier: "calendar",
  journal: "journal",
  strategies: "strategies",
  playbook: "playbook",
  gaia: "gaia",
  rules: "rules",
  regles: "rules",
  accounts: "accounts",
  comptes: "accounts",
  instruments: "instruments",
  tags: "tags",
  tools: "tools",
  outils: "tools",
  settings: "settings",
  reglages: "settings",
  reconciliation: "reconciliation",
};

/** Tools sub-path segment (or ?tab= value) -> tools tab. French included (input only). */
const TOOL_TAB_BY_SEGMENT: Record<string, string> = {
  "multi-tp": "multi-tp",
  marge: "margin",
  margin: "margin",
  exposition: "exposure",
  exposure: "exposure",
  sessions: "market-hours",
  "market-hours": "market-hours",
  convertisseur: "converter",
  converter: "converter",
  sorties: "exit-plans",
  "exit-plans": "exit-plans",
  taille: "sizing",
  sizing: "sizing",
  pnl: "pnl",
  instruments: "instruments",
  "risque-recompense": "risk-reward",
  "risk-reward": "risk-reward",
};

/** Settings sub-path segment -> view. French included (input only). */
const SETTINGS_SUB_VIEW: Record<string, ViewId> = {
  templates: "templates",
  "broker-sync": "broker-sync",
  partage: "sharing",
  sharing: "sharing",
  mentors: "mentors",
  compte: "account-settings",
  account: "account-settings",
  profile: "profile-settings",
  appearance: "appearance-settings",
  dashboards: "dashboards-settings",
  privacy: "privacy-settings",
  accessibility: "accessibility-settings",
  heure: "time-settings",
  time: "time-settings",
  "champs-personnalises": "custom-fields-settings",
  "custom-fields": "custom-fields-settings",
  raccourcis: "shortcuts-settings",
  shortcuts: "shortcuts-settings",
  integrations: "integrations-settings",
};

/** Legal sub-path segment -> page. French included (input only). */
const LEGAL_PAGE_BY_SEGMENT: Record<string, AppRoute["legalPage"]> = {
  mentions: "terms",
  terms: "terms",
  confidentialite: "privacy",
  privacy: "privacy",
  cookies: "cookies",
};

const ANALYTICS_SUB_VIEW: Record<string, ViewId> = {
  charts: "analytics-charts",
  heatmaps: "analytics-heatmaps",
  benchmark: "analytics-benchmark",
  annotations: "analytics-annotations",
  lifecycle: "analytics-lifecycle",
  exits: "analytics-exits",
  quality: "analytics-quality",
  setups: "analytics-setups",
  sequences: "analytics-sequences",
  seasonality: "analytics-seasonality",
  anomalies: "analytics-anomalies",
  "weekly-plan": "analytics-weekly-plan",
};

/** First segments that belong to the app (English or legacy French). */
const KNOWN_FIRST_SEGMENTS = new Set([
  ...Object.keys(PATH_TO_VIEW),
  "import",
  "importer",
  "search",
  "history",
  "focus",
  "trash",
  "legal",
  "mentor",
  "invitation",
  "broker-sync",
]);

function queryFromSearchParams(
  search: URLSearchParams | Record<string, string> | undefined
): Record<string, string> {
  const query: Record<string, string> = {};
  if (!search) return query;
  const entries =
    search instanceof URLSearchParams
      ? search.entries()
      : Object.entries(search);
  for (const [k, v] of entries) {
    if (v !== "") query[k] = v;
  }
  return query;
}

function splitPath(raw: string): string[] {
  return raw
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .split("/")
    .filter((s) => s !== "")
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
}

function parseSegments(
  segments: string[],
  query: Record<string, string>
): AppRoute {
  const [head = "", second, third, fourth] = segments;
  const view = PATH_TO_VIEW[head] ?? "dashboard";
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
      return withQuery({ view: "trade-form", mode: "edit", id: second });
    }
    return withQuery({ view: "trade", id: second });
  }

  // ── Analytics sub-pages (/analytics/charts…) ──
  if (view === "analytics") {
    const sub = second ? ANALYTICS_SUB_VIEW[second] : undefined;
    return withQuery({ view: sub ?? "analytics" });
  }

  // ── Tools sub-pages (/tools/margin, /tools/risk-reward, ?tab=...) ──
  if (view === "tools") {
    const tab =
      (second ? TOOL_TAB_BY_SEGMENT[second] : undefined) ??
      (query.tab ? TOOL_TAB_BY_SEGMENT[query.tab] : undefined);
    if (tab) {
      const { tab: _dropped, ...rest } = query;
      return { view: "tools", query: { ...rest, tab } };
    }
    return withQuery({ view: "tools" });
  }

  // ── Settings subtree (/settings/templates, /settings/broker-sync…) ──
  if (view === "settings" && second) {
    const sub = SETTINGS_SUB_VIEW[second];
    if (sub) return withQuery({ view: sub });
    return withQuery({ view: "settings" });
  }

  // /broker-sync also lives at the top level (sidebar Data group).
  if (head === "broker-sync") return withQuery({ view: "broker-sync" });
  // /import — file import wizard (legacy slug: importer).
  if (head === "import" || head === "importer") {
    return withQuery({ view: "import" });
  }
  // /journal/{date} — journal of one local day (deep link from calendar).
  if (view === "journal" && second && /^\d{4}-\d{2}-\d{2}$/.test(second)) {
    return withQuery({ view: "journal", journalDate: second });
  }
  // /search — global search (v2.5 M4)
  if (head === "search") return withQuery({ view: "search" });
  // /history — change history + undo (v2.5 M4)
  if (head === "history") return withQuery({ view: "history" });
  // /focus — distraction-free trading mode (v2.5 M1)
  if (head === "focus") return withQuery({ view: "focus" });
  // /trash — soft-deleted items, 30-day retention (v2.5 M4)
  if (head === "trash") return withQuery({ view: "trash" });
  // /legal/{terms|privacy|cookies} — public even logged out
  if (head === "legal") {
    const page = (second ? LEGAL_PAGE_BY_SEGMENT[second] : undefined) ?? "terms";
    return withQuery({ view: "legal", legalPage: page });
  }
  // /mentor — mentor space; /mentor/{ownerId} — one mentee's journal;
  // /mentor/{ownerId}/trades/{tradeId} — read-only trade detail
  if (head === "mentor") {
    if (!second) return withQuery({ view: "mentor" });
    if (third === "trades" && fourth) {
      return withQuery({ view: "mentor-trade", ownerId: second, id: fourth });
    }
    return withQuery({ view: "mentor-owner", ownerId: second });
  }
  // /invitation/{token} — mentor invitation accept/decline
  if (head === "invitation" && second) {
    return withQuery({ view: "invitation", token: second });
  }

  return withQuery({ view });
}

/**
 * Parse a clean App Router pathname (+ query) into a typed route.
 * Unknown paths fall back to the dashboard (the app has no 404 page).
 */
export function parsePathname(
  pathname: string,
  search?: URLSearchParams | Record<string, string>
): AppRoute {
  const query = queryFromSearchParams(search);
  return parseSegments(splitPath(pathname), query);
}

/**
 * Parse a legacy hash ("#/trades/abc", "#/calendrier", "#/outils/marge",
 * "#/reglages/compte", ...) into the same typed route. Used only by the
 * legacy redirect — new code never produces hashes.
 */
export function parseHash(hash: string): AppRoute {
  const qIndex = hash.indexOf("?");
  const query = queryFromSearchParams(
    qIndex >= 0 ? new URLSearchParams(hash.slice(qIndex + 1)) : undefined
  );
  const clean = (qIndex >= 0 ? hash.slice(0, qIndex) : hash).replace(/^#/, "");
  return parseSegments(splitPath(clean), query);
}

function withSearch(path: string, query?: Record<string, string>): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== "") params.set(k, v);
  }
  const qs = params.toString();
  return qs === "" ? path : `${path}?${qs}`;
}

/**
 * Canonical clean URL for a route. Query params are preserved (drill-down
 * filters, Gaïa deep links, Playbook tabs). The tools tab becomes a path
 * segment (/tools/risk-reward); the Playbook tab stays a query param
 * (?tab=...) by design.
 */
export function routeToPath(route: AppRoute): string {
  const query = route.query ?? {};
  switch (route.view) {
    case "dashboard":
      return withSearch("/", query);
    case "trades":
      return withSearch("/trades", query);
    case "trade":
      return withSearch(`/trades/${encodeURIComponent(route.id ?? "")}`, query);
    case "trade-form":
      return route.mode === "edit"
        ? withSearch(
            `/trades/${encodeURIComponent(route.id ?? "")}/edit`,
            query
          )
        : withSearch("/trades/new", query);
    case "quick-trade":
      return withSearch("/trades/quick", query);
    case "analytics":
      return withSearch("/analytics", query);
    case "analytics-charts":
      return withSearch("/analytics/charts", query);
    case "analytics-heatmaps":
      return withSearch("/analytics/heatmaps", query);
    case "analytics-benchmark":
      return withSearch("/analytics/benchmark", query);
    case "analytics-annotations":
      return withSearch("/analytics/annotations", query);
    case "analytics-lifecycle":
      return withSearch("/analytics/lifecycle", query);
    case "analytics-exits":
      return withSearch("/analytics/exits", query);
    case "analytics-quality":
      return withSearch("/analytics/quality", query);
    case "analytics-setups":
      return withSearch("/analytics/setups", query);
    case "analytics-sequences":
      return withSearch("/analytics/sequences", query);
    case "analytics-seasonality":
      return withSearch("/analytics/seasonality", query);
    case "analytics-anomalies":
      return withSearch("/analytics/anomalies", query);
    case "analytics-weekly-plan":
      return withSearch("/analytics/weekly-plan", query);
    case "calendar":
      return withSearch("/calendar", query);
    case "journal":
      return route.journalDate
        ? withSearch(`/journal/${route.journalDate}`, query)
        : withSearch("/journal", query);
    case "strategies":
      return withSearch("/strategies", query);
    case "playbook":
      return withSearch("/playbook", query);
    case "gaia":
      return withSearch("/gaia", query);
    case "rules":
      return withSearch("/rules", query);
    case "accounts":
      return withSearch("/accounts", query);
    case "instruments":
      return withSearch("/instruments", query);
    case "tags":
      return withSearch("/tags", query);
    case "tools": {
      const { tab, ...rest } = query;
      const path = tab && tab !== "sizing" ? `/tools/${tab}` : "/tools";
      return withSearch(path, rest);
    }
    case "settings":
      return withSearch("/settings", query);
    case "templates":
      return withSearch("/settings/templates", query);
    case "broker-sync":
      return withSearch("/broker-sync", query);
    case "import":
      return withSearch("/import", query);
    case "reconciliation":
      return withSearch("/reconciliation", query);
    case "sharing":
      return withSearch("/settings/sharing", query);
    case "mentors":
      return withSearch("/settings/mentors", query);
    case "mentor":
      return withSearch("/mentor", query);
    case "mentor-owner":
      return withSearch(
        `/mentor/${encodeURIComponent(route.ownerId ?? "")}`,
        query
      );
    case "mentor-trade":
      return withSearch(
        `/mentor/${encodeURIComponent(route.ownerId ?? "")}/trades/${encodeURIComponent(route.id ?? "")}`,
        query
      );
    case "invitation":
      return withSearch(
        `/invitation/${encodeURIComponent(route.token ?? "")}`,
        query
      );
    case "account-settings":
      return withSearch("/settings/account", query);
    case "profile-settings":
      return withSearch("/settings/profile", query);
    case "legal":
      return withSearch(`/legal/${route.legalPage ?? "terms"}`, query);
    case "focus":
      return withSearch("/focus", query);
    case "appearance-settings":
      return withSearch("/settings/appearance", query);
    case "dashboards-settings":
      return withSearch("/settings/dashboards", query);
    case "privacy-settings":
      return withSearch("/settings/privacy", query);
    case "accessibility-settings":
      return withSearch("/settings/accessibility", query);
    case "time-settings":
      return withSearch("/settings/time", query);
    case "custom-fields-settings":
      return withSearch("/settings/custom-fields", query);
    case "shortcuts-settings":
      return withSearch("/settings/shortcuts", query);
    case "integrations-settings":
      return withSearch("/settings/integrations", query);
    case "search":
      return withSearch("/search", query);
    case "history":
      return withSearch("/history", query);
    case "trash":
      return withSearch("/trash", query);
    default:
      return withSearch("/", query);
  }
}

/**
 * Normalize any navigation target — legacy hash ("#/trades"), clean path
 * ("/trades"), or bare segment ("trades") — into a canonical clean URL.
 */
export function resolveNavigationTarget(to: string): string {
  const trimmed = to.trim();
  if (trimmed.startsWith("#")) return routeToPath(parseHash(trimmed));
  if (trimmed.startsWith("/")) {
    const qIndex = trimmed.indexOf("?");
    const path = qIndex >= 0 ? trimmed.slice(0, qIndex) : trimmed;
    const search =
      qIndex >= 0 ? new URLSearchParams(trimmed.slice(qIndex + 1)) : undefined;
    return routeToPath(parsePathname(path, search));
  }
  return routeToPath(parsePathname(`/${trimmed}`));
}

/**
 * Canonical URL for the current location, or null when it is already
 * canonical. Covers legacy French pathnames (/calendrier), the
 * /settings/broker-sync alias, and the /tools?tab= form (normalized to
 * /tools/<tab>). Returns null for non-app paths (public shares /s/...,
 * /api/..., unknown segments) so those are never redirected.
 */
export function canonicalPathFor(
  pathname: string,
  search?: URLSearchParams | Record<string, string>
): string | null {
  const segments = splitPath(pathname);
  const head = segments[0] ?? "";
  if (segments.length > 0 && !KNOWN_FIRST_SEGMENTS.has(head)) return null;
  const params =
    search instanceof URLSearchParams
      ? search
      : new URLSearchParams(search as Record<string, string> | undefined);
  const route = parsePathname(pathname, params);
  const canonical = routeToPath(route);
  const canonicalPath = canonical.split("?")[0];
  if (canonicalPath !== pathname) return canonical;
  // Same path, but the /tools?tab= form normalizes to /tools/<tab>.
  if (pathname === "/tools") {
    const tab = params.get("tab");
    if (tab && TOOL_TAB_BY_SEGMENT[tab] && TOOL_TAB_BY_SEGMENT[tab] !== "sizing") {
      return `/tools/${TOOL_TAB_BY_SEGMENT[tab]}`;
    }
  }
  return null;
}
