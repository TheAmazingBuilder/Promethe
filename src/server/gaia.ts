/**
 * Gaïa : workspace de notes, accès données côté serveur (userId-scoped).
 *
 * Réplique du service Nofy d'Euforia, adaptée aux tables Prisma de Promethe
 * (Note / NoteFolder / NoteTag / NoteTemplate / NoteVersion). Aucun contenu
 * de démonstration : le workspace démarre vide, l'utilisateur crée ses
 * propres dossiers, tags et notes. L'accès inter-utilisateur est rendu
 * comme un 404.
 */
import { NextResponse } from "next/server";
import type { Note, NoteFolder, NoteTag, NoteTemplate, NoteVersion, Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  countOpenTodos,
  countWords,
  excerptOf,
  gaiaBlocksInputSchema,
  gaiaRefKindSchema,
  isSafeImageSrc,
  newBlockId,
  normalizeBlocks,
  parseJsonBlocks,
  parseJsonStringArray,
  searchSnippet,
  searchTextOfBlocks,
  type GaiaBlock,
  type GaiaRefKind,
} from "@/lib/gaia/content";
import { builtInTemplates, findBuiltInTemplate, type GaiaBuiltInTemplate } from "@/lib/gaia/templates";
import {
  foldSearchText,
  rankSearchNotes,
  searchTokens,
} from "@/lib/gaia/search";
import { listRefs as listRefsRaw, resolveNoteRefs, type GaiaRefHit } from "@/lib/gaia/refs";
import {
  shouldSnapshot,
  sortVersionsNewestFirst,
  versionsBeyondCap,
} from "@/lib/gaia/versioning";

/* ── Erreurs ─────────────────────────────────────────────────────────── */

export class GaiaError extends Error {
  readonly error: string;
  readonly code: string;
  readonly status: number;
  readonly issues?: { path: string; message: string }[];
  /** Extra payload for the response body (conflict snapshots). */
  readonly details?: unknown;
  constructor(
    error: string,
    code: string,
    status: number,
    message: string,
    issues?: { path: string; message: string }[],
    details?: unknown,
  ) {
    super(message);
    this.name = "GaiaError";
    this.error = error;
    this.code = code;
    this.status = status;
    this.issues = issues;
    this.details = details;
  }
}

function notFound(code: string, message: string): GaiaError {
  return new GaiaError("NotFound", code, 404, message);
}

function validationError(
  message: string,
  issues?: { path: string; message: string }[],
): GaiaError {
  return new GaiaError("ValidationError", "VALIDATION", 422, message, issues);
}

function conflictError(code: string, message: string, details?: unknown): GaiaError {
  return new GaiaError("Conflict", code, 409, message, undefined, details);
}

const NOTE_NOT_FOUND = () => notFound("NOTE_NOT_FOUND", "Note not found.");
const FOLDER_NOT_FOUND = () => notFound("FOLDER_NOT_FOUND", "Folder not found.");
const TEMPLATE_NOT_FOUND = () => notFound("TEMPLATE_NOT_FOUND", "Template not found.");
const VERSION_NOT_FOUND = () => notFound("VERSION_NOT_FOUND", "Version not found.");

/**
 * Convertit une GaiaError en réponse HTTP ({ error, code?, message?,
 * issues?, details? }). Retourne null pour les autres erreurs (à passer
 * à apiError).
 */
export function gaiaErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof GaiaError)) return null;
  return NextResponse.json(
    {
      error: error.error,
      code: error.code,
      message: error.message,
      ...(error.issues ? { issues: error.issues } : {}),
      ...(error.details !== undefined ? { details: error.details } : {}),
    },
    { status: error.status },
  );
}

/* ── Schémas d'entrée ────────────────────────────────────────────────── */

const noteCreateInputSchema = z.object({
  title: z.string().max(200).optional(),
  folderId: z.string().nullable().optional(),
  templateId: z.string().optional(),
  blocks: gaiaBlocksInputSchema.optional(),
  /** Offline idempotency (§25.5): replaying the same key returns the stored note. */
  clientMutationId: z.string().max(64).optional(),
});

const noteUpdateInputSchema = z.object({
  title: z.string().max(200).optional(),
  icon: z.string().max(16).nullable().optional(),
  folderId: z.string().nullable().optional(),
  tagIds: z.array(z.string()).max(24).optional(),
  favorite: z.boolean().optional(),
  blocks: gaiaBlocksInputSchema.optional(),
  touchViewed: z.boolean().optional(),
  /** Offline conflict check (§25.5): updatedAt the client last saw. */
  expectedUpdatedAt: z.string().optional(),
  /** Replay a conflicted edit, overwriting the server row on purpose. */
  force: z.boolean().optional(),
});

const noteDuplicateInputSchema = z.object({
  title: z.string().max(200).optional(),
});

const folderInputSchema = z.object({ name: z.string().min(1).max(80) });

const tagInputSchema = z.object({ name: z.string().max(80) });

const templateCreateInputSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(300).default(""),
  icon: z.string().max(16).default("📄"),
  fromNoteId: z.string().optional(),
  blocks: gaiaBlocksInputSchema.optional(),
});

const templateInstantiateInputSchema = z.object({
  templateId: z.string().min(1),
  title: z.string().max(200).optional(),
  folderId: z.string().nullable().optional(),
});

type SafeParser<T> = {
  safeParse: (
    input: unknown,
  ) =>
    | { success: true; data: T }
    | { success: false; error: z.ZodError };
};

function parseOrThrow<T>(schema: SafeParser<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw validationError(
      "Some fields are invalid.",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

/** Rejette les blocs image dont le src utilise un protocole non autorisé. */
function assertSafeImageSources(blocks: GaiaBlock[]): void {
  for (const block of blocks) {
    if (block.type === "image" && !isSafeImageSrc(block.src)) {
      throw validationError("Image source not allowed.");
    }
  }
}

/* ── Types de réponse ────────────────────────────────────────────────── */

export type GaiaNoteRow = {
  id: string;
  title: string;
  icon: string | null;
  folderId: string | null;
  folderName: string | null;
  tagIds: string[];
  tagNames: string[];
  favorite: boolean;
  templateId: string | null;
  excerpt: string;
  wordCount: number;
  blockCount: number;
  refCount: number;
  todoOpen: number;
  createdAt: string;
  updatedAt: string;
  lastViewedAt: string | null;
  deletedAt: string | null;
};

export type GaiaNoteDTO = {
  id: string;
  userId: string;
  title: string;
  icon: string | null;
  folderId: string | null;
  tagIds: string[];
  favorite: boolean;
  templateId: string | null;
  blocks: GaiaBlock[];
  createdAt: string;
  updatedAt: string;
  lastViewedAt: string | null;
  deletedAt: string | null;
};

export type GaiaNoteResponse = {
  note: GaiaNoteDTO;
  folderName: string | null;
  tagNames: string[];
};

export type GaiaFolderDTO = NoteFolder & { noteCount: number };
export type GaiaTagDTO = NoteTag & { noteCount: number };

export type GaiaTemplateDTO = {
  id: string;
  name: string;
  description: string;
  icon: string;
  blocks: GaiaBlock[];
  builtIn: boolean;
  createdAt: string;
};

export type GaiaActivityWeek = { weekStart: string; created: number; edited: number };

export type GaiaOverviewResponse = {
  totals: {
    notes: number;
    createdThisWeek: number;
    favorites: number;
    folders: number;
    tags: number;
    trashed: number;
  };
  recentEdited: GaiaNoteRow[];
  recentViewed: GaiaNoteRow[];
  favorites: GaiaNoteRow[];
  folders: GaiaFolderDTO[];
  topTags: GaiaTagDTO[];
  activity: GaiaActivityWeek[];
  templates: GaiaTemplateDTO[];
};

export type GaiaVersionSummary = {
  id: string;
  title: string;
  savedAt: string;
  wordCount: number;
};

export type GaiaVersionDetail = {
  id: string;
  title: string;
  savedAt: string;
  blocks: GaiaBlock[];
};

/* ── Helpers ─────────────────────────────────────────────────────────── */

function normalizeTagName(name: string): string {
  return name.trim().replace(/^#/, "");
}

function nameKeyOf(name: string): string {
  return name.trim().toLowerCase();
}

function cloneBlocksWithNewIds(blocks: GaiaBlock[]): GaiaBlock[] {
  return blocks.map((block) => ({ ...block, id: newBlockId() }));
}

function stripRefs(blocks: GaiaBlock[]): GaiaBlock[] {
  return blocks.map((block) => {
    const { ref: _ref, ...rest } = block;
    return rest;
  });
}

function emptyParagraphBlock(): GaiaBlock {
  return { id: newBlockId(), type: "paragraph", text: "" };
}

async function loadFolders(userId: string): Promise<NoteFolder[]> {
  return db.noteFolder.findMany({
    where: { userId },
    orderBy: { name: "asc" },
  });
}

async function loadTags(userId: string): Promise<NoteTag[]> {
  return db.noteTag.findMany({ where: { userId } });
}

function folderNameOf(folderId: string | null, folders: NoteFolder[]): string | null {
  if (folderId === null) return null;
  return folders.find((f) => f.id === folderId)?.name ?? null;
}

function tagNamesOf(tagIds: string[], tags: NoteTag[]): string[] {
  return tagIds
    .map((tagId) => tags.find((t) => t.id === tagId)?.name ?? null)
    .filter((name): name is string => name !== null);
}

/**
 * Narrow note select for list/overview queries (Phase 2 perf, item 8):
 * every scalar EXCEPT `blocks` — the row's excerpt/wordCount/blockCount/
 * refCount/todoOpen come from a bounded second fetch for the displayed
 * rows only. Full rows (with blocks) still load for single-note reads.
 */
const NOTE_LIST_SELECT = {
  id: true,
  title: true,
  icon: true,
  folderId: true,
  tagIds: true,
  favorite: true,
  templateId: true,
  createdAt: true,
  updatedAt: true,
  lastViewedAt: true,
  deletedAt: true,
} as const;

type NoteListRow = Prisma.NoteGetPayload<{ select: typeof NOTE_LIST_SELECT }>;

/** Minimal shape toRow reads: full rows satisfy it, narrow rows + their
 * blocks (fetched separately) do too. */
type NoteRowInput = NoteListRow & { blocks: string };

function toRow(note: NoteRowInput, folders: NoteFolder[], tags: NoteTag[]): GaiaNoteRow {
  const blocks = parseJsonBlocks(note.blocks);
  const tagIds = parseJsonStringArray(note.tagIds);
  return {
    id: note.id,
    title: note.title,
    icon: note.icon,
    folderId: note.folderId,
    folderName: folderNameOf(note.folderId, folders),
    tagIds,
    tagNames: tagNamesOf(tagIds, tags),
    favorite: note.favorite,
    templateId: note.templateId,
    excerpt: excerptOf(blocks),
    wordCount: countWords(blocks),
    blockCount: blocks.length,
    refCount: blocks.filter((b) => b.type === "ref").length,
    todoOpen: countOpenTodos(blocks),
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    lastViewedAt: note.lastViewedAt?.toISOString() ?? null,
    deletedAt: note.deletedAt?.toISOString() ?? null,
  };
}

function toDTO(note: Note): GaiaNoteDTO {
  return {
    id: note.id,
    userId: note.userId,
    title: note.title,
    icon: note.icon,
    folderId: note.folderId,
    tagIds: parseJsonStringArray(note.tagIds),
    favorite: note.favorite,
    templateId: note.templateId,
    blocks: parseJsonBlocks(note.blocks),
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    lastViewedAt: note.lastViewedAt?.toISOString() ?? null,
    deletedAt: note.deletedAt?.toISOString() ?? null,
  };
}

async function noteResponse(
  userId: string,
  note: Note,
  folders: NoteFolder[],
  tags: NoteTag[],
): Promise<GaiaNoteResponse> {
  const dto = toDTO(note);
  dto.blocks = await resolveNoteRefs(userId, dto.blocks);
  return {
    note: dto,
    folderName: folderNameOf(note.folderId, folders),
    tagNames: tagNamesOf(dto.tagIds, tags),
  };
}

async function findActiveNote(userId: string, noteId: string): Promise<Note | null> {
  return db.note.findFirst({ where: { userId, id: noteId, deletedAt: null } });
}

async function findNoteAnyState(userId: string, noteId: string): Promise<Note | null> {
  return db.note.findFirst({ where: { userId, id: noteId } });
}

/* ── Versioning ──────────────────────────────────────────────────────── */

async function versionsOf(userId: string, noteId: string): Promise<NoteVersion[]> {
  const versions = await db.noteVersion.findMany({
    where: { userId, noteId },
  });
  return sortVersionsNewestFirst(versions);
}

async function maybeSnapshotVersion(
  userId: string,
  note: Note,
  contentChanged = true,
): Promise<void> {
  // Lot 11 (roadmap §15): metadata-only changes (favorite, folder, icon,
  // tags) never burn a version slot with an identical copy of the note.
  if (!contentChanged) return;
  const versions = await versionsOf(userId, note.id);
  const newest = versions[0] ?? null;
  if (!shouldSnapshot(newest ? newest.savedAt : null, new Date())) return;
  await db.noteVersion.create({
    data: {
      userId,
      noteId: note.id,
      title: note.title,
      blocks: note.blocks,
      savedAt: note.updatedAt,
    },
  });
  const after = await versionsOf(userId, note.id);
  const extra = versionsBeyondCap(after);
  if (extra.length > 0) {
    await db.noteVersion.deleteMany({
      where: { userId, id: { in: extra } },
    });
  }
}

/* ── Notes : lecture ─────────────────────────────────────────────────── */

export type GaiaListQuery = {
  view?: string;
  folderId?: string;
  tagId?: string;
  q?: string;
  sort?: string;
  refKind?: string;
  refId?: string;
  /** 1-based page (default 1). */
  page?: number;
  /** Rows per page, 1-100 (default 50). */
  pageSize?: number;
};

/** Blocks for a bounded set of note ids (one indexed query). */
async function loadBlocksFor(noteIds: string[]): Promise<Map<string, string>> {
  if (noteIds.length === 0) return new Map();
  const rows = await db.note.findMany({
    where: { id: { in: noteIds } },
    select: { id: true, blocks: true },
  });
  return new Map(rows.map((r) => [r.id, r.blocks]));
}

function pageWindow(query: GaiaListQuery): { page: number; pageSize: number } {
  const page = Math.max(1, Math.floor(query.page ?? 1) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Math.floor(query.pageSize ?? 50) || 50)
  );
  return { page, pageSize };
}

function sortOrderBy(sort: string): Prisma.NoteOrderByWithRelationInput[] {
  // Deterministic tiebreaker (id desc) so take/skip pages never shift
  // when two notes share the same timestamp.
  if (sort === "created") return [{ createdAt: "desc" }, { id: "desc" }];
  if (sort === "title") return [{ title: "asc" }, { id: "desc" }];
  if (sort === "viewed") {
    // The old JS sort put nulls last; SQL DESC puts them first.
    return [{ lastViewedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }];
  }
  return [{ updatedAt: "desc" }, { id: "desc" }];
}

export async function listNotes(
  userId: string,
  query: GaiaListQuery,
): Promise<{ notes: GaiaNoteRow[]; total: number }> {
  const [folders, tags] = await Promise.all([
    loadFolders(userId),
    loadTags(userId),
  ]);
  const { page, pageSize } = pageWindow(query);

  // Reference view: link detection needs block text — in-memory path
  // over the user's notes (same matching as before), then paginate.
  if (query.refKind !== undefined && query.refId !== undefined) {
    const parsed = gaiaRefKindSchema.safeParse(query.refKind);
    if (!parsed.success) {
      throw validationError("Invalid reference type.");
    }
    const kind = parsed.data;
    const all = await db.note.findMany({ where: { userId } });
    const linked = all.filter(
      (note) =>
        note.deletedAt === null &&
        parseJsonBlocks(note.blocks).some(
          (b) => b.type === "ref" && b.ref?.kind === kind && b.ref.id === query.refId,
        ),
    );
    const sorted = linked.sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
    );
    const total = sorted.length;
    const pageNotes = sorted.slice((page - 1) * pageSize, page * pageSize);
    return {
      notes: pageNotes.map((note) => toRow(note, folders, tags)),
      total,
    };
  }

  const view = query.view ?? "all";
  const where: Prisma.NoteWhereInput = { userId };
  if (view === "trash") {
    where.deletedAt = { not: null };
  } else {
    where.deletedAt = null;
    if (view === "favorites") where.favorite = true;
    else if (view === "recent") where.lastViewedAt = { not: null };
    else if (view === "folder" && query.folderId) {
      where.folderId = query.folderId;
    } else if (view === "tag" && query.tagId) {
      // tagIds is a JSON string array: the quoted match is exact
      // membership (same as the old array .includes()).
      where.tagIds = { contains: `"${query.tagId}"` };
    }
  }

  const q = foldSearchText(query.q ?? "");
  if (q !== "") {
    // Text search needs block text, tag names and folder names —
    // in-memory path over the scoped set (same matching as before),
    // then paginate after filtering.
    const scoped = await db.note.findMany({ where });
    const filtered = scoped.filter((note) => {
      const blocks = parseJsonBlocks(note.blocks);
      const tagIds = parseJsonStringArray(note.tagIds);
      return (
        foldSearchText(note.title).includes(q) ||
        foldSearchText(searchTextOfBlocks(blocks)).includes(q) ||
        tagNamesOf(tagIds, tags).some((name) =>
          foldSearchText(name).includes(q),
        ) ||
        foldSearchText(folderNameOf(note.folderId, folders) ?? "").includes(q)
      );
    });
    const sort = query.sort ?? "updated";
    const sorted = [...filtered].sort((a, b) => {
      if (sort === "created") return b.createdAt.getTime() - a.createdAt.getTime();
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "viewed") {
        return (b.lastViewedAt?.getTime() ?? 0) - (a.lastViewedAt?.getTime() ?? 0);
      }
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });
    const total = sorted.length;
    const pageNotes = sorted.slice((page - 1) * pageSize, page * pageSize);
    return {
      notes: pageNotes.map((note) => toRow(note, folders, tags)),
      total,
    };
  }

  // Common path (Phase 2 perf, item 8): SQL filter + sort + take/skip,
  // blocks only for the page rows — no full-history scan, no block JSON
  // for notes the page never shows.
  const [total, pageRows] = await Promise.all([
    db.note.count({ where }),
    db.note.findMany({
      where,
      select: NOTE_LIST_SELECT,
      orderBy: sortOrderBy(query.sort ?? "updated"),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  const blocksById = await loadBlocksFor(pageRows.map((n) => n.id));
  return {
    notes: pageRows.map((n) =>
      toRow({ ...n, blocks: blocksById.get(n.id) ?? "[]" }, folders, tags)
    ),
    total,
  };
}

export async function getNote(
  userId: string,
  noteId: string,
): Promise<GaiaNoteResponse> {
  const note = await findActiveNote(userId, noteId);
  if (!note) throw NOTE_NOT_FOUND();

  // A read must not invalidate the editor's optimistic-concurrency token.
  // Prisma's @updatedAt would otherwise advance updatedAt when lastViewedAt
  // changes, making the next autosave PATCH fail with NOTE_CONFLICT.
  // Guard the metadata write with the version we just read: if a concurrent
  // content save wins first, skip this view timestamp update and return the
  // latest row instead of overwriting its updatedAt with a stale value.
  await db.note.updateMany({
    where: {
      userId,
      id: note.id,
      updatedAt: note.updatedAt,
    },
    data: {
      lastViewedAt: new Date(),
      updatedAt: note.updatedAt,
    },
  });

  const current = await findActiveNote(userId, note.id);
  if (!current) throw NOTE_NOT_FOUND();
  const [folders, tags] = await Promise.all([loadFolders(userId), loadTags(userId)]);
  return noteResponse(userId, current, folders, tags);
}

/* ── Notes : écriture ────────────────────────────────────────────────── */

export type CreateNoteResult = GaiaNoteResponse & { deduplicated: boolean };

export async function createNote(
  userId: string,
  input: unknown,
): Promise<CreateNoteResult> {
  const parsed = parseOrThrow(noteCreateInputSchema, input);

  // Offline idempotency (§25.5): replaying the same mutation returns the
  // stored note instead of creating a duplicate (same contract as
  // Trade.clientMutationId, v2 §4.2).
  if (parsed.clientMutationId) {
    const existing = await db.note.findFirst({
      where: { userId, clientMutationId: parsed.clientMutationId },
    });
    if (existing) {
      const [folders, tags] = await Promise.all([loadFolders(userId), loadTags(userId)]);
      const response = await noteResponse(userId, existing, folders, tags);
      return { ...response, deduplicated: true };
    }
  }

  let folderId: string | null = parsed.folderId ?? null;
  if (folderId !== null) {
    const folder = await db.noteFolder.findFirst({ where: { userId, id: folderId } });
    if (!folder) throw FOLDER_NOT_FOUND();
  }

  let template: GaiaBuiltInTemplate | GaiaTemplateDTO | null = null;
  if (parsed.templateId !== undefined) {
    template =
      findBuiltInTemplate(parsed.templateId) ??
      (await findUserTemplate(userId, parsed.templateId));
  }

  let blocks: GaiaBlock[];
  if (parsed.blocks !== undefined) {
    blocks = normalizeBlocks(parsed.blocks);
  } else if (template) {
    blocks = cloneBlocksWithNewIds(template.blocks);
  } else {
    blocks = [emptyParagraphBlock()];
  }
  assertSafeImageSources(blocks);

  const now = new Date();
  const note = await db.note.create({
    data: {
      userId,
      title: parsed.title?.trim() ?? "",
      icon: template?.icon ?? "📝",
      folderId,
      tagIds: "[]",
      favorite: false,
      templateId: template?.id ?? null,
      blocks: JSON.stringify(blocks),
      clientMutationId: parsed.clientMutationId ?? null,
      createdAt: now,
      updatedAt: now,
      lastViewedAt: now,
      deletedAt: null,
    },
  });
  const [folders, tags] = await Promise.all([loadFolders(userId), loadTags(userId)]);
  const response = await noteResponse(userId, note, folders, tags);
  return { ...response, deduplicated: false };
}

export async function updateNote(
  userId: string,
  noteId: string,
  input: unknown,
): Promise<GaiaNoteResponse> {
  const parsed = parseOrThrow(noteUpdateInputSchema, input);
  const note = await findActiveNote(userId, noteId);
  if (!note) throw NOTE_NOT_FOUND();

  // A note may only reference a folder owned by the same user. The create
  // path already enforces this; PATCH must enforce it before snapshotting or
  // writing so a foreign folder id cannot be attached to this note.
  if (parsed.folderId !== undefined && parsed.folderId !== null) {
    const folder = await db.noteFolder.findFirst({
      where: { userId, id: parsed.folderId },
      select: { id: true },
    });
    if (!folder) throw FOLDER_NOT_FOUND();
  }

  // Offline conflict check (§25.5): a content edit (title or blocks) made
  // from a stale base never silently overwrites the server row. The caller
  // gets a 409 with the server note and chooses (keep mine with force, or
  // keep the server version). Metadata-only patches (favorite, folder,
  // icon, tags) touch no content field and apply without a base check.
  const touchesContent =
    parsed.title !== undefined || parsed.blocks !== undefined;
  if (
    touchesContent &&
    parsed.expectedUpdatedAt !== undefined &&
    parsed.force !== true
  ) {
    const base = new Date(parsed.expectedUpdatedAt).getTime();
    if (Number.isFinite(base) && base !== note.updatedAt.getTime()) {
      const [folders, tags] = await Promise.all([loadFolders(userId), loadTags(userId)]);
      const server = await noteResponse(userId, note, folders, tags);
      throw conflictError("NOTE_CONFLICT", "Note edited elsewhere.", {
        note: server.note,
        baseUpdatedAt: parsed.expectedUpdatedAt,
        serverUpdatedAt: note.updatedAt.toISOString(),
      });
    }
  }

  const hasMeaningfulChange =
    parsed.title !== undefined ||
    parsed.icon !== undefined ||
    parsed.folderId !== undefined ||
    parsed.tagIds !== undefined ||
    parsed.favorite !== undefined ||
    parsed.blocks !== undefined;

  if (!hasMeaningfulChange) {
    if (parsed.touchViewed === true) {
      // Viewing metadata must not advance updatedAt: that timestamp is the
      // optimistic-concurrency token used by the editor's next content save.
      await db.note.updateMany({
        where: { userId, id: note.id, updatedAt: note.updatedAt },
        data: { lastViewedAt: new Date(), updatedAt: note.updatedAt },
      });
      const current = await findActiveNote(userId, note.id);
      if (!current) throw NOTE_NOT_FOUND();
      const [folders, tags] = await Promise.all([loadFolders(userId), loadTags(userId)]);
      return noteResponse(userId, current, folders, tags);
    }
    const [folders, tags] = await Promise.all([loadFolders(userId), loadTags(userId)]);
    return noteResponse(userId, note, folders, tags);
  }

  // Lot 11 (roadmap §15): a version snapshots CONTENT, not metadata.
  // Toggling a favorite, moving a folder or changing an icon used to
  // burn one of the 12 version slots with an identical copy of the note.
  const contentChanged =
    (parsed.title !== undefined && parsed.title.trim() !== note.title) ||
    (parsed.blocks !== undefined &&
      JSON.stringify(normalizeBlocks(parsed.blocks)) !== note.blocks);

  await maybeSnapshotVersion(userId, note, contentChanged);

  const data: {
    title?: string;
    icon?: string | null;
    folderId?: string | null;
    tagIds?: string;
    favorite?: boolean;
    blocks?: string;
    updatedAt: Date;
  } = { updatedAt: new Date() };
  if (parsed.title !== undefined) data.title = parsed.title.trim();
  if (parsed.icon !== undefined) data.icon = parsed.icon;
  if (parsed.folderId !== undefined) data.folderId = parsed.folderId;
  if (parsed.favorite !== undefined) data.favorite = parsed.favorite;
  if (parsed.tagIds !== undefined) {
    const known = await loadTags(userId);
    const knownIds = new Set(known.map((t) => t.id));
    data.tagIds = JSON.stringify(parsed.tagIds.filter((id) => knownIds.has(id)));
  }
  if (parsed.blocks !== undefined) {
    const blocks = normalizeBlocks(parsed.blocks);
    assertSafeImageSources(blocks);
    data.blocks = JSON.stringify(blocks);
  }

  const updated = await db.note.update({ where: { id: note.id }, data });
  const [folders, tags] = await Promise.all([loadFolders(userId), loadTags(userId)]);
  return noteResponse(userId, updated, folders, tags);
}

export async function trashNote(userId: string, noteId: string): Promise<{ ok: true }> {
  const note = await findActiveNote(userId, noteId);
  if (!note) throw NOTE_NOT_FOUND();
  await db.note.update({ where: { id: note.id }, data: { deletedAt: new Date() } });
  return { ok: true };
}

export async function restoreNote(userId: string, noteId: string): Promise<{ ok: true }> {
  const note = await findNoteAnyState(userId, noteId);
  if (!note || note.deletedAt === null) throw NOTE_NOT_FOUND();
  await db.note.update({
    where: { id: note.id },
    data: { deletedAt: null, updatedAt: new Date() },
  });
  return { ok: true };
}

export async function purgeNote(userId: string, noteId: string): Promise<{ ok: true }> {
  const note = await findNoteAnyState(userId, noteId);
  if (!note || note.deletedAt === null) throw NOTE_NOT_FOUND();
  await db.noteVersion.deleteMany({ where: { userId, noteId: note.id } });
  await db.note.delete({ where: { id: note.id } });
  return { ok: true };
}

export async function duplicateNote(
  userId: string,
  noteId: string,
  input: unknown,
): Promise<GaiaNoteResponse> {
  const parsed = parseOrThrow(noteDuplicateInputSchema, input ?? {});
  const source = await findActiveNote(userId, noteId);
  if (!source) throw NOTE_NOT_FOUND();
  const title =
    parsed.title?.trim() ??
    (source.title === "" ? "Untitled note (copy)" : `${source.title} (copy)`);
  const now = new Date();
  const copy = await db.note.create({
    data: {
      userId,
      title,
      icon: source.icon,
      folderId: source.folderId,
      tagIds: source.tagIds,
      favorite: false,
      templateId: source.templateId,
      blocks: JSON.stringify(cloneBlocksWithNewIds(parseJsonBlocks(source.blocks))),
      createdAt: now,
      updatedAt: now,
      lastViewedAt: now,
      deletedAt: null,
    },
  });
  const [folders, tags] = await Promise.all([loadFolders(userId), loadTags(userId)]);
  return noteResponse(userId, copy, folders, tags);
}

/* ── Versions ────────────────────────────────────────────────────────── */

export async function listVersions(
  userId: string,
  noteId: string,
): Promise<{ versions: GaiaVersionSummary[] }> {
  const versions = await versionsOf(userId, noteId);
  return {
    versions: versions.map((v) => ({
      id: v.id,
      title: v.title,
      savedAt: v.savedAt.toISOString(),
      wordCount: countWords(parseJsonBlocks(v.blocks)),
    })),
  };
}

export async function getVersion(
  userId: string,
  noteId: string,
  versionId: string,
): Promise<{ version: GaiaVersionDetail }> {
  const version = await db.noteVersion.findFirst({
    where: { userId, noteId, id: versionId },
  });
  if (!version) throw VERSION_NOT_FOUND();
  return {
    version: {
      id: version.id,
      title: version.title,
      savedAt: version.savedAt.toISOString(),
      blocks: parseJsonBlocks(version.blocks),
    },
  };
}

export async function restoreVersion(
  userId: string,
  noteId: string,
  versionId: string,
): Promise<GaiaNoteResponse> {
  const note = await findActiveNote(userId, noteId);
  if (!note) throw NOTE_NOT_FOUND();
  const version = await db.noteVersion.findFirst({
    where: { userId, noteId, id: versionId },
  });
  if (!version) throw VERSION_NOT_FOUND();
  await maybeSnapshotVersion(userId, note);
  const updated = await db.note.update({
    where: { id: note.id },
    data: {
      title: version.title,
      blocks: JSON.stringify(cloneBlocksWithNewIds(parseJsonBlocks(version.blocks))),
      updatedAt: new Date(),
    },
  });
  const [folders, tags] = await Promise.all([loadFolders(userId), loadTags(userId)]);
  return noteResponse(userId, updated, folders, tags);
}

/* ── Dossiers ────────────────────────────────────────────────────────── */

export async function listFolders(userId: string): Promise<{ folders: GaiaFolderDTO[] }> {
  const [folders, notes] = await Promise.all([
    loadFolders(userId),
    db.note.findMany({ where: { userId, deletedAt: null } }),
  ]);
  return {
    folders: folders.map((folder) => ({
      ...folder,
      noteCount: notes.filter((n) => n.folderId === folder.id).length,
    })),
  };
}

export async function createFolder(userId: string, input: unknown): Promise<GaiaFolderDTO> {
  const parsed = parseOrThrow(folderInputSchema, input);
  const name = parsed.name.trim();
  if (name === "") {
    throw validationError("The folder name is required.", [
      { path: "name", message: "The folder name is required." },
    ]);
  }
  const folders = await loadFolders(userId);
  if (folders.some((f) => nameKeyOf(f.name) === nameKeyOf(name))) {
    throw conflictError("FOLDER_EXISTS", "A folder with this name already exists.");
  }
  const folder = await db.noteFolder.create({ data: { userId, name } });
  return { ...folder, noteCount: 0 };
}

export async function updateFolder(
  userId: string,
  folderId: string,
  input: unknown,
): Promise<GaiaFolderDTO> {
  const parsed = parseOrThrow(folderInputSchema, input);
  const name = parsed.name.trim();
  if (name === "") {
    throw validationError("The folder name is required.", [
      { path: "name", message: "The folder name is required." },
    ]);
  }
  const folder = await db.noteFolder.findFirst({ where: { userId, id: folderId } });
  if (!folder) throw FOLDER_NOT_FOUND();
  const folders = await loadFolders(userId);
  if (
    folders.some((f) => f.id !== folder.id && nameKeyOf(f.name) === nameKeyOf(name))
  ) {
    throw conflictError("FOLDER_EXISTS", "A folder with this name already exists.");
  }
  const updated = await db.noteFolder.update({ where: { id: folder.id }, data: { name } });
  const noteCount = await db.note.count({
    where: { userId, folderId: folder.id, deletedAt: null },
  });
  return { ...updated, noteCount };
}

export async function deleteFolder(userId: string, folderId: string): Promise<{ ok: true }> {
  const folder = await db.noteFolder.findFirst({ where: { userId, id: folderId } });
  if (!folder) throw FOLDER_NOT_FOUND();
  await db.note.updateMany({
    where: { userId, folderId: folder.id },
    data: { folderId: null },
  });
  await db.noteFolder.delete({ where: { id: folder.id } });
  return { ok: true };
}

/* ── Tags ────────────────────────────────────────────────────────────── */

export async function listTags(userId: string): Promise<{ tags: GaiaTagDTO[] }> {
  const [tags, notes] = await Promise.all([
    loadTags(userId),
    db.note.findMany({ where: { userId, deletedAt: null } }),
  ]);
  const withCounts = tags.map((tag) => ({
    ...tag,
    noteCount: notes.filter((n) => parseJsonStringArray(n.tagIds).includes(tag.id)).length,
  }));
  withCounts.sort((a, b) => b.noteCount - a.noteCount || a.name.localeCompare(b.name));
  return { tags: withCounts };
}

export async function createTag(userId: string, input: unknown): Promise<GaiaTagDTO> {
  const parsed = parseOrThrow(tagInputSchema, input);
  const name = normalizeTagName(parsed.name);
  if (name === "") {
    throw validationError("The tag name is required.", [
      { path: "name", message: "The tag name is required." },
    ]);
  }
  const tags = await loadTags(userId);
  const existing = tags.find((t) => nameKeyOf(t.name) === nameKeyOf(name));
  if (existing) {
    const notes = await db.note.findMany({ where: { userId, deletedAt: null } });
    return {
      ...existing,
      noteCount: notes.filter((n) =>
        parseJsonStringArray(n.tagIds).includes(existing.id),
      ).length,
    };
  }
  const tag = await db.noteTag.create({ data: { userId, name } });
  return { ...tag, noteCount: 0 };
}

/* ── Modèles ─────────────────────────────────────────────────────────── */

function userTemplateToDTO(template: NoteTemplate): GaiaTemplateDTO {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    icon: template.icon,
    blocks: parseJsonBlocks(template.blocks),
    builtIn: template.builtIn,
    createdAt: template.createdAt.toISOString(),
  };
}

function builtInToDTO(template: GaiaBuiltInTemplate): GaiaTemplateDTO {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    icon: template.icon,
    blocks: template.blocks,
    builtIn: true,
    createdAt: template.createdAt,
  };
}

async function findUserTemplate(
  userId: string,
  templateId: string,
): Promise<GaiaTemplateDTO | null> {
  const row = await db.noteTemplate.findFirst({ where: { userId, id: templateId } });
  return row ? userTemplateToDTO(row) : null;
}

export async function listTemplates(userId: string): Promise<{ templates: GaiaTemplateDTO[] }> {
  const userTemplates = await db.noteTemplate.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return {
    templates: [
      ...builtInTemplates().map(builtInToDTO),
      ...userTemplates.map(userTemplateToDTO),
    ],
  };
}

export async function createTemplate(
  userId: string,
  input: unknown,
): Promise<GaiaTemplateDTO> {
  const parsed = parseOrThrow(templateCreateInputSchema, input);
  let blocks: GaiaBlock[];
  if (parsed.blocks !== undefined) {
    blocks = normalizeBlocks(parsed.blocks);
  } else if (parsed.fromNoteId !== undefined) {
    const note = await findActiveNote(userId, parsed.fromNoteId);
    if (!note) throw NOTE_NOT_FOUND();
    blocks = stripRefs(cloneBlocksWithNewIds(parseJsonBlocks(note.blocks)));
  } else {
    blocks = [emptyParagraphBlock()];
  }
  assertSafeImageSources(blocks);
  const template = await db.noteTemplate.create({
    data: {
      userId,
      name: parsed.name.trim(),
      description: parsed.description.trim(),
      icon: parsed.icon || "📄",
      blocks: JSON.stringify(blocks),
      builtIn: false,
    },
  });
  return userTemplateToDTO(template);
}

export async function instantiateTemplate(
  userId: string,
  input: unknown,
): Promise<GaiaNoteResponse> {
  const parsed = parseOrThrow(templateInstantiateInputSchema, input);
  const template =
    findBuiltInTemplate(parsed.templateId) ??
    (await findUserTemplate(userId, parsed.templateId));
  if (!template) throw TEMPLATE_NOT_FOUND();
  return createNote(userId, {
    title: parsed.title?.trim() || template.name,
    folderId: parsed.folderId ?? null,
    templateId: template.id,
  });
}

/* ── Overview ────────────────────────────────────────────────────────── */

function startOfWeekMondayUTC(now: Date): Date {
  const day = now.getUTCDay();
  const mondayOffset = (day + 6) % 7;
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - mondayOffset),
  );
  return monday;
}

export async function getOverview(userId: string): Promise<GaiaOverviewResponse> {
  const [folders, tags, allNotes] = await Promise.all([
    loadFolders(userId),
    loadTags(userId),
    // Phase 2 perf (item 8) — narrow select, no blocks: counts, folders,
    // tags and activity need scalars only. Blocks load once, bounded to
    // the ≤16 rows actually displayed below.
    db.note.findMany({ where: { userId }, select: NOTE_LIST_SELECT }),
  ]);
  const active = allNotes.filter((n) => n.deletedAt === null);
  const trashed = allNotes.filter((n) => n.deletedAt !== null);
  const weekAgo = Date.now() - 7 * 86_400_000;

  const recentEdited = [...active]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 6);
  const recentViewed = active
    .filter((n) => n.lastViewedAt !== null)
    .sort((a, b) => (b.lastViewedAt?.getTime() ?? 0) - (a.lastViewedAt?.getTime() ?? 0))
    .slice(0, 5);
  const favorites = active
    .filter((n) => n.favorite)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 5);

  const blocksById = await loadBlocksFor([
    ...new Set(
      [...recentEdited, ...recentViewed, ...favorites].map((n) => n.id)
    ),
  ]);
  const toDisplayRow = (n: NoteListRow): GaiaNoteRow =>
    toRow({ ...n, blocks: blocksById.get(n.id) ?? "[]" }, folders, tags);

  const foldersWithCounts: GaiaFolderDTO[] = folders
    .map((folder) => ({
      ...folder,
      noteCount: active.filter((n) => n.folderId === folder.id).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const tagsWithCounts: GaiaTagDTO[] = tags
    .map((tag) => ({
      ...tag,
      noteCount: active.filter((n) =>
        parseJsonStringArray(n.tagIds).includes(tag.id),
      ).length,
    }))
    .sort((a, b) => b.noteCount - a.noteCount || a.name.localeCompare(b.name));

  const monday = startOfWeekMondayUTC(new Date());
  const activity: GaiaActivityWeek[] = [];
  for (let offset = 7; offset >= 0; offset--) {
    const weekStartMs = monday.getTime() - offset * 7 * 86_400_000;
    const weekEndMs = weekStartMs + 7 * 86_400_000;
    const createdInWeek = active.filter(
      (n) => n.createdAt.getTime() >= weekStartMs && n.createdAt.getTime() < weekEndMs,
    );
    const createdIds = new Set(createdInWeek.map((n) => n.id));
    const editedInWeek = active.filter(
      (n) =>
        n.updatedAt.getTime() >= weekStartMs &&
        n.updatedAt.getTime() < weekEndMs &&
        !createdIds.has(n.id),
    );
    activity.push({
      weekStart: new Date(weekStartMs).toISOString().slice(0, 10),
      created: createdInWeek.length,
      edited: editedInWeek.length,
    });
  }

  const { templates } = await listTemplates(userId);

  return {
    totals: {
      notes: active.length,
      createdThisWeek: active.filter((n) => n.createdAt.getTime() >= weekAgo).length,
      favorites: active.filter((n) => n.favorite).length,
      folders: folders.length,
      tags: tags.length,
      trashed: trashed.length,
    },
    recentEdited: recentEdited.map(toDisplayRow),
    recentViewed: recentViewed.map(toDisplayRow),
    favorites: favorites.map(toDisplayRow),
    folders: foldersWithCounts,
    topTags: tagsWithCounts.slice(0, 8),
    activity,
    templates: templates.slice(0, 4),
  };
}

/* ── Recherche ───────────────────────────────────────────────────────── */

export async function searchNotes(
  userId: string,
  q: string,
): Promise<{ results: (GaiaNoteRow & { snippet: string })[]; total: number }> {
  const [folders, tags, notes] = await Promise.all([
    loadFolders(userId),
    loadTags(userId),
    db.note.findMany({ where: { userId, deletedAt: null } }),
  ]);
  // Lot 11 (roadmap §15): ranked search - a title hit outranks a tag
  // hit, which outranks a body hit; every query token must match (AND).
  // `total` is the real match count, not the page size.
  const ranked = rankSearchNotes(
    notes.map((note) => {
      const blocks = parseJsonBlocks(note.blocks);
      return {
        note,
        blocks,
        title: note.title,
        tagNames: tagNamesOf(parseJsonStringArray(note.tagIds), tags),
        bodyText: searchTextOfBlocks(blocks),
        updatedAt: note.updatedAt.toISOString(),
      };
    }),
    q,
  );
  const total = ranked.length;
  const tokens = searchTokens(q);
  const results = ranked.slice(0, 30).map(({ note, blocks }) => {
    const row = toRow(note, folders, tags);
    // Match against the same indexed text used for ranking (pattern names
    // and aliases included), so a pattern-only hit still gets a snippet
    // centered on the pattern instead of an empty excerpt.
    const bodyHit = tokens.some((token) =>
      foldSearchText(searchTextOfBlocks(blocks)).includes(token),
    );
    return {
      ...row,
      snippet: bodyHit ? searchSnippet(blocks, q) : excerptOf(blocks),
    };
  });
  return { results, total };
}

/* ── Refs ────────────────────────────────────────────────────────────── */

export async function listGaiaRefs(
  userId: string,
  q: string,
  kind?: string,
): Promise<{ refs: GaiaRefHit[] }> {
  const refs = await listRefsRaw(userId, q, kind);
  return { refs };
}

export async function listLinkedNotes(
  userId: string,
  kind: GaiaRefKind,
  id: string,
): Promise<{ notes: GaiaNoteRow[]; total: number }> {
  return listNotes(userId, { refKind: kind, refId: id });
}
