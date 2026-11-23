"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import {
  parseHash,
  parsePathname,
  resolveNavigationTarget,
  routeToPath,
  type AppRoute,
  type ViewId,
  VIEW_IDS,
} from "./routes";

export { parseHash, parsePathname, resolveNavigationTarget, routeToPath };
export type { AppRoute, ViewId };
export { VIEW_IDS };

/**
 * Client-side navigation — Next.js App Router, no more hash routing.
 *
 * How it works: every app page is a real App Router route (/, /trades,
 * /calendar, ...) that renders the same AppRoot shell; the current view is
 * derived from the pathname, so navigation is a client-side route change
 * (no full page reload) and the URL is shareable. `ViewSwitch` still maps
 * a typed route to its view component, so the page transition and the
 * per-view code are unchanged.
 *
 * `navigate()` is a plain function (103 call sites) — it cannot call the
 * `useRouter` hook itself, so the App Router instance is registered once
 * by the tiny <RouterSync /> component mounted in AppRoot. Before
 * registration (first paint) it falls back to a plain location change.
 * Legacy "#/..." targets are normalized to clean URLs first, so old call
 * sites keep working even if a string was missed.
 */

/** Event fired after a programmatic navigation so search-param state syncs. */
export const ROUTE_CHANGE_EVENT = "promethe:route-change";

interface AppRouterLike {
  push: (href: string) => void;
  replace: (href: string) => void;
}

let appRouter: AppRouterLike | null = null;

export function registerAppRouter(router: AppRouterLike | null): void {
  appRouter = router;
}

/** Programmatic navigation - accepts "/trades", "#/trades" (legacy) or "trades". */
export function navigate(to: string): void {
  const target = resolveNavigationTarget(to);
  if (typeof window === "undefined") return;
  const current = `${window.location.pathname}${window.location.search}`;
  if (current === target) return;
  if (appRouter) {
    appRouter.push(target);
    window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
    return;
  }
  window.location.assign(target);
}

/**
 * Update an in-page URL without starting an App Router navigation.
 * Intended for state changes within the same route (for example Gaïa tabs):
 * the URL and browser history update synchronously, and useRoute is notified
 * through the same event used by navigate(). Next.js also observes the
 * native History API and keeps its pathname/search-param hooks in sync.
 */
export function navigateShallow(to: string): void {
  const target = resolveNavigationTarget(to);
  if (typeof window === "undefined") return;
  const current = `${window.location.pathname}${window.location.search}`;
  if (current === target) return;
  window.history.pushState(null, "", target);
  window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
}

/** Current route, derived from the Next.js pathname + query string. */
export function useRoute(): AppRoute {
  const pathname = usePathname();
  const [search, setSearch] = useState<string>(() =>
    typeof window === "undefined" ? "" : window.location.search
  );

  useEffect(() => {
    const sync = () => setSearch(window.location.search);
    sync();
    window.addEventListener("popstate", sync);
    window.addEventListener(ROUTE_CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(ROUTE_CHANGE_EVENT, sync);
    };
  }, []);

  return useMemo(
    () =>
      parsePathname(
        pathname ?? "/",
        new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
      ),
    [pathname, search]
  );
}

/** Backwards-compatible alias — the hash is gone, this reads the pathname. */
export const useHashRoute = useRoute;
