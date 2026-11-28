/**
 * Typed fetch wrapper — consumes the { error, message, fieldErrors } envelope
 * and turns non-2xx responses into ApiClientError.
 *
 * API requests are never stored in the browser HTTP cache. Headers are merged
 * with the Headers API so plain objects, tuples and Headers instances work.
 */
import { CancelledError } from "@tanstack/react-query";
import type { ApiErrorBody } from "@/lib/auth/types";
import {
  getOfflineIdentityRevision,
  getOfflineUserId,
} from "@/lib/offline/session";

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
 * that identity changes. The revision also catches A -> B -> A transitions,
 * where comparing only the current user id would miss the intermediate switch.
 *
 * Null is intentionally not fenced: during initial hydration the provider
 * may publish the initial session immediately after a request starts.
 */
function assertRequestIdentity(
  requestUserId: string | null,
  requestRevision: number,
): void {
  if (
    typeof window !== "undefined" &&
    requestUserId !== null &&
    (getOfflineUserId() !== requestUserId ||
      getOfflineIdentityRevision() !== requestRevision)
  ) {
    // TanStack Query recognizes CancelledError and will not retry this
    // request under the new cookie / identity.
    throw new CancelledError({ silent: true });
  }
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const isBrowser = typeof window !== "undefined";
  const requestUserId = isBrowser ? getOfflineUserId() : null;
  const requestRevision = isBrowser ? getOfflineIdentityRevision() : 0;
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

  assertRequestIdentity(requestUserId, requestRevision);

  if (res.status === 204) {
    return undefined as T;
  }

  const body: unknown = await res.json().catch(() => null);
  assertRequestIdentity(requestUserId, requestRevision);

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
