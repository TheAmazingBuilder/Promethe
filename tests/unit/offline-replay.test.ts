/**
 * Offline replay engine (§25.5) - unit tests over the in-memory store
 * with a stubbed sender (no network, no database).
 *
 * Covers: FIFO order, replay-twice-creates-one (sender-side dedupe),
 * 422 -> FAILED and never auto-retried, 409 -> CONFLICT with both
 * versions kept + force resolution, network error stops the pass without
 * burning attempts, max attempts, manual retry.
 */
import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/offline/store";
import { enqueueOperation } from "@/lib/offline/queue";
import {
  replayQueue,
  resolveOfflineConflict,
  type ReplaySender,
  type ReplaySendResult,
} from "@/lib/offline/replay";
import { OFFLINE_QUEUE_MAX_ATTEMPTS, type OfflineQueueItem } from "@/lib/offline/types";

const USER = "user-replay-1";

async function queueTrade(store: MemoryStore, key: string) {
  return enqueueOperation(store, {
    userId: USER,
    kind: "TRADE_CREATE",
    entityKey: key,
    idempotencyKey: key,
    payload: { clientMutationId: key },
  });
}

/** Sender that dedupes on the idempotency key, like the server does. */
function dedupingSender(created: Set<string>): ReplaySender {
  return async (item) => {
    if (created.has(item.idempotencyKey)) {
      return { outcome: "sent", serverId: `server-${item.idempotencyKey}` };
    }
    created.add(item.idempotencyKey);
    return { outcome: "sent", serverId: `server-${item.idempotencyKey}` };
  };
}

describe("replay order and idempotency", () => {
  it("replays oldest first", async () => {
    const store = new MemoryStore();
    const first = await queueTrade(store, "mut-1");
    const second = await queueTrade(store, "mut-2");
    // Force distinct createdAt order (same-millisecond inserts).
    await store.putItem({ ...first, createdAt: "2026-11-26T08:00:00.000Z" });
    await store.putItem({ ...second, createdAt: "2026-11-26T09:00:00.000Z" });
    const seen: string[] = [];
    const sender: ReplaySender = async (item) => {
      seen.push(item.idempotencyKey);
      return { outcome: "sent", serverId: "srv" };
    };
    const summary = await replayQueue(store, USER, sender);
    expect(summary.sent).toBe(2);
    expect(seen).toEqual(["mut-1", "mut-2"]);
  });

  it("replaying twice creates one row (sender dedupes on the key)", async () => {
    const store = new MemoryStore();
    const created = new Set<string>();
    await queueTrade(store, "mut-1");
    const sender = dedupingSender(created);
    await replayQueue(store, USER, sender);
    expect(created.size).toBe(1);
    // A second pass over the same store must not send again: the item is SENT.
    const second = await replayQueue(store, USER, sender);
    expect(second.sent).toBe(0);
    expect(created.size).toBe(1);
  });

  it("a retried replay of the same key is still one row", async () => {
    const store = new MemoryStore();
    const created = new Set<string>();
    await queueTrade(store, "mut-1");
    const sender = dedupingSender(created);
    // First pass fails at the network level before any send lands.
    let calls = 0;
    const flaky: ReplaySender = async (item) => {
      calls += 1;
      if (calls === 1) throw new TypeError("Failed to fetch");
      return sender(item);
    };
    const first = await replayQueue(store, USER, flaky);
    expect(first.stoppedOnNetworkError).toBe(true);
    expect(first.sent).toBe(0);
    expect(created.size).toBe(0);
    const second = await replayQueue(store, USER, sender);
    expect(second.sent).toBe(1);
    expect(created.size).toBe(1);
  });
});

describe("session isolation and single-flight", () => {
  it("stops after an account switch and leaves unsent operations pending", async () => {
    const store = new MemoryStore();
    const first = await queueTrade(store, "switch-1");
    const second = await queueTrade(store, "switch-2");
    let activeUser: string | null = USER;
    const sent: string[] = [];
    const sender: ReplaySender = async (item) => {
      sent.push(item.idempotencyKey);
      activeUser = "another-user";
      return { outcome: "sent", serverId: "server-first" };
    };

    const summary = await replayQueue(store, USER, sender, () => activeUser === USER);

    expect(summary.sent).toBe(1);
    expect(sent).toEqual(["switch-1"]);
    expect((await store.getItem(first.id))?.status).toBe("SENT");
    expect((await store.getItem(second.id))?.status).toBe("PENDING");
    expect((await store.getItem(second.id))?.attempts).toBe(0);
  });

  it("restores SENDING to PENDING if the session changes during the claim", async () => {
    let activeUser: string | null = USER;
    class SessionSwitchStore extends MemoryStore {
      override async putItem(item: OfflineQueueItem): Promise<void> {
        await super.putItem(item);
        if (item.status === "SENDING") activeUser = "another-user";
      }
    }
    const store = new SessionSwitchStore();
    const queued = await queueTrade(store, "switch-before-send");
    let senderCalls = 0;
    const summary = await replayQueue(
      store,
      USER,
      async () => {
        senderCalls += 1;
        return { outcome: "sent" };
      },
      () => activeUser === USER,
    );

    expect(summary.sent).toBe(0);
    expect(senderCalls).toBe(0);
    expect((await store.getItem(queued.id))?.status).toBe("PENDING");
    expect((await store.getItem(queued.id))?.attempts).toBe(0);
  });

  it("does not share a replay promise between different users in the same store", async () => {
    const store = new MemoryStore();
    await queueTrade(store, "user-one-item");
    await enqueueOperation(store, {
      userId: "user-two",
      kind: "TRADE_CREATE",
      entityKey: "user-two-item",
      idempotencyKey: "user-two-item",
      payload: { clientMutationId: "user-two-item" },
    });

    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const sent: string[] = [];
    const sender: ReplaySender = async (item) => {
      sent.push(item.userId);
      if (item.userId === USER) await firstGate;
      return { outcome: "sent", serverId: item.userId };
    };

    const firstPass = replayQueue(store, USER, sender);
    const secondPass = replayQueue(store, "user-two", sender);
    const secondSummary = await secondPass;
    releaseFirst();
    const firstSummary = await firstPass;

    expect(secondSummary.sent).toBe(1);
    expect(firstSummary.sent).toBe(1);
    expect(sent).toContain(USER);
    expect(sent).toContain("user-two");
  });

  it("does not share a replay promise between different store instances", async () => {
    const firstStore = new MemoryStore();
    const secondStore = new MemoryStore();
    await queueTrade(firstStore, "store-one");
    await queueTrade(secondStore, "store-two");
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const sent: string[] = [];
    const sender: ReplaySender = async (item) => {
      sent.push(item.idempotencyKey);
      if (item.idempotencyKey === "store-one") await gate;
      return { outcome: "sent" };
    };

    const firstPass = replayQueue(firstStore, USER, sender);
    const secondSummary = await replayQueue(secondStore, USER, sender);
    releaseFirst();
    const firstSummary = await firstPass;

    expect(firstSummary.sent).toBe(1);
    expect(secondSummary.sent).toBe(1);
    expect(sent.sort()).toEqual(["store-one", "store-two"]);
  });
});

describe("failures", () => {
  it("a 422 fails the item and never auto-retries", async () => {
    const store = new MemoryStore();
    await queueTrade(store, "mut-1");
    let calls = 0;
    const sender: ReplaySender = async () => {
      calls += 1;
      return { outcome: "failed", message: "Some fields are invalid.", retryable: false };
    };
    const first = await replayQueue(store, USER, sender);
    expect(first.failed).toBe(1);
    expect(calls).toBe(1);
    const items = await store.listItems(USER);
    expect(items[0].status).toBe("FAILED");
    expect(items[0].retryable).toBe(false);
    expect(items[0].lastError).toBe("Some fields are invalid.");
    // A second pass must not call the sender again for this item.
    await replayQueue(store, USER, sender);
    expect(calls).toBe(1);
  });

  it("a retryable failure retries until the attempt budget is spent", async () => {
    const store = new MemoryStore();
    await queueTrade(store, "mut-1");
    let calls = 0;
    const sender: ReplaySender = async () => {
      calls += 1;
      return { outcome: "failed", message: "Server error.", retryable: true };
    };
    for (let pass = 0; pass < OFFLINE_QUEUE_MAX_ATTEMPTS; pass += 1) {
      await replayQueue(store, USER, sender);
    }
    expect(calls).toBe(OFFLINE_QUEUE_MAX_ATTEMPTS);
    const items = await store.listItems(USER);
    expect(items[0].status).toBe("FAILED");
    expect(items[0].attempts).toBe(OFFLINE_QUEUE_MAX_ATTEMPTS);
    // Budget spent: no further automatic attempt.
    await replayQueue(store, USER, sender);
    expect(calls).toBe(OFFLINE_QUEUE_MAX_ATTEMPTS);
  });

  it("a network error stops the pass without burning attempts", async () => {
    const store = new MemoryStore();
    await queueTrade(store, "mut-1");
    await queueTrade(store, "mut-2");
    const sender: ReplaySender = async () => {
      throw new TypeError("Failed to fetch");
    };
    const summary = await replayQueue(store, USER, sender);
    expect(summary.stoppedOnNetworkError).toBe(true);
    expect(summary.sent).toBe(0);
    const items = await store.listItems(USER);
    expect(items.every((item) => item.status === "PENDING")).toBe(true);
    expect(items.every((item) => item.attempts === 0)).toBe(true);
  });
});

describe("conflicts", () => {
  it("a 409 keeps both versions and marks the item conflicted", async () => {
    const store = new MemoryStore();
    await enqueueOperation(store, {
      userId: USER,
      kind: "JOURNAL_UPSERT",
      entityKey: "2026-11-26",
      idempotencyKey: "journal-2026-11-26",
      payload: { date: "2026-11-26", preMarketPlan: "mine" },
      baseUpdatedAt: "2026-11-26T08:00:00.000Z",
    });
    const serverEntry = { date: "2026-11-26", preMarketPlan: "theirs" };
    const sender: ReplaySender = async () => ({
      outcome: "conflict",
      serverSnapshot: serverEntry,
      baseUpdatedAt: "2026-11-26T08:00:00.000Z",
      serverUpdatedAt: "2026-11-26T10:00:00.000Z",
    });
    const summary = await replayQueue(store, USER, sender);
    expect(summary.conflicted).toBe(1);
    const items = await store.listItems(USER);
    expect(items[0].status).toBe("CONFLICT");
    expect(items[0].conflict?.serverSnapshot).toEqual(serverEntry);
    expect(items[0].conflict?.serverUpdatedAt).toBe("2026-11-26T10:00:00.000Z");
    // The local payload is untouched: nothing was overwritten.
    expect((items[0].payload as { preMarketPlan: string }).preMarketPlan).toBe("mine");
  });

  it("resolving 'mine' replays with force and the server base", async () => {
    const store = new MemoryStore();
    const item = await enqueueOperation(store, {
      userId: USER,
      kind: "JOURNAL_UPSERT",
      entityKey: "2026-11-26",
      idempotencyKey: "journal-2026-11-26",
      payload: { date: "2026-11-26", preMarketPlan: "mine" },
      baseUpdatedAt: "2026-11-26T08:00:00.000Z",
    });
    await store.putItem({
      ...item,
      status: "CONFLICT",
      conflict: {
        baseUpdatedAt: "2026-11-26T08:00:00.000Z",
        serverUpdatedAt: "2026-11-26T10:00:00.000Z",
        serverSnapshot: { date: "2026-11-26" },
      },
    });
    const resolved = await resolveOfflineConflict(store, item.id, "mine");
    expect(resolved?.status).toBe("PENDING");
    expect(resolved?.attempts).toBe(0);
    expect(
      (resolved?.payload as { force?: boolean; expectedUpdatedAt?: string }).force,
    ).toBe(true);
    expect(
      (resolved?.payload as { force?: boolean; expectedUpdatedAt?: string })
        .expectedUpdatedAt,
    ).toBe("2026-11-26T10:00:00.000Z");
    const seen: Array<Record<string, unknown>> = [];
    const sender: ReplaySender = async (queued) => {
      seen.push(queued.payload);
      return { outcome: "sent", serverId: "srv" } as ReplaySendResult;
    };
    const summary = await replayQueue(store, USER, sender);
    expect(summary.sent).toBe(1);
    expect(seen[0].force).toBe(true);
  });

  it("resolving a Gaïa note conflict rebases without bypassing compare-and-swap", async () => {
    const store = new MemoryStore();
    const item = await enqueueOperation(store, {
      userId: USER,
      kind: "NOTE_UPDATE",
      entityKey: "note-1",
      idempotencyKey: "note-1",
      payload: { title: "mine", expectedUpdatedAt: "2026-11-26T08:00:00.000Z" },
      baseUpdatedAt: "2026-11-26T08:00:00.000Z",
    });
    await store.putItem({
      ...item,
      status: "CONFLICT",
      conflict: {
        baseUpdatedAt: "2026-11-26T08:00:00.000Z",
        serverUpdatedAt: "2026-11-26T10:00:00.000Z",
        serverSnapshot: { id: "note-1", title: "theirs" },
      },
    });

    const resolved = await resolveOfflineConflict(store, item.id, "mine");
    expect(resolved?.status).toBe("PENDING");
    expect(resolved?.payload.expectedUpdatedAt).toBe("2026-11-26T10:00:00.000Z");
    expect(resolved?.payload.force).toBeUndefined();
  });

  it("resolving 'server' discards the queued change", async () => {
    const store = new MemoryStore();
    const item = await enqueueOperation(store, {
      userId: USER,
      kind: "JOURNAL_UPSERT",
      entityKey: "2026-11-26",
      idempotencyKey: "journal-2026-11-26",
      payload: { date: "2026-11-26", preMarketPlan: "mine" },
    });
    await store.putItem({
      ...item,
      status: "CONFLICT",
      conflict: {
        baseUpdatedAt: "2026-11-26T08:00:00.000Z",
        serverUpdatedAt: "2026-11-26T10:00:00.000Z",
        serverSnapshot: { date: "2026-11-26" },
      },
    });
    const resolved = await resolveOfflineConflict(store, item.id, "server");
    expect(resolved).toBeNull();
    expect(await store.listItems(USER)).toHaveLength(0);
  });
});
