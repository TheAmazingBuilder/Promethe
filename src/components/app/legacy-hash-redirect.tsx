"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { canonicalPathFor, parseHash, routeToPath } from "@/lib/routes";

/**
 * Backward compatibility for old links — mounted in the root layout, so it
 * runs on every page (logged in or not):
 * - old hash URLs (#/trades, #/calendrier, #/outils/marge, #/invitation/…)
 *   are replaced by their canonical clean URL (client-side, no reload);
 * - legacy French pathnames (/calendrier, /outils, /reglages, ...) and the
 *   /settings/broker-sync alias are canonicalized the same way.
 * Public share links (/s/...) and API routes are never touched.
 */
export function LegacyHashRedirect() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const redirectHash = () => {
      const hash = window.location.hash;
      if (!hash.startsWith("#/")) return;
      const target = routeToPath(parseHash(hash));
      const current = `${window.location.pathname}${window.location.search}`;
      if (target !== current) router.replace(target);
    };
    const redirectPath = () => {
      const canonical = canonicalPathFor(
        window.location.pathname,
        new URLSearchParams(window.location.search)
      );
      if (canonical) router.replace(canonical);
    };
    redirectHash();
    redirectPath();
    window.addEventListener("hashchange", redirectHash);
    return () => window.removeEventListener("hashchange", redirectHash);
  }, [router, pathname]);

  return null;
}
