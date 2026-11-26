"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { SessionPayload } from "@/lib/auth/types";
import { apiFetch } from "@/lib/api-client";
import { getBrowserStore, isOfflineQueueSupported } from "@/lib/offline/store";
import { setOfflineUserId } from "@/lib/offline/session";
import { clearOfflineDataForUser } from "@/lib/offline/queue";
import { refreshAllReferences } from "@/lib/offline/reference-data";

/**
 * Refresh the offline reference snapshots (§25.5) after login, so the
 * offline forms have the last known accounts, strategies, instruments,
 * tags and Gaïa folders/tags. Best-effort: a failed refresh keeps the
 * stale snapshot (or none) and never blocks the session.
 */
async function refreshOfflineReferences(): Promise<void> {
  if (!isOfflineQueueSupported()) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  try {
    await refreshAllReferences(getBrowserStore(), {
      accounts: async () =>
        (await apiFetch<{ accounts: unknown[] }>("/api/v1/accounts")).accounts,
      strategies: async () =>
        (await apiFetch<{ strategies: unknown[] }>("/api/v1/strategies")).strategies,
      instruments: async () =>
        (await apiFetch<{ instruments: unknown[] }>("/api/v1/instruments")).instruments,
      tags: async () => (await apiFetch<{ tags: unknown[] }>("/api/v1/tags")).tags,
      "gaia-folders": async () =>
        (await apiFetch<{ folders: unknown[] }>("/api/v1/gaia/folders")).folders,
      "gaia-tags": async () =>
        (await apiFetch<{ tags: unknown[] }>("/api/v1/gaia/tags")).tags,
    });
  } catch {
    // Best-effort only.
  }
}

interface SessionContextValue {
  session: SessionPayload | null;
  setSession: (session: SessionPayload | null) => void;
  logout: () => Promise<void>;
}

const SessionContext = React.createContext<SessionContextValue | null>(null);

export function SessionProvider({
  initialSession,
  children,
}: {
  initialSession: SessionPayload | null;
  children: React.ReactNode;
}) {
  const [session, setSession] = React.useState<SessionPayload | null>(
    initialSession
  );
  const queryClient = useQueryClient();

  // Whenever the signed-in identity changes (login, logout, account switch),
  // drop EVERY cached query — user-scoped caches must never leak across
  // accounts, even within their staleTime window.
  const identity = session?.user.id ?? null;
  const prevIdentityRef = React.useRef<string | null | undefined>(undefined);
  React.useEffect(() => {
    queryClient.clear();
    const prev = prevIdentityRef.current;
    prevIdentityRef.current = identity;
    // Publish the identity to the offline queue (§25.5): PwaRoot renders
    // outside this provider, so the queue reads the id from the module.
    setOfflineUserId(identity);
    if (prev === undefined) {
      // First mount: keep the local queue, just refresh the snapshots.
      if (identity !== null) void refreshOfflineReferences();
      return;
    }
    if (prev !== identity) {
      // Logout / account switch: the queue and the reference snapshots
      // belong to the previous user and must never leak to the next one.
      if (prev !== null && isOfflineQueueSupported()) {
        void clearOfflineDataForUser(getBrowserStore(), prev).catch(() => {
          // Best-effort: the session is dropped regardless.
        });
      }
      if (identity !== null) void refreshOfflineReferences();
    }
  }, [identity, queryClient]);

  const logout = React.useCallback(async () => {
    try {
      await apiFetch("/api/v1/auth/logout", { method: "POST" });
    } catch {
      // The local session is dropped regardless — cookie cleared server-side
      // best-effort; worst case it expires naturally.
    }
    setSession(null);
  }, []);

  const value = React.useMemo(
    () => ({ session, setSession, logout }),
    [session, logout]
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = React.useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used inside <SessionProvider>");
  }
  return ctx;
}
