import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  noteFindFirst: vi.fn(),
  folderFindFirst: vi.fn(),
  noteUpdate: vi.fn(),
  versionFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    note: {
      findFirst: mocks.noteFindFirst,
      update: mocks.noteUpdate,
    },
    noteFolder: {
      findFirst: mocks.folderFindFirst,
    },
    noteVersion: {
      findMany: mocks.versionFindMany,
    },
  },
}));

import { updateNote } from "@/server/gaia";

const existingNote = {
  id: "note-owned-by-user-a",
  userId: "user-a",
  title: "Private note",
  icon: "📝",
  folderId: null,
  tagIds: "[]",
  favorite: false,
  templateId: null,
  blocks: "[]",
  lastViewedAt: null,
  deletedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("Gaïa updateNote folder ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.noteFindFirst.mockResolvedValue(existingNote);
    mocks.folderFindFirst.mockResolvedValue(null);
  });

  it("rejects a folder that is not owned by the note's user before writing", async () => {
    await expect(
      updateNote("user-a", existingNote.id, { folderId: "folder-owned-by-user-b" }),
    ).rejects.toMatchObject({
      code: "FOLDER_NOT_FOUND",
      status: 404,
    });

    expect(mocks.noteFindFirst).toHaveBeenCalledWith({
      where: { userId: "user-a", id: existingNote.id, deletedAt: null },
    });
    expect(mocks.folderFindFirst).toHaveBeenCalledWith({
      where: { userId: "user-a", id: "folder-owned-by-user-b" },
      select: { id: true },
    });
    expect(mocks.versionFindMany).not.toHaveBeenCalled();
    expect(mocks.noteUpdate).not.toHaveBeenCalled();
  });
});
