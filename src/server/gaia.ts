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
import type { Note, NoteFolder, NoteTag, NoteTemplate, NoteVersion } from "@prisma/client";
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
  textOfBlocks,
  type GaiaBlock,
  type GaiaRefKind,
} from "@/lib/gaia/content";
import { builtInTemplates, findBuiltInTemplate, type GaiaBuiltInTemplate } from "@/lib/gaia/templates";
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
  constructor(
    error: string,
    code: string,
    status: number,
    message: string,
    issues?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = "GaiaError";
    this.error = error;
    this.code = code;
    this.status = status;
    this.issues = issues;
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

function conflictError(code: string, message: string): GaiaError {
  return new GaiaError("Conflict", code, 409, message);
}

const NOTE_NOT_FOUND = () => notFound("NOTE_NOT_FOUND", "Note not found.");
const FOLDER_NOT_FOUND = () => notFound("FOLDER_NOT_FOUND", "Folder not found.");
const TEMPLATE_NOT_FOUND = () => notFound("TEMPLATE_NOT_FOUND", "Template not found.");
const VERSION_NOT_FOUND = () => notFound("VERSION_NOT_FOUND", "Version not found.");

/**
 * Convertit une GaiaError en réponse HTTP ({ error, code?, message?, issues? }).
 * Retourne null pour les autres erreurs (à passer à apiError).
 */
export function gaiaErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof GaiaError)) return null;
  return NextResponse.json(
    {
      error: error.error,
      code: error.code,
      message: error.message,
      ...(error.issues ? { issues: error.issues } : {}),
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
});

const noteUpdateInputSchema = z.object({
  title: z.string().max(200).optional(),
  icon: z.string().max(16).nullable().optional(),
  folderId: z.string().nullable().optional(),
  tagIds: z.array(z.string()).max(24).optional(),
  favorite: z.boolean().optional(),
  blocks: gaiaBlocksInputSchema.optional(),
  touchViewed: z.boolean().optional(),
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

function toRow(note: Note, folders: NoteFolder[], tags: NoteTag[]): GaiaNoteRow {
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

async function maybeSnapshotVersion(userId: string, note: Note): Promise<void> {
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
};

export async function listNotes(
  userId: string,
  query: GaiaListQuery,
): Promise<{ notes: GaiaNoteRow[]; total: number }> {
  const [folders, tags, all] = await Promise.all([
    loadFolders(userId),
    loadTags(userId),
    db.note.findMany({ where: { userId } }),
  ]);

  if (query.refKind !== undefined && query.refId !== undefined) {
    const parsed = gaiaRefKindSchema.safeParse(query.refKind);
    if (!parsed.success) {
      throw validationError("Invalid reference type.");
    }
    const kind = parsed.data;
    const linked = all.filter(
      (note) =>
        note.deletedAt === null &&
        parseJsonBlocks(note.blocks).some(
          (b) => b.type === "ref" && b.ref?.kind === kind && b.ref.id === query.refId,
        ),
    );
    const rows = linked
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map((note) => toRow(note, folders, tags));
    return { notes: rows, total: rows.length };
  }

  const view = query.view ?? "all";
  let scoped = all;
  if (view === "trash") {
    scoped = all.filter((n) => n.deletedAt !== null);
  } else {
    scoped = all.filter((n) => n.deletedAt === null);
    if (view === "favorites") scoped = scoped.filter((n) => n.favorite);
    else if (view === "recent") scoped = scoped.filter((n) => n.lastViewedAt !== null);
    else if (view === "folder" && query.folderId) {
      scoped = scoped.filter((n) => n.folderId === query.folderId);
    } else if (view === "tag" && query.tagId) {
      scoped = scoped.filter((n) => parseJsonStringArray(n.tagIds).includes(query.tagId as string));
    }
  }

  const q = (query.q ?? "").trim().toLowerCase();
  if (q !== "") {
    scoped = scoped.filter((note) => {
      const blocks = parseJsonBlocks(note.blocks);
      const tagIds = parseJsonStringArray(note.tagIds);
      return (
        note.title.toLowerCase().includes(q) ||
        textOfBlocks(blocks).toLowerCase().includes(q) ||
        tagNamesOf(tagIds, tags).some((name) => name.toLowerCase().includes(q)) ||
        (folderNameOf(note.folderId, folders) ?? "").toLowerCase().includes(q)
      );
    });
  }

  const sort = query.sort ?? "updated";
  const sorted = [...scoped].sort((a, b) => {
    if (sort === "created") return b.createdAt.getTime() - a.createdAt.getTime();
    if (sort === "title") return a.title.localeCompare(b.title);
    if (sort === "viewed") {
      return (b.lastViewedAt?.getTime() ?? 0) - (a.lastViewedAt?.getTime() ?? 0);
    }
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });

  const rows = sorted.map((note) => toRow(note, folders, tags));
  return { notes: rows, total: rows.length };
}

export async function getNote(
  userId: string,
  noteId: string,
): Promise<GaiaNoteResponse> {
  const note = await findActiveNote(userId, noteId);
  if (!note) throw NOTE_NOT_FOUND();
  const now = new Date();
  const updated = await db.note.update({
    where: { id: note.id },
    data: { lastViewedAt: now },
  });
  const [folders, tags] = await Promise.all([loadFolders(userId), loadTags(userId)]);
  return noteResponse(userId, updated, folders, tags);
}

/* ── Notes : écriture ────────────────────────────────────────────────── */

export async function createNote(
  userId: string,
  input: unknown,
): Promise<GaiaNoteResponse> {
  const parsed = parseOrThrow(noteCreateInputSchema, input);

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
      createdAt: now,
      updatedAt: now,
      lastViewedAt: now,
      deletedAt: null,
    },
  });
  const [folders, tags] = await Promise.all([loadFolders(userId), loadTags(userId)]);
  return noteResponse(userId, note, folders, tags);
}

export async function updateNote(
  userId: string,
  noteId: string,
  input: unknown,
): Promise<GaiaNoteResponse> {
  const parsed = parseOrThrow(noteUpdateInputSchema, input);
  const note = await findActiveNote(userId, noteId);
  if (!note) throw NOTE_NOT_FOUND();

  const hasMeaningfulChange =
    parsed.title !== undefined ||
    parsed.icon !== undefined ||
    parsed.folderId !== undefined ||
    parsed.tagIds !== undefined ||
    parsed.favorite !== undefined ||
    parsed.blocks !== undefined;

  if (!hasMeaningfulChange) {
    if (parsed.touchViewed === true) {
      const touched = await db.note.update({
        where: { id: note.id },
        data: { lastViewedAt: new Date() },
      });
      const [folders, tags] = await Promise.all([loadFolders(userId), loadTags(userId)]);
      return noteResponse(userId, touched, folders, tags);
    }
    const [folders, tags] = await Promise.all([loadFolders(userId), loadTags(userId)]);
    return noteResponse(userId, note, folders, tags);
  }

  await maybeSnapshotVersion(userId, note);

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
    (source.title === "" ? "Untitled note (copy)" : `${source.title} (copie)`);
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
    db.note.findMany({ where: { userId } }),
  ]);
  const active = allNotes.filter((n) => n.deletedAt === null);
  const trashed = allNotes.filter((n) => n.deletedAt !== null);
  const weekAgo = Date.now() - 7 * 86_400_000;

  const recentEdited = [...active]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 6)
    .map((n) => toRow(n, folders, tags));
  const recentViewed = active
    .filter((n) => n.lastViewedAt !== null)
    .sort((a, b) => (b.lastViewedAt?.getTime() ?? 0) - (a.lastViewedAt?.getTime() ?? 0))
    .slice(0, 5)
    .map((n) => toRow(n, folders, tags));
  const favorites = active
    .filter((n) => n.favorite)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 5)
    .map((n) => toRow(n, folders, tags));

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
    recentEdited,
    recentViewed,
    favorites,
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
  const query = q.trim().toLowerCase();
  if (query === "") return { results: [], total: 0 };
  const [folders, tags, notes] = await Promise.all([
    loadFolders(userId),
    loadTags(userId),
    db.note.findMany({ where: { userId, deletedAt: null } }),
  ]);
  const results: (GaiaNoteRow & { snippet: string })[] = [];
  for (const note of notes) {
    const blocks = parseJsonBlocks(note.blocks);
    const tagIds = parseJsonStringArray(note.tagIds);
    const titleHit = note.title.toLowerCase().includes(query);
    const fullText = textOfBlocks(blocks);
    const textHit = fullText.toLowerCase().includes(query);
    const tagHit = tagNamesOf(tagIds, tags).some((name) =>
      name.toLowerCase().includes(query),
    );
    if (!titleHit && !textHit && !tagHit) continue;
    const row = toRow(note, folders, tags);
    results.push({
      ...row,
      snippet: textHit ? searchSnippet(blocks, query) : excerptOf(blocks),
    });
  }
  results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const sliced = results.slice(0, 30);
  return { results: sliced, total: sliced.length };
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
