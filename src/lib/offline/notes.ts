/**
 * Provisional Gaïa notes (§25.5) - notes created offline that do not
 * exist server-side yet.
 *
 * A NOTE_CREATE queue item doubles as the note's local representation:
 * its id is the provisional note id (`offline-<uuid>`), its payload is
 * the note draft. The editor opens the provisional note (via the
 * useGaiaNote fallback) and autosaves fold into the queued payload
 * until the create replays; the replay then remaps the provisional id
 * to the server id.
 */
import type { OfflineStore } from "./store";
import { isProvisionalNoteId } from "./types";
import type { OfflineQueueItem } from "./types";

/** Structural shape of a Gaïa note (mirrors GaiaNote in gaia-shared). */
export interface ProvisionalNote {
  id: string;
  userId: string;
  title: string;
  icon: string | null;
  folderId: string | null;
  tagIds: string[];
  favorite: boolean;
  templateId: string | null;
  lessonRef: null;
  blocks: unknown[];
  createdAt: string;
  updatedAt: string;
  lastViewedAt: string | null;
  deletedAt: string | null;
}

export async function readProvisionalNote(
  store: OfflineStore,
  userId: string,
  noteId: string,
): Promise<ProvisionalNote | null> {
  if (!isProvisionalNoteId(noteId)) return null;
  const item = await store.getItem(noteId);
  if (!item || item.userId !== userId || item.kind !== "NOTE_CREATE") return null;
  return provisionalNoteFromItem(item);
}

export function provisionalNoteFromItem(item: OfflineQueueItem): ProvisionalNote {
  const payload = item.payload as {
    title?: unknown;
    folderId?: unknown;
    templateId?: unknown;
    blocks?: unknown;
  };
  const blocks = Array.isArray(payload.blocks) ? payload.blocks : [];
  return {
    id: item.id,
    userId: item.userId,
    title: typeof payload.title === "string" ? payload.title : "",
    icon: "📝",
    folderId:
      typeof payload.folderId === "string" ? payload.folderId : null,
    tagIds: [],
    favorite: false,
    templateId:
      typeof payload.templateId === "string" ? payload.templateId : null,
    lessonRef: null,
    blocks,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    lastViewedAt: null,
    deletedAt: null,
  };
}

/**
 * Fold a note PATCH into a queued create payload, so autosaves of a
 * provisional note update the pending create instead of spawning a
 * NOTE_UPDATE for a note that does not exist yet.
 */
export function foldPatchIntoCreatePayload(
  payload: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...payload };
  for (const key of ["title", "icon", "folderId", "tagIds", "favorite", "blocks"]) {
    if (patch[key] !== undefined) next[key] = patch[key];
  }
  return next;
}
