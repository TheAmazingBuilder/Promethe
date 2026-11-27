/**
 * Offline replay engine (§25.5) - sends queued operations against the
 * same API routes the online path uses, in creation order, one pass at a
 * time.
 *
 * Outcome rules:
 * - 2xx: SENT. A replayed create that the server already has (replay
 *   twice, same idempotency key) returns the stored row - still SENT,
 *   never a duplicate.
 * - 422 validation: FAILED with the server reason, never retried
 *   automatically (the payload will never become valid on its own).
 * - 409 conflict: CONFLICT with both versions kept; the user chooses
 *   (keep mine with force, or keep the server version).
 * - Network error mid-pass: the pass stops, items stay PENDING with
 *   their attempts untouched, and the next `online` event retries.
 * - After OFFLINE_QUEUE_MAX_ATTEMPTS server attempts an item stays
 *   FAILED until the user retries it manually.
 *
 * The sender is injectable so unit tests run the engine against a stub
 * (no network) while the browser uses the real API sender.
 */
import { ApiClientError, apiFetch } from "@/lib/api-client";
import type { OfflineStore } from "./store";
import {
  discardItem,
  expireStaleItems,
  notifyQueueChange,
  updateItemStatus,
} from "./queue";
import {
  OFFLINE_QUEUE_MAX_ATTEMPTS,
  type OfflineConflict,
  type OfflineQueueItem,
} from "./types";

export type ReplayOutcome = "sent" | "failed" | "conflict";

export interface ReplaySendResult {
  outcome: ReplayOutcome;
  /** Server id of the created row (trade / note). */
  serverId?: string | null;
  /** Server row snapshot for a conflict (shown next to the local version). */
  serverSnapshot?: unknown;
  baseUpdatedAt?: string;
  serverUpdatedAt?: string;
  /** Human-readable reason for a failure. */
  message?: string;
  /** False for a 422: the payload will never become valid by retrying. */
  retryable?: boolean;
}

export type ReplaySender = (item: OfflineQueueItem) => Promise<ReplaySendResult>;

export interface ReplaySummary {
  sent: number;
  failed: number;
  conflicted: number;
  /** True when the pass stopped early on a network error. */
  stoppedOnNetworkError: boolean;
}

type NoteSyncedListener = (event: {
  provisionalId: string;
  serverId: string;
}) => void;

const noteSyncedListeners = new Set<NoteSyncedListener>();

/** Subscribe to provisional-note -> server-id remaps after a synced create. */
export function onNoteSynced(listener: NoteSyncedListener): () => void {
  noteSyncedListeners.add(listener);
  return () => {
    noteSyncedListeners.delete(listener);
  };
}

function emitNoteSynced(provisionalId: string, serverId: string): void {
  for (const listener of [...noteSyncedListeners]) {
    listener({ provisionalId, serverId });
  }
}

/** True when the error is a network failure (no server response at all). */
export function isNetworkError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof Error && /network|fetch|Failed to fetch/i.test(error.message))
  );
}

/** The real sender: replays one item against the matching API route. */
export async function createApiReplaySender(): Promise<ReplaySender> {
  return async (item: OfflineQueueItem): Promise<ReplaySendResult> => {
    try {
      if (item.kind === "TRADE_CREATE") {
        const res = await apiFetch<{ trade: { id: string } }>(
          "/api/v1/trades",
          { method: "POST", body: JSON.stringify(item.payload) },
        );
        return { outcome: "sent", serverId: res.trade.id };
      }
      if (item.kind === "JOURNAL_UPSERT") {
        const res = await apiFetch<{ entry: { id: string } }>(
          "/api/v1/journal",
          { method: "PUT", body: JSON.stringify(item.payload) },
        );
        return { outcome: "sent", serverId: res.entry.id };
      }
      if (item.kind === "NOTE_CREATE") {
        const res = await apiFetch<{
          note: { id: string };
          deduplicated?: boolean;
        }>("/api/v1/gaia/notes", {
          method: "POST",
          body: JSON.stringify(item.payload),
        });
        return { outcome: "sent", serverId: res.note.id };
      }
      // NOTE_UPDATE
      const noteId = item.entityKey;
      const res = await apiFetch<{ note: { id: string; updatedAt: string } }>(
        `/api/v1/gaia/notes/${encodeURIComponent(noteId)}`,
        { method: "PATCH", body: JSON.stringify(item.payload) },
      );
      return { outcome: "sent", serverId: res.note.id };
    } catch (error) {
      if (isNetworkError(error)) throw error;
      if (error instanceof ApiClientError) {
        if (error.status === 409) {
          // Conflict snapshot: Gaïa nests it under `details`, journal
          // carries it at the top level. Both shapes are accepted.
          const raw = (error.body ?? {}) as {
            details?: {
              entry?: unknown;
              note?: unknown;
              baseUpdatedAt?: string;
              serverUpdatedAt?: string;
            };
            entry?: unknown;
            note?: unknown;
            baseUpdatedAt?: string;
            serverUpdatedAt?: string;
          };
          const body = raw.details ?? raw;
          const serverSnapshot = body.entry ?? body.note ?? null;
          return {
            outcome: "conflict",
            serverSnapshot,
            baseUpdatedAt: body?.baseUpdatedAt,
            serverUpdatedAt: body?.serverUpdatedAt,
            message: error.message,
          };
        }
        // 422 and every other server response: a per-item failure. A 422
        // never retries automatically - the payload will not become valid
        // by retrying. Other statuses (429, 5xx) stay retryable.
        return {
          outcome: "failed",
          message: error.message,
          retryable: error.status !== 422,
        };
      }
      return {
        outcome: "failed",
        message: error instanceof Error ? error.message : "Replay failed.",
      };
    }
  };
}

let replayInFlight: Promise<ReplaySummary> | null = null;

/**
 * Replay every due item for a user, oldest first. Concurrent calls share
 * the in-flight pass. Returns a summary of the pass.
 */
export function replayQueue(
  store: OfflineStore,
  userId: string,
  sender: ReplaySender,
): Promise<ReplaySummary> {
  if (replayInFlight) return replayInFlight;
  replayInFlight = runReplay(store, userId, sender).finally(() => {
    replayInFlight = null;
  });
  return replayInFlight;
}

async function runReplay(
  store: OfflineStore,
  userId: string,
  sender: ReplaySender,
): Promise<ReplaySummary> {
  const summary: ReplaySummary = {
    sent: 0,
    failed: 0,
    conflicted: 0,
    stoppedOnNetworkError: false,
  };
  await expireStaleItems(store, userId);
  const items = (await store.listItems(userId))
    .filter(
      (item) =>
        item.status === "PENDING" ||
        (item.status === "FAILED" &&
          item.retryable &&
          item.attempts < OFFLINE_QUEUE_MAX_ATTEMPTS),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const item of items) {
    // A newer enqueue may have merged this item away mid-pass.
    const current = await store.getItem(item.id);
    if (!current || (current.status !== "PENDING" && current.status !== "FAILED")) {
      continue;
    }
    await updateItemStatus(store, item.id, { status: "SENDING" });
    let result: ReplaySendResult;
    try {
      result = await sender(current);
    } catch (error) {
      if (isNetworkError(error)) {
        await updateItemStatus(store, item.id, { status: "PENDING" });
        summary.stoppedOnNetworkError = true;
        break;
      }
      result = {
        outcome: "failed",
        message: error instanceof Error ? error.message : "Replay failed.",
      };
    }
    const attempts = current.attempts + 1;
    if (result.outcome === "sent") {
      await updateItemStatus(store, item.id, {
        status: "SENT",
        attempts,
        serverId: result.serverId ?? null,
        lastError: null,
        conflict: null,
      });
      summary.sent += 1;
      if (item.kind === "NOTE_CREATE" && result.serverId) {
        emitNoteSynced(item.entityKey, result.serverId);
      }
    } else if (result.outcome === "conflict") {
      const conflict: OfflineConflict = {
        baseUpdatedAt:
          result.baseUpdatedAt ?? current.baseUpdatedAt ?? current.updatedAt,
        serverUpdatedAt: result.serverUpdatedAt ?? current.updatedAt,
        serverSnapshot: result.serverSnapshot ?? null,
      };
      await updateItemStatus(store, item.id, {
        status: "CONFLICT",
        attempts,
        lastError: result.message ?? "Edited elsewhere.",
        conflict,
      });
      summary.conflicted += 1;
    } else {
      await updateItemStatus(store, item.id, {
        status: "FAILED",
        attempts,
        lastError: result.message ?? "Replay failed.",
        retryable: result.retryable ?? true,
      });
      summary.failed += 1;
    }
  }
  return summary;
}

/**
 * Resolve a conflicted item. "mine" replays with force (the server row is
 * overwritten with the queued payload, using the server's updatedAt as
 * the new base). "server" discards the queued change and keeps the
 * server row. Returns the updated item (null when already gone).
 */
export async function resolveOfflineConflict(
  store: OfflineStore,
  itemId: string,
  choice: "mine" | "server",
): Promise<OfflineQueueItem | null> {
  const item = await store.getItem(itemId);
  if (!item || item.status !== "CONFLICT") return item;
  if (choice === "server") {
    await discardItem(store, itemId);
    return null;
  }
  const serverBase = item.conflict?.serverUpdatedAt ?? undefined;
  let payload: Record<string, unknown>;
  if (item.kind === "NOTE_UPDATE") {
    const { force: _force, ...notePayload } = item.payload;
    // Gaïa now supports an atomic compare-and-swap. Rebase on the
    // conflict snapshot without bypassing the version guard: if the
    // server changes again before replay, the user gets a new 409.
    payload = { ...notePayload, expectedUpdatedAt: serverBase };
  } else {
    // Journal keeps its existing explicit overwrite semantics.
    payload = {
      ...item.payload,
      force: true,
      expectedUpdatedAt: serverBase,
    };
  }
  const resolvedItem: OfflineQueueItem = {
    ...item,
    payload,
    status: "PENDING",
    attempts: 0,
    retryable: true,
    conflict: null,
    lastError: null,
  };
  await store.putItem(resolvedItem);
  notifyQueueChange();
  return resolvedItem;
}
