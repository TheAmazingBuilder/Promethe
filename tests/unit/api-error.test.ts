/**
 * Lot 16 — API error envelope (§24): every error response carries a
 * requestId the client can quote in a bug report, and the matching server
 * log line carries the same id. Messages stay English-only (the app is
 * English-only; one French message slipped into CODE_MESSAGES before).
 */
import { describe, expect, it } from "vitest";
import { apiError } from "@/server/api";
import { UnauthorizedError } from "@/server/session";
import { TradeValidationError } from "@/server/trades";
import { IntegrationValidationError } from "@/server/integrations/endpoints";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function body(res: Response) {
  return res.json() as Promise<Record<string, unknown>>;
}

describe("apiError envelope", () => {
  it("401 carries a requestId", async () => {
    const res = apiError(new UnauthorizedError(), "test-route");
    expect(res.status).toBe(401);
    const b = await body(res);
    expect(b.error).toBe("UNAUTHORIZED");
    expect(b.requestId).toMatch(UUID_RE);
  });

  it("coded errors carry a requestId and their mapped message", async () => {
    const res = apiError(new TradeValidationError("ALREADY_CLOSED"), "test");
    expect(res.status).toBe(422);
    const b = await body(res);
    expect(b.error).toBe("ALREADY_CLOSED");
    expect(b.message).toBe("This trade is already closed.");
    expect(b.requestId).toMatch(UUID_RE);
  });

  it("unknown errors are 500 INTERNAL with a requestId, never the internals", async () => {
    const first = apiError(new Error("db exploded: secret detail"), "test");
    const second = apiError(new Error("db exploded: secret detail"), "test");
    expect(first.status).toBe(500);
    const b1 = await body(first);
    const b2 = await body(second);
    expect(b1.error).toBe("INTERNAL");
    expect(JSON.stringify(b1)).not.toContain("secret detail");
    // One id per error response, so two failures are distinguishable.
    expect(b1.requestId).toMatch(UUID_RE);
    expect(b2.requestId).toMatch(UUID_RE);
    expect(b1.requestId).not.toBe(b2.requestId);
  });

  it("messages are English-only (printable ASCII)", async () => {
    // INVALID_QUIET_HOURS used to be French ("Heures calmes invalides").
    const res = apiError(
      new IntegrationValidationError("INVALID_QUIET_HOURS"),
      "test"
    );
    const b = await body(res);
    expect(b.message).toBe("Invalid quiet hours (format HH:mm).");
    expect(String(b.message)).toMatch(/^[\x20-\x7E]*$/);
  });
});
