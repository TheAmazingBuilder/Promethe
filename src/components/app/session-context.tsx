"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { SessionPayload } from "@/lib/auth/types";
import { apiFetch } from "@/lib/api-client";

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
  React.useEffect(() => {
    queryClient.clear();
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
