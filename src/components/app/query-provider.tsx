"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiClientError } from "@/lib/api-client";

/**
 * React Query provider — one client for the SPA (stale data refetched on
 * focus, retries disabled offline-friendly). Mounted once in AppRoot.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: (failureCount, error) => {
              // Validation, auth, permission and rate-limit responses are
              // deterministic client errors; retrying them cannot help.
              if (
                error instanceof ApiClientError &&
                error.status >= 400 &&
                error.status < 500
              ) {
                return false;
              }
              return failureCount < 1;
            },
            refetchOnWindowFocus: true,
          },
        },
      })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
