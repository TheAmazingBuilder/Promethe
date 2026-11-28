/**
 * Offline write queue (§25.5) - queue operations over the in-memory
 * store (the Node testable seam for the IndexedDB queue).
 *
 * Covers: enqueue + per-kind merge rules, expiry (7 days), SENT
 * pruning (24 h), logout clearing, actionable counts.
 */
import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/offline/store";
import {
  clearOfflineDataForUser,
  countActionableItems,
  discardItem,
  enqueueOperation,
  expireStaleItems,
  listQueueItems,
} from "@/lib/offline/queue";
import { OFFLINE_QUEUE_TTL_MS } from "@/lib/offline/types";
import { setOfflineUserId } from "@/lib/offline/session";

const USER = "user-queue-1";
const OTHER = "user-queue-2";

function tradePayload() {
  return {
    accountId: "acc-1",
    instrumentId: "ins-1",
    direction: "LONG",
    entryPrice: "2400",
    lots: "0.1",
    entryTime: "2026-11-26T10:00:00.000Z",
    status: "OPEN",
    clientMutationId: "mut-trade-1",
  };
}

describe("enqueue + merge rules", () => {
  it("creates a pending item with a 7-day expiry", async () => {
    const store = new MemoryStore();
    const item = await enqueueOperation(store, {
      userId: USER,
      kind: "TRADE_CREATE",
      entityKey: "mut-trade-1",
      idempotencyKey: "mut-trade-1",
      payload: tradePayload(),
    });
    expect(item.status).toBe("PENDING");
    expect(item.attempts).toBe(0);
    expect(item.retryable).toBe(true);
    expect(
      new Date(item.expiresAt).getTime() - new Date(item.createdAt).getTime(),
    ).toBe(OFFLINE_QUEUE_TTL_MS);
    expect(await listQueueItems(store, USER)).toHaveLength(1);
  });

  it("merges a retried trade submit on the same idempotency key", async () => {
    const store = new MemoryStore();
    await enqueueOperation(store, {
      userId: USER,
      kind: "TRADE_CREATE",
      entityKey: "mut-trade-1",
      idempotencyKey: "mut-trade-1",
      payload: tradePayload(),
    });
    const merged = await enqueueOperation(store, {
      userId: USER,
      kind: "TRADE_CREATE",
      entityKey: "mut-trade-1",
      idempotencyKey: "mut-trade-1",
      payload: { ...tradePayload(), lots: "0.2" },
    });
    const items = await listQueueItems(store, USER);
    expect(items).toHaveLength(1);
    expect(merged.id).toBe(items[0].id);
    expect((merged.payload as { lots: string }).lots).toBe("0.2");
  });

  it("merges journal saves per day and keeps the earliest base", async () => {
    const store = new MemoryStore();
    await enqueueOperation(store, {
      userId: USER,
      kind: "JOURNAL_UPSERT",
      entityKey: "2026-11-26",
      idempotencyKey: "journal-2026-11-26",
      payload: { date: "2026-11-26", preMarketPlan: "first" },
      baseUpdatedAt: "2026-11-26T08:00:00.000Z",
    });
    const merged = await enqueueOperation(store, {
      userId: USER,
      kind: "JOURNAL_UPSERT",
      entityKey: "2026-11-26",
      idempotencyKey: "journal-2026-11-26",
      payload: { date: "2026-11-26", preMarketPlan: "second" },
      baseUpdatedAt: "2026-11-26T09:00:00.000Z",
    });
    expect(await listQueueItems(store, USER)).toHaveLength(1);
    expect(merged.baseUpdatedAt).toBe("2026-11-26T08:00:00.000Z");
    expect((merged.payload as { preMarketPlan: string }).preMarketPlan).toBe(
      "second",
    );
  });

  it("keeps separate items for different journal days and users", async () => {
    const store = new MemoryStore();
    await enqueueOperation(store, {
      userId: USER,
      kind: "JOURNAL_UPSERT",
      entityKey: "2026-11-26",
      idempotencyKey: "journal-2026-11-26",
      payload: { date: "2026-11-26" },
    });
    await enqueueOperation(store, {
      userId: USER,
      kind: "JOURNAL_UPSERT",
      entityKey: "2026-11-25",
      idempotencyKey: "journal-2026-11-25",
      payload: { date: "2026-11-25" },
    });
    await enqueueOperation(store, {
      userId: OTHER,
      kind: "JOURNAL_UPSERT",
      entityKey: "2026-11-26",
      idempotencyKey: "journal-2026-11-26",
      payload: { date: "2026-11-26" },
    });
    expect(await listQueueItems(store, USER)).toHaveLength(2);
    expect(await listQueueItems(store, OTHER)).toHaveLength(1);
  });

  it("merges note updates per note and keeps the earliest base", async () => {
    const store = new MemoryStore();
    await enqueueOperation(store, {
      userId: USER,
      kind: "NOTE_UPDATE",
      entityKey: "note-1",
      idempotencyKey: "note-1",
      payload: { title: "v1" },
      baseUpdatedAt: "2026-11-26T08:00:00.000Z",
    });
    const merged = await enqueueOperation(store, {
      userId: USER,
      kind: "NOTE_UPDATE",
      entityKey: "note-1",
      idempotencyKey: "note-1",
      payload: { title: "v2" },
      baseUpdatedAt: "2026-11-26T09:00:00.000Z",
    });
    expect(await listQueueItems(store, USER)).toHaveLength(1);
    expect(merged.baseUpdatedAt).toBe("2026-11-26T08:00:00.000Z");
    expect((merged.payload as { title: string }).title).toBe("v2");
  });

  it("a fresh edit resets attempts and retryable on a failed item", async () => {
    const store = new MemoryStore();
    const item = await enqueueOperation(store, {
      userId: USER,
      kind: "JOURNAL_UPSERT",
      entityKey: "2026-11-26",
      idempotencyKey: "journal-2026-11-26",
      payload: { date: "2026-11-26" },
    });
    await store.putItem({ ...item, status: "FAILED", attempts: 3, retryable: false });
    const merged = await enqueueOperation(store, {
      userId: USER,
      kind: "JOURNAL_UPSERT",
      entityKey: "2026-11-26",
      idempotencyKey: "journal-2026-11-26",
      payload: { date: "2026-11-26", preMarketPlan: "retry" },
    });
    expect(merged.status).toBe("PENDING");
    expect(merged.attempts).toBe(0);
    expect(merged.retryable).toBe(true);
  });
});

describe("expiry and pruning", () => {
  it("marks items past their expiry as expired, never replayed", async () => {
    const store = new MemoryStore();
    const item = await enqueueOperation(store, {
      userId: USER,
      kind: "TRADE_CREATE",
      entityKey: "mut-trade-1",
      idempotencyKey: "mut-trade-1",
      payload: tradePayload(),
    });
    const pastExpiry = new Date(
      new Date(item.expiresAt).getTime() + 1000,
    );
    const changed = await expireStaleItems(store, USER, pastExpiry);
    expect(changed).toHaveLength(1);
    expect(changed[0].status).toBe("EXPIRED");
    expect((await listQueueItems(store, USER))[0].status).toBe("EXPIRED");
  });

  it("does not expire items inside their window", async () => {
    const store = new MemoryStore();
    await enqueueOperation(store, {
      userId: USER,
      kind: "TRADE_CREATE",
      entityKey: "mut-trade-1",
      idempotencyKey: "mut-trade-1",
      payload: tradePayload(),
    });
    const changed = await expireStaleItems(store, USER, new Date());
    expect(changed).toHaveLength(0);
  });

  it("prunes sent items older than 24 hours", async () => {
    const store = new MemoryStore();
    const item = await enqueueOperation(store, {
      userId: USER,
      kind: "TRADE_CREATE",
      entityKey: "mut-trade-1",
      idempotencyKey: "mut-trade-1",
      payload: tradePayload(),
    });
    await store.putItem({ ...item, status: "SENT" });
    const later = new Date(new Date(item.updatedAt).getTime() + 25 * 60 * 60 * 1000);
    await expireStaleItems(store, USER, later);
    expect(await listQueueItems(store, USER)).toHaveLength(0);
  });
});

describe("logout and counts", () => {
  it("clears the queue and the reference snapshots on logout", async () => {
    const store = new MemoryStore();
    await enqueueOperation(store, {
      userId: USER,
      kind: "TRADE_CREATE",
      entityKey: "mut-trade-1",
      idempotencyKey: "mut-trade-1",
      payload: tradePayload(),
    });
    await enqueueOperation(store, {
      userId: OTHER,
      kind: "TRADE_CREATE",
      entityKey: "mut-trade-2",
      idempotencyKey: "mut-trade-2",
      payload: { ...tradePayload(), clientMutationId: "mut-trade-2" },
    });
    setOfflineUserId(USER);
    await store.putReference(USER, "accounts", [{ id: "acc-1" }]);
    await store.putReference(OTHER, "accounts", [{ id: "acc-2" }]);
    await clearOfflineDataForUser(store, USER);
    expect(await listQueueItems(store, USER)).toHaveLength(0);
    expect(await listQueueItems(store, OTHER)).toHaveLength(1);
    expect(await store.getReference(USER, "accounts")).toBeNull();
    setOfflineUserId(OTHER);
    expect(await store.getReference(OTHER, "accounts")).toEqual([{ id: "acc-2" }]);
  });

  it("isolates reference snapshots by user and clears only the signing-out user", async () => {
    const store = new MemoryStore();
    setOfflineUserId(USER);
    await store.putReference(USER, "accounts", [{ id: "acc-user" }]);
    setOfflineUserId(OTHER);
    await store.putReference(OTHER, "accounts", [{ id: "acc-other" }]);

    await clearOfflineDataForUser(store, USER);

    expect(await store.getReference(USER, "accounts")).toBeNull();
    expect(await store.getReference(OTHER, "accounts")).toEqual([{ id: "acc-other" }]);
  });

  it("counts only actionable items", async () => {
    const store = new MemoryStore();
    const a = await enqueueOperation(store, {
      userId: USER,
      kind: "TRADE_CREATE",
      entityKey: "mut-1",
      idempotencyKey: "mut-1",
      payload: tradePayload(),
    });
    const b = await enqueueOperation(store, {
      userId: USER,
      kind: "TRADE_CREATE",
      entityKey: "mut-2",
      idempotencyKey: "mut-2",
      payload: tradePayload(),
    });
    await store.putItem({ ...a, status: "SENT" });
    await store.putItem({ ...b, status: "FAILED" });
    const items = await listQueueItems(store, USER);
    expect(countActionableItems(items)).toBe(1);
  });

  it("discards an item", async () => {
    const store = new MemoryStore();
    const item = await enqueueOperation(store, {
      userId: USER,
      kind: "TRADE_CREATE",
      entityKey: "mut-1",
      idempotencyKey: "mut-1",
      payload: tradePayload(),
    });
    await discardItem(store, item.id);
    expect(await listQueueItems(store, USER)).toHaveLength(0);
  });
});
