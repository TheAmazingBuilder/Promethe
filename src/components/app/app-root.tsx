"use client";

import * as React from "react";
import type { SessionPayload } from "@/lib/auth/types";
import { SessionProvider, useSession } from "./session-context";
import { AppearanceProvider } from "./appearance-provider";
import { PrivacyProvider } from "@/components/privacy/privacy-provider";
import { A11yProvider } from "@/components/a11y/a11y-provider";
import { TimeProvider } from "@/components/time/time-provider";
import { AuthScreen } from "@/components/auth/auth-screen";
import { AppShell } from "./app-shell";
import { ViewSwitch } from "@/components/views/view-switch";
import { QueryProvider } from "./query-provider";
import { PwaRoot } from "@/components/pwa/pwa-root";
import { QuickFab } from "@/components/quick/quick-fab";
import { LegalView } from "@/components/legal/legal-view";
import { useHashRoute } from "@/lib/router";

/**
 * SPA root: the server passes the initial session (no auth flash), then the
 * client takes over — auth screen when logged out, app shell otherwise.
 * v2: React Query provider + PWA root (SW registration, install prompt,
 * offline indicator) + floating quick-trade action.
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
  const route = useHashRoute();

  // Legal pages are public (RGPD art. 12): no auth wall, standalone layout.
  if (!session) {
    if (route.view === "legal") {
      return <LegalView page={route.legalPage ?? "mentions"} standalone />;
    }
    return <AuthScreen />;
  }

  return (
    <>
      <AppShell defaultSidebarOpen={defaultSidebarOpen}>
        <ViewSwitch />
      </AppShell>
      <PwaRoot />
      <QuickFab />
    </>
  );
}
