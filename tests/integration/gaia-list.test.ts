/**
 * Phase 2 perf item 8 — Gaïa listNotes / getOverview (PostgreSQL schema promethe_test).
 *
 * listNotes paginates in SQL (filter + orderBy + take/skip, blocks only
 * for the page rows); text search and ref views keep their in-memory
 * matching, then paginate. getOverview reads scalars once and loads
 * blocks only for the ≤16 rows it displays.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createUserWithDefaults } from "@/server/users";
import { getOverview, listNotes } from "@/server/gaia";

let user: { id: string };
let folderId: string;
let tagId: string;
const ids: Record<string, string> = {};

const paragraph = (id: string, text: string) => ({ id, type: "paragraph", text });
const todo = (id: string, text: string, checked: boolean) => ({
  id,
  type: "todo",
  text,
  checked,
});

beforeAll(async () => {
  const created = await createUserWithDefaults({
    email: "gaia-list@test.local",
    password: "test-password-123",
    displayName: "Gaia List Test",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  user = created.user;
  const folder = await db.noteFolder.create({
    data: { userId: user.id, name: "Work" },
  });
  folderId = folder.id;
  const tag = await db.noteTag.create({
    data: { userId: user.id, name: "XAUUSD" },
  });
  tagId = tag.id;

  // Dates relative to "now" (12:00 UTC, N days ago): the 7-day
  // createdThisWeek window keeps 1+ day of slack either way.
  const daysAgo = (n: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - n);
    d.setUTCHours(12, 0, 0, 0);
    return d;
  };

  const seed = async (
    key: string,
    data: {
      title: string;
      folderId?: string | null;
      tagIds?: string[];
      favorite?: boolean;
      blocks: unknown[];
      createdAt: Date;
      updatedAt: Date;
      lastViewedAt?: Date | null;
      deletedAt?: Date | null;
    }
  ) => {
    const row = await db.note.create({
      data: {
        userId: user.id,
        title: data.title,
        icon: "📝",
        folderId: data.folderId ?? null,
        tagIds: JSON.stringify(data.tagIds ?? []),
        favorite: data.favorite ?? false,
        templateId: null,
        blocks: JSON.stringify(data.blocks),
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        lastViewedAt: data.lastViewedAt ?? null,
        deletedAt: data.deletedAt ?? null,
      },
    });
    ids[key] = row.id;
    return row;
  };

  await seed("alpha", {
    title: "Alpha",
    folderId,
    tagIds: [tagId],
    favorite: true,
    blocks: [
      paragraph("b1", "hello alpha world"),
      todo("b2", "buy milk", false),
    ],
    createdAt: daysAgo(8),
    updatedAt: daysAgo(1),
    lastViewedAt: daysAgo(1),
  });
  await seed("beta", {
    title: "Beta",
    blocks: [paragraph("b1", "beta content")],
    createdAt: daysAgo(6),
    updatedAt: daysAgo(2),
    lastViewedAt: null,
  });
  await seed("gamma", {
    title: "Gamma",
    folderId,
    favorite: true,
    blocks: [
      paragraph("b1", "gamma notes"),
      { id: "b2", type: "ref", text: "", ref: { kind: "TRADE", id: "trade-1" } },
    ],
    createdAt: daysAgo(5),
    updatedAt: daysAgo(3),
    lastViewedAt: daysAgo(3),
  });
  await seed("delta", {
    title: "Delta",
    blocks: [paragraph("b1", "delta trashed")],
    createdAt: daysAgo(9),
    updatedAt: daysAgo(4),
    deletedAt: daysAgo(2),
  });
  await seed("epsilon", {
    title: "Epsilon",
    blocks: [paragraph("b1", "epsilon")],
    createdAt: daysAgo(4),
    updatedAt: daysAgo(5),
    lastViewedAt: daysAgo(5),
  });
  await seed("zeta", {
    title: "Zeta",
    blocks: [paragraph("b1", "zeta")],
    createdAt: daysAgo(3),
    updatedAt: daysAgo(6),
    lastViewedAt: null,
  });
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [user.id] } } });
  await db.$disconnect();
});

describe("listNotes (SQL pagination)", () => {
  it("lists active notes, updated first, with block-derived row fields", async () => {
    const { notes, total } = await listNotes(user.id, {});
    expect(total).toBe(5);
    expect(notes.map((n) => n.id)).toEqual([
      ids.alpha,
      ids.beta,
      ids.gamma,
      ids.epsilon,
      ids.zeta,
    ]);
    const alpha = notes[0];
    expect(alpha.excerpt).toBe("hello alpha world · buy milk");
    expect(alpha.wordCount).toBe(5);
    expect(alpha.blockCount).toBe(2);
    expect(alpha.todoOpen).toBe(1);
    expect(alpha.refCount).toBe(0);
    expect(alpha.tagNames).toEqual(["XAUUSD"]);
    expect(alpha.folderName).toBe("Work");
    expect(notes[2].refCount).toBe(1);
  });

  it("paginates (pageSize 2)", async () => {
    const p1 = await listNotes(user.id, { page: 1, pageSize: 2 });
    expect(p1.total).toBe(5);
    expect(p1.notes.map((n) => n.id)).toEqual([ids.alpha, ids.beta]);
    const p2 = await listNotes(user.id, { page: 2, pageSize: 2 });
    expect(p2.notes.map((n) => n.id)).toEqual([ids.gamma, ids.epsilon]);
    const p3 = await listNotes(user.id, { page: 3, pageSize: 2 });
    expect(p3.notes.map((n) => n.id)).toEqual([ids.zeta]);
  });

  it("filters by view (favorites, trash, folder, tag)", async () => {
    const fav = await listNotes(user.id, { view: "favorites" });
    expect(fav.total).toBe(2);
    expect(fav.notes.map((n) => n.id)).toEqual([ids.alpha, ids.gamma]);
    const trash = await listNotes(user.id, { view: "trash" });
    expect(trash.total).toBe(1);
    expect(trash.notes[0].id).toBe(ids.delta);
    const folder = await listNotes(user.id, { view: "folder", folderId });
    expect(folder.total).toBe(2);
    const tag = await listNotes(user.id, { view: "tag", tagId });
    expect(tag.total).toBe(1);
    expect(tag.notes[0].id).toBe(ids.alpha);
  });

  it("sorts by title and by viewed (nulls last)", async () => {
    const byTitle = await listNotes(user.id, { sort: "title" });
    expect(byTitle.notes.map((n) => n.title)).toEqual([
      "Alpha",
      "Beta",
      "Epsilon",
      "Gamma",
      "Zeta",
    ]);
    const byViewed = await listNotes(user.id, { sort: "viewed" });
    expect(byViewed.notes.slice(0, 3).map((n) => n.id)).toEqual([
      ids.alpha,
      ids.gamma,
      ids.epsilon,
    ]);
    expect(byViewed.notes.slice(3).every((n) => n.lastViewedAt === null)).toBe(true);
  });

  it("searches titles, block text and tag names", async () => {
    expect((await listNotes(user.id, { q: "beta" })).notes.map((n) => n.id)).toEqual([
      ids.beta,
    ]);
    expect((await listNotes(user.id, { q: "alpha" })).notes.map((n) => n.id)).toEqual([
      ids.alpha,
    ]);
    expect((await listNotes(user.id, { q: "xauusd" })).notes.map((n) => n.id)).toEqual([
      ids.alpha,
    ]);
    expect((await listNotes(user.id, { q: "zzz-no-match" })).total).toBe(0);
  });

  it("finds notes linked to a reference", async () => {
    const linked = await listNotes(user.id, {
      refKind: "TRADE",
      refId: "trade-1",
    });
    expect(linked.total).toBe(1);
    expect(linked.notes[0].id).toBe(ids.gamma);
  });
});

describe("getOverview", () => {
  it("returns totals, counts and displayed rows with excerpts", async () => {
    const overview = await getOverview(user.id);
    expect(overview.totals).toEqual({
      notes: 5,
      createdThisWeek: 4,
      favorites: 2,
      folders: 1,
      tags: 1,
      trashed: 1,
    });
    expect(overview.recentEdited.map((n) => n.id)).toEqual([
      ids.alpha,
      ids.beta,
      ids.gamma,
      ids.epsilon,
      ids.zeta,
    ]);
    expect(overview.recentEdited[0].excerpt).toBe("hello alpha world · buy milk");
    expect(overview.favorites.map((n) => n.id)).toEqual([ids.alpha, ids.gamma]);
    expect(overview.folders[0].noteCount).toBe(2);
    expect(overview.topTags[0].noteCount).toBe(1);
  });
});
