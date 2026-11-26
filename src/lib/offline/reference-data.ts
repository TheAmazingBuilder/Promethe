/**
 * Offline reference data (§25.5) - the minimal per-user lists the offline
 * forms need (accounts, strategies, instruments, tags, Gaïa folders and
 * tags), cached in IndexedDB while online and read back when the network
 * is gone.
 *
 * Only reference data is cached: trade rows, journal content and note
 * bodies are never cached for reading. The snapshots are refreshed
 * whenever a list query succeeds online, and cleared on logout.
 */
import type { OfflineStore } from "./store";

export type ReferenceKind =
  | "accounts"
  | "strategies"
  | "instruments"
  | "tags"
  | "gaia-folders"
  | "gaia-tags";

const KINDS: ReferenceKind[] = [
  "accounts",
  "strategies",
  "instruments",
  "tags",
  "gaia-folders",
  "gaia-tags",
];

export async function cacheReference(
  store: OfflineStore,
  kind: ReferenceKind,
  rows: unknown,
): Promise<void> {
  await store.putReference(kind, rows);
}

export async function readReference<T>(
  store: OfflineStore,
  kind: ReferenceKind,
): Promise<T[] | null> {
  const value = await store.getReference(kind);
  if (!Array.isArray(value)) return null;
  return value as T[];
}

/**
 * Fetch a list, cache the fresh snapshot on success, and fall back to the
 * cached snapshot when the network fails. Rethrows when there is no
 * snapshot to fall back to. A null store (no IndexedDB, e.g. Node/SSR)
 * skips caching entirely. This is the wrapper the reference data hooks
 * use so the offline forms keep working with the last known lists.
 */
export async function fetchReferenceWithFallback<T>(
  store: OfflineStore | null,
  kind: ReferenceKind,
  fetcher: () => Promise<T[]>,
): Promise<T[]> {
  try {
    const rows = await fetcher();
    if (store) {
      await store.putReference(kind, rows).catch(() => {
        // The cache is best-effort: a refused write never fails the read.
      });
    }
    return rows;
  } catch (error) {
    if (store) {
      const cached = await readReference<T>(store, kind);
      if (cached !== null) return cached;
    }
    throw error;
  }
}

/** Refresh every reference list (called on login and when back online). */
export async function refreshAllReferences(
  store: OfflineStore,
  fetchers: Record<ReferenceKind, () => Promise<unknown[]>>,
): Promise<void> {
  for (const kind of KINDS) {
    try {
      const rows = await fetchers[kind]();
      await store.putReference(kind, rows);
    } catch {
      // One failed list never blocks the others; the stale snapshot stays.
    }
  }
}

export async function clearAllReferences(store: OfflineStore): Promise<void> {
  await store.clearReferences();
}
