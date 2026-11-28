/**
 * Offline reference data (§25.5), strictly scoped to the signed-in user.
 * Legacy unowned snapshots are discarded by the IndexedDB v2 migration.
 */
import type { OfflineStore } from "./store";
import { getOfflineUserId } from "./session";

export type ReferenceKind =
  | "accounts"
  | "strategies"
  | "instruments"
  | "tags"
  | "gaia-folders"
  | "gaia-tags";

const KINDS: ReferenceKind[] = [
  "accounts", "strategies", "instruments", "tags", "gaia-folders", "gaia-tags",
];

export async function cacheReference(
  store: OfflineStore,
  userId: string,
  kind: ReferenceKind,
  rows: unknown,
): Promise<void> {
  if (getOfflineUserId() !== userId) return;
  await store.putReference(userId, kind, rows);
}

export async function readReference<T>(
  store: OfflineStore,
  userId: string,
  kind: ReferenceKind,
): Promise<T[] | null> {
  if (getOfflineUserId() !== userId) return null;
  const value = await store.getReference(userId, kind);
  if (getOfflineUserId() !== userId || !Array.isArray(value)) return null;
  return value as T[];
}

export async function fetchReferenceWithFallback<T>(
  store: OfflineStore | null,
  userId: string | null,
  kind: ReferenceKind,
  fetcher: () => Promise<T[]>,
): Promise<T[]> {
  try {
    const rows = await fetcher();
    // A response may complete after another tab switched the shared cookie.
    // Never persist it under an identity that is no longer active.
    if (store && userId && getOfflineUserId() === userId) {
      await store.putReference(userId, kind, rows).catch(() => {});
    }
    return rows;
  } catch (error) {
    if (store && userId && getOfflineUserId() === userId) {
      const cached = await readReference<T>(store, userId, kind);
      if (cached !== null) return cached;
    }
    throw error;
  }
}

export async function refreshAllReferences(
  store: OfflineStore,
  userId: string,
  fetchers: Record<ReferenceKind, () => Promise<unknown[]>>,
): Promise<void> {
  for (const kind of KINDS) {
    if (getOfflineUserId() !== userId) return;
    try {
      const rows = await fetchers[kind]();
      if (getOfflineUserId() !== userId) return;
      await store.putReference(userId, kind, rows);
    } catch {
      // A failed list never blocks the other lists; existing scoped data stays.
    }
  }
}

export async function clearAllReferences(
  store: OfflineStore,
  userId: string,
): Promise<void> {
  await store.clearReferences(userId);
}
