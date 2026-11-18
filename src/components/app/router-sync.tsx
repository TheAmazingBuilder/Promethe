"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { registerAppRouter } from "@/lib/router";

/**
 * Registers the Next.js router instance for the plain `navigate()` helper
 * (see src/lib/router.ts). Mounted once inside AppRoot; no UI.
 */
export function RouterSync() {
  const router = useRouter();

  useEffect(() => {
    registerAppRouter(router);
    return () => registerAppRouter(null);
  }, [router]);

  return null;
}
