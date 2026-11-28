/**
 * Typed fetch wrapper — consumes the { error, message, fieldErrors } envelope
 * and turns non-2xx responses into ApiClientError.
 *
 * API requests are never stored in the browser HTTP cache. Headers are merged
 * with the Headers API so plain objects, tuples and Headers instances work.
 */
import { CancelledError } from "@tanstack/react-query";
import type { ApiErrorBody } from "@/lib/auth/types";
import { getOfflineUserId } from "@/lib/offline/session";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors?: Record<string, string[]>;
  /** Raw error body (conflict snapshots, ...). */
  readonly body?: unknown;

  constructor(body: ApiErrorBody, status: number) {
    super(body.message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = body.error;
    this.fieldErrors = body.fieldErrors;
    this.body = body;
  }
}

/**
 * A request authenticated as one offline identity must never resolve after
 * that identity changes. React Query clears its cache on account changes,
 * but this transport-level fence also protects callers outside that cache
 * and prevents a late response from being consumed by a stale observer.
 *
 * Null is intentionally not fenced: during initial hydration the provider
 * may publish the initial session immediately after a request starts.
 */
function assertRequestIdentity(requestUserId: string | null): void {
  if (
    typeof window !== "undefined" &&
    requestUserId !== null &&
    getOfflineUserId() !== requestUserId
  ) {
    // TanStack Query recognizes CancelledError and will not retry this
    // request under the new cookie / identity.
    throw new CancelledError({ silent: true });
  }
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const requestUserId =
    typeof window !== "undefined" ? getOfflineUserId() : null;
  const headers = new Headers(init?.headers);
  // JSON is the normal API payload, but do not override multipart boundaries
  // or add a misleading content type to body-less GET/DELETE requests.
  if (typeof init?.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(url, {
    ...init,
    cache: init?.cache ?? "no-store",
    credentials: init?.credentials ?? "same-origin",
    headers,
  });

  assertRequestIdentity(requestUserId);

  if (res.status === 204) {
    return undefined as T;
  }

  const body: unknown = await res.json().catch(() => null);
  assertRequestIdentity(requestUserId);

  if (!res.ok) {
    const errBody: ApiErrorBody =
      body &&
      typeof body === "object" &&
      "error" in body &&
      "message" in body &&
      typeof body.message === "string"
        ? (body as ApiErrorBody)
        : { error: "NETWORK", message: "Invalid server response." };
    throw new ApiClientError(errBody, res.status);
  }

  return body as T;
}
