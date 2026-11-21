/**
 * Typed fetch wrapper — consumes the { error, message, fieldErrors } envelope
 * and turns non-2xx responses into ApiClientError.
 *
 * API requests are never stored in the browser HTTP cache. Headers are merged
 * with the Headers API so plain objects, tuples and Headers instances work.
 */
import type { ApiErrorBody } from "@/lib/auth/types";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(body: ApiErrorBody, status: number) {
    super(body.message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = body.error;
    this.fieldErrors = body.fieldErrors;
  }
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
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

  if (res.status === 204) {
    return undefined as T;
  }

  const body: unknown = await res.json().catch(() => null);
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
