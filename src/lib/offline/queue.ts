/**
 * Offline write queue (§25.5) - operations over an OfflineStore.
 *
 * Merge rules (one pending operation per entity, so a user editing the
 * same journal day or the same note offline never piles up duplicate
 * queue items, and a retried trade submit never queues the same trade
 * twice):
 * - TRADE_CREATE: one item per idempotency key - a re-submit of the same
 *   form session replaces the payload.
 * - JOURNAL_UPSERT: one item per (user, date) - a newer save replaces
 *   the payload, keeps the earliest baseUpdatedAt, refreshes expiry.
 * - NOTE_CREATE: one item per provisional note id - a newer draft
 *   replaces the payload.
 * - NOTE_UPDATE: one item per (user, note id) - a newer autosave
 *   replaces the payload, keeps the earliest baseUpdatedAt.
 *
 * Listeners are notified on every mutation so the queue UI stays live.
 */
import type { OfflineStore } from "./store";
import {
  OFFLINE_QUEUE_SENT_RETENTION_MS,
  OFFLINE_QUEUE_SENDING_LEASE_MS,
  OFFLINE_QUEUE_TTL_MS,
  isTerminalOfflineStatus,
  newOfflineId,
  type OfflineItemStatus,
  type OfflineOpKind,
  type OfflineQueueItem,
} from "./types";

export interface EnqueueInput {
  userId: string;
  kind: OfflineOpKind;
  entityKey: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  baseUpdatedAt?: string | null;
  /** Provisional note id for NOTE_CREATE (becomes the item id). */
  id?: string;
}

type QueueListener = () => void;

const listeners = new Set<QueueListener>();

/** Subscribe to queue changes. Returns an unsubscribe function. */
export function onQueueChange(listener: QueueListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/** Notify listeners after a store write made outside the queue helpers. */
export function notifyQueueChange(): void {
  notify();
}

function nowIso(): string {
  return new Date().toISOString();
}

function expiryIso(fromIso: string): string {
  return new Date(new Date(fromIso).getTime() + OFFLINE_QUEUE_TTL_MS).toISOString();
}

/**
 * Enqueue an operation. Merges with an existing PENDING / FAILED item for
 * the same (user, kind, entityKey) when the kind is mergeable, so repeated
 * offline saves of the same journal day or note keep a single queue item.
 */
export async function enqueueOperation(
  store: OfflineStore,
  input: EnqueueInput,
): Promise<OfflineQueueItem> {
  const mergeable =
    input.kind === "TRADE_CREATE" ||
    input.kind === "JOURNAL_UPSERT" ||
    input.kind === "NOTE_CREATE" ||
    input.kind === "NOTE_UPDATE";
  if (mergeable) {
    const existing = await findMergeable(store, input.userId, input.kind, input.entityKey);
    if (existing) {
      const merged: OfflineQueueItem = {
        ...existing,
        payload: input.payload,
        // Keep the earliest base: the conflict check must compare against
        // the server row the user first edited from, not a later draft.
        baseUpdatedAt: existing.baseUpdatedAt ?? input.baseUpdatedAt ?? null,
        status: existing.status === "CONFLICT" ? "CONFLICT" : "PENDING",
        leaseToken: null,
        // A fresh user edit deserves a fresh chance: the new payload may
        // be valid even when the previous one was refused.
        attempts: 0,
        retryable: true,
        updatedAt: nowIso(),
        expiresAt: expiryIso(nowIso()),
        lastError: null,
      };
      await store.putItem(merged);
      notify();
      return merged;
    }
  }
  const createdAt = nowIso();
  const item: OfflineQueueItem = {
    id: input.id ?? newOfflineId(),
    userId: input.userId,
    kind: input.kind,
    entityKey: input.entityKey,
    idempotencyKey: input.idempotencyKey,
    payload: input.payload,
    baseUpdatedAt: input.baseUpdatedAt ?? null,
    status: "PENDING",
    attempts: 0,
    createdAt,
    updatedAt: createdAt,
    expiresAt: expiryIso(createdAt),
    lastError: null,
    serverId: null,
    conflict: null,
    retryable: true,
  };
  await store.putItem(item);
  notify();
  return item;
}

async function findMergeable(
  store: OfflineStore,
  userId: string,
  kind: OfflineOpKind,
  entityKey: string,
): Promise<OfflineQueueItem | null> {
  const items = await store.listItems(userId);
  return (
    items.find(
      (item) =>
        item.kind === kind &&
        item.entityKey === entityKey &&
        (item.status === "PENDING" ||
          item.status === "FAILED" ||
          item.status === "SENDING"),
    ) ?? null
  );
}

export async function listQueueItems(
  store: OfflineStore,
  userId: string,
): Promise<OfflineQueueItem[]> {
  return store.listItems(userId);
}

/** Items that still need attention (pending, sending, conflicted, failed). */
export function countActionableItems(items: OfflineQueueItem[]): number {
  return items.filter(
    (item) =>
      item.status === "PENDING" ||
      item.status === "SENDING" ||
      item.status === "CONFLICT" ||
      item.status === "FAILED",
  ).length;
}

export async function updateItemStatus(
  store: OfflineStore,
  id: string,
  patch: Partial<OfflineQueueItem>,
): Promise<OfflineQueueItem | null> {
  const item = await store.getItem(id);
  if (!item) return null;
  const updated: OfflineQueueItem = { ...item, ...patch, updatedAt: nowIso() };
  await store.putItem(updated);
  notify();
  return updated;
}

export async function discardItem(
  store: OfflineStore,
  id: string,
): Promise<void> {
  await store.deleteItem(id);
  notify();
}

/**
 * Mark items past their expiry as EXPIRED (never replayed silently) and
 * prune SENT items older than the retention window. Returns the items
 * that changed state.
 */
export async function expireStaleItems(
  store: OfflineStore,
  userId: string,
  now: Date = new Date(),
): Promise<OfflineQueueItem[]> {
  const items = await store.listItems(userId);
  const changed: OfflineQueueItem[] = [];
  for (const item of items) {
    if (
      (item.status === "PENDING" || item.status === "FAILED" || item.status === "SENDING") &&
      new Date(item.expiresAt).getTime() <= now.getTime() &&
      (item.status !== "SENDING" ||
        new Date(item.updatedAt).getTime() + OFFLINE_QUEUE_SENDING_LEASE_MS <= now.getTime())
    ) {
      const expired: OfflineQueueItem = {
        ...item,
        status: "EXPIRED",
        updatedAt: nowIso(),
      };
      await store.putItem(expired);
      changed.push(expired);
    } else if (
      item.status === "SENT" &&
      new Date(item.updatedAt).getTime() + OFFLINE_QUEUE_SENT_RETENTION_MS <=
        now.getTime()
    ) {
      await store.deleteItem(item.id);
      changed.push(item);
    }
  }
  if (changed.length > 0) notify();
  return changed;
}

/** Drop every queued operation and reference snapshot for a user. */
export async function clearOfflineDataForUser(
  store: OfflineStore,
  userId: string,
): Promise<void> {
  await store.clearUser(userId);
  notify();
}

export type { OfflineItemStatus };
export { isTerminalOfflineStatus };
