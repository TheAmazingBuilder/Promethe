/**
 * Lot 2 — Sync-event failure classification (unit).
 *
 * classifyIngestFailure decides whether a handler failure is definitive
 * (REJECTED, never retried) or retryable (FAILED, reclaimable). The gate
 * itself is covered by tests/integration/sync-idempotence.test.ts.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import {
  classifyIngestFailure,
  IngestError,
  SYNC_EVENT_LEASE_MS,
  SYNC_EVENT_MAX_ATTEMPTS,
} from "@/lib/sync/process";

describe("classifyIngestFailure", () => {
  it("treats a known IngestError as a definitive failure", () => {
    expect(classifyIngestFailure(new IngestError("SOME_RULE", 400))).toEqual({
      terminal: "REJECTED",
      code: "SOME_RULE",
    });
  });

  it("treats unexpected errors as retryable failures", () => {
    expect(classifyIngestFailure(new Error("boom"))).toEqual({
      terminal: "FAILED",
      code: "EVENT_FAILED",
    });
    expect(classifyIngestFailure("boom")).toEqual({
      terminal: "FAILED",
      code: "EVENT_FAILED",
    });
    expect(classifyIngestFailure(null)).toEqual({
      terminal: "FAILED",
      code: "EVENT_FAILED",
    });
  });
});

describe("sync gate constants", () => {
  it("holds a bounded lease and a bounded retry budget", () => {
    expect(SYNC_EVENT_LEASE_MS).toBe(5 * 60 * 1000);
    expect(SYNC_EVENT_MAX_ATTEMPTS).toBe(5);
    expect(SYNC_EVENT_MAX_ATTEMPTS).toBeGreaterThanOrEqual(1);
  });
});
