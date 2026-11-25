"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import type { SessionPayload } from "@/lib/auth/types";
import { SessionProvider, useSession } from "./session-context";
import { AppearanceProvider } from "./appearance-provider";
import { PrivacyProvider } from "@/components/privacy/privacy-provider";
import { A11yProvider } from "@/components/a11y/a11y-provider";
import { TimeProvider } from "@/components/time/time-provider";
import { AuthScreen } from "@/components/auth/auth-screen";
import { AppShell } from "./app-shell";
import { RouterSync } from "./router-sync";
import { ViewSwitch } from "@/components/views/view-switch";
import { QueryProvider } from "./query-provider";
import { QuickFab } from "@/components/quick/quick-fab";
import { useRoute } from "@/lib/router";

// Legal pages are public and rendered outside the shell; the view is a
// separate chunk (also dynamic in view-switch) so logged-out users never
// download the legal copy with the shell.
const LegalView = dynamic(
  () =>
    import("@/components/legal/legal-view").then((m) => m.LegalView),
);

/**
 * SPA root: the server passes the initial session (no auth flash), then the
 * client takes over — auth screen when logged out, app shell otherwise.
 * v2: React Query provider + floating quick-trade action. PWA (service
 * worker registration, install prompt, offline indicator) lives in the
 * root layout only - a second PwaRoot mount here would duplicate the
 * registration, the window listeners and the offline/install UI.
 * v2.5 M1: AppearanceProvider (palette / density / chart palette on <html>).
 * v2.5 M8: PrivacyProvider (HIDE/BLUR display modes, auto-triggers, sync).
 */
export function AppRoot({
  initialSession,
  defaultSidebarOpen = true,
}: {
  initialSession: SessionPayload | null;
  defaultSidebarOpen?: boolean;
}) {
  return (
    <QueryProvider>
      <SessionProvider initialSession={initialSession}>
        <AppearanceProvider>
          <PrivacyProvider>
            <A11yProvider>
              <TimeProvider>
                <RouterSync />
                <AppRootInner defaultSidebarOpen={defaultSidebarOpen} />
              </TimeProvider>
            </A11yProvider>
          </PrivacyProvider>
        </AppearanceProvider>
      </SessionProvider>
    </QueryProvider>
  );
}

function AppRootInner({
  defaultSidebarOpen,
}: {
  defaultSidebarOpen: boolean;
}) {
  const { session } = useSession();
  const route = useRoute();

  // Legal pages are public (RGPD art. 12): no auth wall, standalone layout.
  if (!session) {
    if (route.view === "legal") {
      return <LegalView page={route.legalPage ?? "terms"} standalone />;
    }
    return <AuthScreen />;
  }

  return (
    <>
      <AppShell defaultSidebarOpen={defaultSidebarOpen}>
        <ViewSwitch />
      </AppShell>
      <QuickFab />
    </>
  );
}
