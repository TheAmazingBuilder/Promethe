/**
 * Typed fetch wrapper — consumes the { error, message, fieldErrors } envelope
 * and turns non-2xx responses into ApiClientError.
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
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const errBody: ApiErrorBody =
      body && typeof body === "object" && "error" in body
        ? (body as ApiErrorBody)
        : { error: "NETWORK", message: "Invalid server response." };
    throw new ApiClientError(errBody, res.status);
  }

  return body as T;
}
