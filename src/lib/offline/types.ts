/**
 * Offline write queue (§25.5) - shared types and constants.
 *
 * The queue is device-local and per-user: operations created while offline
 * are stored in IndexedDB (never in the service worker cache, never synced
 * across devices) and replayed against the same API routes the online
 * path uses, with the same server validation.
 *
 * Conflict rule (per entity, documented in docs/pwa.md):
 * - Trade create: no conflict possible (new rows, deduped by
 *   clientMutationId) - and one queue item per idempotency key.
 * - Journal upsert: keyed by (user, day). A replay whose baseUpdatedAt no
 *   longer matches the server row is a CONFLICT: both versions are kept
 *   and the user chooses whether to reapply the local version or keep the
 *   server version. The server row is never silently overwritten.
 * - Note create: no conflict possible (new rows, deduped by
 *   clientMutationId) - and one queue item per provisional note id.
 * - Note update: content edits (title, blocks) whose baseUpdatedAt no
 *   longer matches the server row are a CONFLICT, same rule as journal.
 *   Metadata-only patches (favorite, folder, icon, tags) apply without a
 *   base check: they touch no content field and cannot overwrite an edit.
 */

/** Queued operation kinds (V1 scope). */
export type OfflineOpKind =
  | "TRADE_CREATE"
  | "JOURNAL_UPSERT"
  | "NOTE_CREATE"
  | "NOTE_UPDATE";

export type OfflineItemStatus =
  | "PENDING"
  | "SENDING"
  | "SENT"
  | "CONFLICT"
  | "FAILED"
  | "EXPIRED";

/** Queued operations expire 7 days after their last update. */
export const OFFLINE_QUEUE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** A queued operation is abandoned after this many server attempts. */
export const OFFLINE_QUEUE_MAX_ATTEMPTS = 5;

/** A SENDING claim is recoverable after ten minutes without a heartbeat. */
export const OFFLINE_QUEUE_SENDING_LEASE_MS = 10 * 60 * 1000;

/** SENT items are pruned from the queue after this long. */
export const OFFLINE_QUEUE_SENT_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Prefix for client-generated note ids that do not exist server-side yet. */
export const OFFLINE_NOTE_ID_PREFIX = "offline-";

export function isProvisionalNoteId(id: string): boolean {
  return id.startsWith(OFFLINE_NOTE_ID_PREFIX);
}

/** Client-generated idempotency key (also used as the provisional note id). */
export function newOfflineId(): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `q-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return uuid;
}

export function newProvisionalNoteId(): string {
  return `${OFFLINE_NOTE_ID_PREFIX}${newOfflineId()}`;
}

export interface OfflineConflict {
  baseUpdatedAt: string;
  serverUpdatedAt: string;
  /** Server row snapshot, so the UI can show both versions. */
  serverSnapshot: unknown;
}

export interface OfflineQueueItem {
  /** Client id (queue row id). For NOTE_CREATE also the provisional note id. */
  id: string;
  userId: string;
  kind: OfflineOpKind;
  /**
   * Per-kind merge key: TRADE_CREATE -> idempotency key; JOURNAL_UPSERT ->
   * the journal date (YYYY-MM-DD); NOTE_CREATE -> provisional note id;
   * NOTE_UPDATE -> server note id. A new enqueue with the same key
   * replaces the pending payload instead of adding a second item.
   */
  entityKey: string;
  /** Client-generated idempotency key, sent as clientMutationId. */
  idempotencyKey: string;
  /** Exact request body replayed against the route. */
  payload: Record<string, unknown>;
  /** updatedAt the client last saw (journal / note edits). Null for creates. */
  baseUpdatedAt: string | null;
  status: OfflineItemStatus;
  /** Cross-tab claim token; null when the item is not actively sending. */
  leaseToken?: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  lastError: string | null;
  /** Server id once the operation landed (trade / note). */
  serverId: string | null;
  conflict: OfflineConflict | null;
  /**
   * False when the server refused the payload (422): the item never
   * retries automatically, only by hand. True for network and other
   * transient failures, which retry until OFFLINE_QUEUE_MAX_ATTEMPTS.
   */
  retryable: boolean;
}

export function isTerminalOfflineStatus(
  status: OfflineItemStatus,
): boolean {
  return status === "SENT" || status === "EXPIRED";
}
