/**
 * v3 Phase 5 — mentor flow integration tests (db/test.db).
 *
 * Proves the security model end-to-end:
 *  - invitations: single-use token, email-match gate (wrong account → neutral
 *    404), handle requirement, reactivation on re-invite
 *  - scoped reads: account/strategy filters, STRUCTURAL redaction (amounts,
 *    account info, journal, psychology — absent from payloads, not hidden)
 *  - immediate effect: pause and revoke deny the very next request
 *  - comments: canComment gate, mentions limited to CURRENT access holders,
 *    tombstones, read states, notifications (COMMENT_NEW / REPLY / MENTION)
 *  - owner tools: mentee summaries, access log, self-mentorat denied
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ── Mock next/headers BEFORE any server import that touches cookies() ──────
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: () => undefined,
    delete: () => undefined,
  }),
}));

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { createUserWithDefaults, setHandle } from "@/server/users";
import {
  acceptInvitation,
  createInvitation,
  listMentees,
  listMentors,
  requireMentorContext,
  revokeAccess,
  updateAccess,
} from "@/server/mentors";
import {
  createComment,
  deleteComment,
  editComment,
  listComments,
  markTradeRead,
  unreadCommentCount,
} from "@/server/comments";
import {
  getMentorAnalytics,
  getMentorTradeDetail,
  listMentorJournal,
  listMentorTrades,
} from "@/server/mentor-views";
import { AccessDeniedError } from "@/lib/access";

let ownerId: string;
let mentorId: string;
let outsiderId: string;
let account1Id: string;
let account2Id: string;
let strategy1Id: string;
let trade1Id: string;
let trade2Id: string;
let trade3Id: string;
let invitationToken: string;
let tradeSeed: Omit<Prisma.TradeUncheckedCreateInput, "accountId" | "entryTime">;

beforeAll(async () => {
  const instrument = await db.instrument.create({
    data: {
      userId: null,
      symbol: "XAUUSD",
      name: "Or / Dollar US",
      assetClass: "METAL",
      quoteCurrency: "USD",
      digits: 2,
      pipSize: "0.10",
      pointSize: "0.01",
      contractSize: "100",
    },
  });

  const owner = await createUserWithDefaults({
    email: "owner@test.local",
    password: "password1",
    displayName: "Olive Owner",
    timezone: "UTC",
    baseCurrency: "USD",
    locale: "fr",
  });
  const mentor = await createUserWithDefaults({
    email: "mentor@test.local",
    password: "password1",
    displayName: "Morris Mentor",
    timezone: "UTC",
    baseCurrency: "USD",
    locale: "fr",
  });
  const outsider = await createUserWithDefaults({
    email: "outsider@test.local",
    password: "password1",
    displayName: "Olga Outsider",
    timezone: "UTC",
    baseCurrency: "USD",
    locale: "fr",
  });
  ownerId = owner.user.id;
  mentorId = mentor.user.id;
  outsiderId = outsider.user.id;

  // Handles: owner + mentor get one; outsider too (for mention negativity).
  await setHandle(ownerId, "olive_fx", "Olive");
  await setHandle(mentorId, "morris_fx");
  await setHandle(outsiderId, "olga_x");

  const accounts = await db.account.findMany({ where: { userId: ownerId } });
  account1Id = accounts[0].id;
  account2Id = await db.account
    .create({
      data: { userId: ownerId, name: "Compte prop", type: "PROP", currency: "USD", initialBalance: "50000" },
    })
    .then((a) => a.id);

  const strategy = await db.strategy.create({
    data: { userId: ownerId, name: "Breakout Londres" },
  });
  strategy1Id = strategy.id;

  const tradeSeedBase: Omit<Prisma.TradeUncheckedCreateInput, "accountId" | "entryTime"> = {
    userId: ownerId,
    instrumentId: instrument.id,
    direction: "LONG",
    entryPrice: "2650.00",
    status: "CLOSED",
    exitTime: new Date("2025-01-15T10:00:00Z"),
    exitPrice: "2655.00",
    netPnl: "53.00",
    lots: "0.10",
    pips: "50",
    rMultiple: "1.2",
    source: "MANUAL",
    reviewStatus: "NOT_REVIEWED",
    preTradeAnalysis: "",
    postTradeReview: "",
  };
  const tradeBase = tradeSeedBase;
  tradeSeed = tradeSeedBase;
  const trade1 = await db.trade.create({
    data: {
      ...tradeBase,
      accountId: account1Id,
      strategyId: strategy1Id,
      entryTime: new Date("2025-01-15T08:00:00Z"),
      notes: "Setup parfait, respect du plan.",
      emotionBefore: "CALM",
    },
  });
  const trade2 = await db.trade.create({
    data: {
      ...tradeBase,
      accountId: account2Id,
      entryTime: new Date("2025-01-16T08:00:00Z"),
    },
  });
  const trade3 = await db.trade.create({
    data: {
      ...tradeBase,
      accountId: account1Id,
      strategyId: null,
      entryTime: new Date("2025-01-17T08:00:00Z"),
    },
  });
  trade1Id = trade1.id;
  trade2Id = trade2.id;
  trade3Id = trade3.id;
});

afterAll(async () => {
  await db.$disconnect();
});

// ── invitations ──────────────────────────────────────────────────────────────

describe("mentor invitations", () => {
  it("creates a single-use invitation scoped to account1 with restricted perms", async () => {
    const { invitation, inviteUrl } = await createInvitation(ownerId, {
      email: "mentor@test.local",
      permissions: {
        accountScope: "LIST",
        accountIds: [account1Id],
        strategyScope: "ALL",
        strategyIds: [],
        canViewAmounts: false,
        canViewJournal: false,
        canViewScreenshots: false,
        canViewAnalytics: true,
        canComment: true,
        expiresAt: null,
      },
    });
    invitationToken = inviteUrl.split("/invitation/")[1];
    expect(invitationToken.startsWith("mtr_")).toBe(true);
    // No double slash before /invitation/ (regression: base URL + "//invitation/").
    expect(inviteUrl).not.toContain("//invitation/");
    expect(inviteUrl).toContain("/invitation/mtr_");
    expect(invitation.status).toBe("PENDING");
    // Raw token never stored — only its hash.
    const row = await db.mentorInvitation.findUniqueOrThrow({
      where: { id: invitation.id },
    });
    expect(row.tokenHash).not.toContain(invitationToken);
  });

  it("rejects a duplicate pending invitation for the same email", async () => {
    await expect(
      createInvitation(ownerId, {
        email: "mentor@test.local",
        permissions: {
          accountScope: "ALL",
          accountIds: [],
          strategyScope: "ALL",
          strategyIds: [],
          canViewAmounts: true,
          canViewJournal: true,
          canViewScreenshots: true,
          canViewAnalytics: true,
          canComment: true,
          expiresAt: null,
        },
      })
    ).rejects.toMatchObject({ code: "INVITE_ALREADY_PENDING" });
  });

  it("refuses self-invitation", async () => {
    await expect(
      createInvitation(ownerId, {
        email: "owner@test.local",
        permissions: {
          accountScope: "ALL",
          accountIds: [],
          strategyScope: "ALL",
          strategyIds: [],
          canViewAmounts: true,
          canViewJournal: false,
          canViewScreenshots: false,
          canViewAnalytics: true,
          canComment: false,
          expiresAt: null,
        },
      })
    ).rejects.toMatchObject({ code: "SELF_INVITE" });
  });

  it("denies acceptance from a WRONG account with a neutral 404", async () => {
    await expect(
      acceptInvitation(invitationToken, {
        id: outsiderId,
        email: "outsider@test.local",
      })
    ).rejects.toMatchObject({ code: "INVITE_NOT_FOUND", status: 404 });
  });

  it("accepts from the matching account and notifies the owner", async () => {
    const result = await acceptInvitation(invitationToken, {
      id: mentorId,
      email: "mentor@test.local",
    });
    expect(result.ownerId).toBe(ownerId);

    const access = await db.mentorAccess.findUniqueOrThrow({
      where: { ownerId_mentorId: { ownerId, mentorId } },
    });
    expect(access.status).toBe("ACTIVE");
    expect(JSON.parse(access.accountIdsJson)).toEqual([account1Id]);
    expect(access.canViewAmounts).toBe(false);

    const notif = await db.notificationLog.findFirst({
      where: { userId: ownerId, type: "MENTOR_INVITE_ACCEPTED" },
    });
    expect(notif).not.toBeNull();
  });

  it("is single-use: the right person re-accepting sees NOT_PENDING", async () => {
    await expect(
      acceptInvitation(invitationToken, {
        id: mentorId,
        email: "mentor@test.local",
      })
    ).rejects.toMatchObject({ code: "INVITE_NOT_PENDING" });
  });

  it("refuses self-mentorat on the context builder", async () => {
    await expect(requireMentorContext(ownerId, ownerId)).rejects.toBeInstanceOf(
      AccessDeniedError
    );
  });
});

// ── scoped reads & redaction ─────────────────────────────────────────────────

describe("mentor scoped reads", () => {
  it("lists ONLY in-scope trades, structurally redacted", async () => {
    const ctx = await requireMentorContext(mentorId, ownerId);
    const page = await listMentorTrades(ctx, { page: 1, pageSize: 50 });
    const ids = page.data.map((t) => t.id);
    expect(ids).toContain(trade1Id);
    expect(ids).toContain(trade3Id); // account1, no strategy → visible
    expect(ids).not.toContain(trade2Id); // account2 → out of scope

    const item = page.data.find((t) => t.id === trade1Id)!;
    // Amounts hidden → keys structurally ABSENT.
    expect(item).not.toHaveProperty("netPnl");
    expect(item).not.toHaveProperty("lots");
    expect(item).not.toHaveProperty("pnlCurrency");
    expect(item).not.toHaveProperty("accountName");
    expect(item).not.toHaveProperty("accountId");
    // Psychology hidden (journal off).
    expect(item).not.toHaveProperty("emotionBefore");
    // Pips & R stay.
    expect(item).toHaveProperty("pips");
    expect(item).toHaveProperty("rMultiple");
  });

  it("trade detail: notes and psychology absent, account fields absent", async () => {
    const ctx = await requireMentorContext(mentorId, ownerId);
    const detail = await getMentorTradeDetail(ctx, trade1Id);
    expect(detail).not.toBeNull();
    const trade = detail!.trade as Record<string, unknown>;
    expect(trade).not.toHaveProperty("notes");
    expect(trade).not.toHaveProperty("emotionBefore");
    expect(trade).not.toHaveProperty("netPnl");
    expect(trade).not.toHaveProperty("accountName");
    expect(trade).toHaveProperty("pips");
  });

  it("out-of-scope trade detail returns null (no existence signal)", async () => {
    const ctx = await requireMentorContext(mentorId, ownerId);
    expect(await getMentorTradeDetail(ctx, trade2Id)).toBeNull();
  });

  it("analytics computed on scoped trades only, amounts redacted", async () => {
    const ctx = await requireMentorContext(mentorId, ownerId);
    const analytics = await getMentorAnalytics(ctx);
    expect(analytics).not.toBeNull();
    expect(analytics!.tradeCount).toBe(2); // trade1 + trade3, not trade2
    const kpis = analytics!.kpisAllTime as Record<string, unknown> | null;
    expect(kpis).not.toBeNull();
    expect(kpis!).not.toHaveProperty("netPnl");
    expect(kpis!).not.toHaveProperty("grossPnl");
    expect(analytics!.equityUnit).not.toBe("CURRENCY");
  });

  it("journal returns null when canViewJournal is false", async () => {
    const ctx = await requireMentorContext(mentorId, ownerId);
    expect(await listMentorJournal(ctx)).toBeNull();
  });

  it("records access (lastViewedAt + per-day log) for the owner", async () => {
    const overview = await listMentors(ownerId, "unused");
    expect(overview.logs.length).toBeGreaterThan(0);
    expect(overview.logs.some((l) => l.resourceType === "TRADES")).toBe(true);
    const access = overview.accesses.find((a) => a.mentorId === mentorId);
    expect(access).toBeDefined();
    expect(access!.lastViewedAt).not.toBeNull();
  });

  it("mentee summary counts scoped new trades and unreviewed", async () => {
    // The scoped reads above already touched lastViewedAt — a trade created
    // NOW is "new since last visit"; account2 stays out of scope.
    await db.trade.create({
      data: {
        ...tradeSeed,
        accountId: account1Id,
        entryTime: new Date("2025-02-01T08:00:00Z"),
        createdAt: new Date(),
      },
    });
    await db.trade.create({
      data: {
        ...tradeSeed,
        accountId: account2Id,
        entryTime: new Date("2025-02-02T08:00:00Z"),
        createdAt: new Date(),
      },
    });
    const mentees = await listMentees(mentorId);
    const me = mentees.find((m) => m.ownerId === ownerId);
    expect(me).toBeDefined();
    expect(me!.newTradesSince).toBe(1); // account1 only — account2 is out of scope
    expect(me!.unreviewedCount).toBe(3); // trade1 + trade3 + the fresh account1 trade
  });
});

// ── comments & mentions ──────────────────────────────────────────────────────

describe("comments & mentions", () => {
  it("denies comments from a user with no access", async () => {
    await expect(
      createComment(outsiderId, trade1Id, { body: "intrusion" })
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("mentor comments (canComment) and the owner is notified", async () => {
    const comment = await createComment(mentorId, trade1Id, {
      body: "Belle entrée, discipline respectée.",
    });
    expect(comment.author.id).toBe(mentorId);
    expect(comment.author.isOwner).toBe(false);

    const notif = await db.notificationLog.findFirst({
      where: { userId: ownerId, type: "COMMENT_NEW" },
    });
    expect(notif).not.toBeNull();
    expect(notif!.url).toContain(`/trades/${trade1Id}`);
  });

  it("mentions: owner OK, outsider rejected", async () => {
    // Valid mention of the owner.
    const withMention = await createComment(mentorId, trade1Id, {
      body: "@olive_fx quel était ton risque initial ?",
    });
    expect(withMention.mentions).toEqual([ownerId]);
    const mentionNotif = await db.notificationLog.findFirst({
      where: { userId: ownerId, type: "MENTION" },
    });
    expect(mentionNotif).not.toBeNull();

    // Invalid mention (no access to the trade) → rejected server-side.
    await expect(
      createComment(mentorId, trade1Id, { body: "cc @olga_x" })
    ).rejects.toMatchObject({ code: "MENTION_INVALID" });
  });

  it("mention candidates list only current access holders", async () => {
    const payload = await listComments(mentorId, trade1Id);
    const ids = payload.mentionable.map((u) => u.id);
    expect(ids).toContain(ownerId);
    expect(ids).toContain(mentorId);
    expect(ids).not.toContain(outsiderId);
    expect(payload.canComment).toBe(true);
  });

  it("owner replies → COMMENT_REPLY notification with the MENTOR deep link", async () => {
    const thread = await listComments(mentorId, trade1Id);
    const mentorComment = thread.comments.find((c) => c.author.id === mentorId)!;
    const reply = await createComment(ownerId, trade1Id, {
      body: "Merci ! Risque de 0,5 %.",
      parentId: mentorComment.id,
    });
    expect(reply.parentId).toBe(mentorComment.id);

    const notif = await db.notificationLog.findFirst({
      where: { userId: mentorId, type: "COMMENT_REPLY" },
    });
    expect(notif).not.toBeNull();
    expect(notif!.url).toContain(`/mentor/${ownerId}/trades/${trade1Id}`);
  });

  it("one level of threading only", async () => {
    const thread = await listComments(mentorId, trade1Id);
    const reply = thread.comments.find((c) => c.parentId !== null)!;
    await expect(
      createComment(mentorId, trade1Id, { body: "sous-réponse", parentId: reply.id })
    ).rejects.toMatchObject({ code: "PARENT_INVALID" });
  });

  it("author edits own comment; others cannot", async () => {
    const mine = await createComment(mentorId, trade1Id, { body: "version 1" });
    const edited = await editComment(mentorId, mine.id, { body: "version 2" });
    expect(edited.body).toBe("version 2");
    expect(edited.editedAt).not.toBeNull();
    await expect(
      editComment(ownerId, mine.id, { body: "pirate" })
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("deleting a comment WITH replies leaves a tombstone", async () => {
    const parent = await createComment(mentorId, trade1Id, { body: "à supprimer" });
    await createComment(ownerId, trade1Id, { body: "réponse", parentId: parent.id });
    await deleteComment(mentorId, parent.id);
    const thread = await listComments(ownerId, trade1Id);
    const tombstone = thread.comments.find((c) => c.id === parent.id)!;
    expect(tombstone.deletedAt).not.toBeNull();
    expect(tombstone.body).toBe("");
  });

  it("deleting a childless comment removes it entirely", async () => {
    const solo = await createComment(mentorId, trade1Id, { body: "solo" });
    await deleteComment(mentorId, solo.id);
    const thread = await listComments(mentorId, trade1Id);
    expect(thread.comments.find((c) => c.id === solo.id)).toBeUndefined();
  });

  it("owner can delete a mentor's comment on their journal", async () => {
    const mentorComment = await createComment(mentorId, trade1Id, {
      body: "commentaire du mentor",
    });
    await deleteComment(ownerId, mentorComment.id);
    const thread = await listComments(ownerId, trade1Id);
    expect(thread.comments.find((c) => c.id === mentorComment.id)).toBeUndefined();
  });

  it("unread badge counts others' comments, mark-read clears it", async () => {
    // Earlier owner comments updated their own read state — create a FRESH
    // mentor comment so there is genuinely something unread.
    await createComment(mentorId, trade1Id, { body: "dernier commentaire non lu" });
    const before = await unreadCommentCount(ownerId);
    expect(before).toBeGreaterThan(0);
    await markTradeRead(ownerId, trade1Id);
    const after = await unreadCommentCount(ownerId);
    expect(after).toBe(0);
  });
});

// ── pause & revoke: immediate effect ────────────────────────────────────────

describe("pause and revoke take effect immediately", () => {
  let accessId: string;

  it("pause denies the next context build", async () => {
    const overview = await listMentors(ownerId, "unused");
    accessId = overview.accesses.find((a) => a.mentorId === mentorId)!.id;

    await updateAccess(ownerId, accessId, { status: "PAUSED" });
    await expect(requireMentorContext(mentorId, ownerId)).rejects.toBeInstanceOf(
      AccessDeniedError
    );
    // Comments denied too (no context → no access).
    await expect(
      listComments(mentorId, trade1Id)
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("resume restores access", async () => {
    const overview = await listMentors(ownerId, "unused");
    const accessId2 = overview.accesses.find((a) => a.mentorId === mentorId)!.id;
    await updateAccess(ownerId, accessId2, { status: "ACTIVE" });
    const ctx = await requireMentorContext(mentorId, ownerId);
    expect(ctx.role).toBe("MENTOR");
    expect(ctx.readOnly).toBe(true);
  });

  it("scope edit (amounts ON) reflects in the next read", async () => {
    const overview = await listMentors(ownerId, "unused");
    const id = overview.accesses.find((a) => a.mentorId === mentorId)!.id;
    await updateAccess(ownerId, id, {
      permissions: {
        accountScope: "LIST",
        accountIds: [account1Id],
        strategyScope: "ALL",
        strategyIds: [],
        canViewAmounts: true,
        canViewJournal: true,
        canViewScreenshots: false,
        canViewAnalytics: true,
        canComment: false,
        expiresAt: null,
      },
    });
    const page = await listMentorTrades(await requireMentorContext(mentorId, ownerId), {
      page: 1,
      pageSize: 50,
    });
    const item = page.data.find((t) => t.id === trade1Id)!;
    expect(item).toHaveProperty("netPnl");
    expect(item).toHaveProperty("accountName");
    // Journal now visible.
    const detail = await getMentorTradeDetail(
      await requireMentorContext(mentorId, ownerId),
      trade1Id
    );
    expect((detail!.trade as Record<string, unknown>)).toHaveProperty("notes");
    // canComment revoked.
    const payload = await listComments(mentorId, trade1Id);
    expect(payload.canComment).toBe(false);
  });

  it("revocation denies everything and notifies the mentor", async () => {
    const overview = await listMentors(ownerId, "unused");
    const id = overview.accesses.find((a) => a.mentorId === mentorId)!.id;
    await revokeAccess(ownerId, id);

    await expect(requireMentorContext(mentorId, ownerId)).rejects.toBeInstanceOf(
      AccessDeniedError
    );
    const notif = await db.notificationLog.findFirst({
      where: { userId: mentorId, type: "MENTOR_ACCESS_REVOKED" },
    });
    expect(notif).not.toBeNull();
  });
});
