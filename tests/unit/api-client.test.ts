import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, ApiClientError } from "@/lib/api-client";

describe("apiFetch transport policy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses no-store and same-origin credentials without adding a content type to GET", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch<{ ok: boolean }>("/api/v1/private")).resolves.toEqual({
      ok: true,
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.cache).toBe("no-store");
    expect(init.credentials).toBe("same-origin");
    expect(new Headers(init.headers).has("Content-Type")).toBe(false);
  });

  it("sets JSON content type for string bodies and preserves Headers instances", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ created: true }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const headers = new Headers({ "X-Request-Id": "request-123" });

    await apiFetch("/api/v1/trades", {
      method: "POST",
      headers,
      body: JSON.stringify({ symbol: "XAUUSD" }),
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const sentHeaders = new Headers(init.headers);
    expect(sentHeaders.get("Content-Type")).toBe("application/json");
    expect(sentHeaders.get("X-Request-Id")).toBe("request-123");
  });

  it("does not override the browser multipart boundary for FormData", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ uploaded: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const form = new FormData();
    form.append("file", new Blob(["image"]));

    await apiFetch("/api/v1/uploads", { method: "POST", body: form });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).has("Content-Type")).toBe(false);
  });

  it("normalizes malformed error envelopes without exposing an undefined message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "BROKEN" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("/api/v1/private")).rejects.toMatchObject({
      name: "ApiClientError",
      status: 500,
      code: "NETWORK",
      message: "Invalid server response.",
    });
    expect(new ApiClientError({ error: "E", message: "M" }, 400)).toBeInstanceOf(
      Error
    );
  });
});
