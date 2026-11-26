/**
 * Gaïa autosave recovery (Lot 11, roadmap §15).
 *
 * Autosave used to live only in memory: closing the tab with unsaved
 * edits lost them, and a failed save never retried unless the user typed
 * again. The editor now keeps a local draft backup so work survives a
 * closed tab or a dropped network, and retries automatically.
 *
 * The backup is a pure local cache, never a source of authority: it is
 * only restored when it is strictly newer than the server note, and it
 * is cleared on every successful save. All storage access is guarded -
 * localStorage can be unavailable (private mode, SSR) and must never
 * throw into the editor.
 */

export interface LocalGaiaDraft {
  noteId: string;
  title: string;
  icon: string | null;
  folderId: string | null;
  tagIds: string[];
  favorite: boolean;
  /** JSON string of the draft blocks. */
  blocksJson: string;
  /** Wall-clock time (ms since epoch) the draft was written. */
  savedAtMs: number;
}

export function gaiaDraftKey(noteId: string): string {
  return `promethe.gaia.draft.${noteId}`;
}

function storage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Persist a draft backup. Never throws. */
export function saveLocalGaiaDraft(draft: LocalGaiaDraft): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(gaiaDraftKey(draft.noteId), JSON.stringify(draft));
  } catch {
    // Quota or private mode: the server autosave is still the path.
  }
}

/** Read a draft backup, or null when absent / unreadable / foreign. */
export function loadLocalGaiaDraft(noteId: string): LocalGaiaDraft | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(gaiaDraftKey(noteId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<LocalGaiaDraft>;
    if (candidate.noteId !== noteId) return null;
    if (typeof candidate.blocksJson !== "string") return null;
    if (typeof candidate.savedAtMs !== "number") return null;
    return {
      noteId,
      title: typeof candidate.title === "string" ? candidate.title : "",
      icon: typeof candidate.icon === "string" ? candidate.icon : null,
      folderId:
        typeof candidate.folderId === "string" ? candidate.folderId : null,
      tagIds: Array.isArray(candidate.tagIds)
        ? candidate.tagIds.filter((t): t is string => typeof t === "string")
        : [],
      favorite: candidate.favorite === true,
      blocksJson: candidate.blocksJson,
      savedAtMs: candidate.savedAtMs,
    };
  } catch {
    return null;
  }
}

/** Drop a draft backup. Never throws. */
export function clearLocalGaiaDraft(noteId: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(gaiaDraftKey(noteId));
  } catch {
    // Ignore: the backup is best-effort.
  }
}

/**
 * A local backup wins only when it was written after the server note's
 * last update. Equal timestamps mean the server already holds the draft.
 */
export function isLocalDraftNewer(
  draft: LocalGaiaDraft,
  serverUpdatedAt: string,
): boolean {
  const serverMs = new Date(serverUpdatedAt).getTime();
  if (Number.isNaN(serverMs)) return true;
  return draft.savedAtMs > serverMs;
}

/** Backoff schedule (ms) for autosave retries after a failure. */
export const GAIA_SAVE_RETRY_DELAYS_MS = [5_000, 15_000, 30_000] as const;

/** Delay before attempt N (0-based); null when retries are exhausted. */
export function gaiaSaveRetryDelay(attempt: number): number | null {
  if (attempt < 0 || attempt >= GAIA_SAVE_RETRY_DELAYS_MS.length) return null;
  return GAIA_SAVE_RETRY_DELAYS_MS[attempt];
}
