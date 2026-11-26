/**
 * In-memory Supabase Storage REST double for integration tests.
 * Exercises the real upload adapter without network access or local files.
 */
export interface MockStoredObject {
  bytes: Uint8Array;
  contentType: string;
}

export function mockSupabaseStorage() {
  const objects = new Map<string, MockStoredObject>();
  const previousFetch = globalThis.fetch;
  const envKeys = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_STORAGE_BUCKET",
  ] as const;
  const previousEnv = Object.fromEntries(
    envKeys.map((key) => [key, process.env[key]])
  );

  process.env.SUPABASE_URL = "https://storage.test.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.SUPABASE_STORAGE_BUCKET = "trade-screenshots";

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    );
    const method = (init?.method ?? "GET").toUpperCase();
    const prefix = "/storage/v1/object/";
    if (!url.pathname.startsWith(prefix)) {
      return new Response("Not found", { status: 404 });
    }

    const remainder = url.pathname.slice(prefix.length);
    const slash = remainder.indexOf("/");
    const bucket = slash === -1 ? remainder : remainder.slice(0, slash);
    if (bucket !== "trade-screenshots") {
      return new Response(JSON.stringify({ message: "Bucket not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (method === "DELETE" && slash === -1) {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      for (const objectPath of body.prefixes ?? []) objects.delete(objectPath);
      return new Response(null, { status: 200 });
    }

    if (slash === -1) return new Response("Not found", { status: 404 });
    const objectPath = remainder
      .slice(slash + 1)
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");

    if (method === "POST") {
      const headers = new Headers(init?.headers);
      const bytes = init?.body
        ? new Uint8Array(await new Response(init.body).arrayBuffer())
        : new Uint8Array();
      objects.set(objectPath, {
        bytes,
        contentType: headers.get("Content-Type") ?? "application/octet-stream",
      });
      return new Response(null, { status: 200 });
    }

    if (method === "GET") {
      const stored = objects.get(objectPath);
      if (!stored) {
        return new Response(
          JSON.stringify({ code: "NoSuchKey", message: "Object not found" }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(Buffer.from(stored.bytes), {
        status: 200,
        headers: { "Content-Type": stored.contentType },
      });
    }

    return new Response("Method not allowed", { status: 405 });
  }) as typeof fetch;

  return {
    objects,
    restore() {
      globalThis.fetch = previousFetch;
      for (const key of envKeys) {
        const value = previousEnv[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}
